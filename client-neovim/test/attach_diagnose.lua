-- Milestone 10 (Neovim client -> Gate 8): attach-and-diagnose e2e, the gate's
-- automatable core. Run with:
--   nvim --headless -l client-neovim/test/attach_diagnose.lua
--
-- This is the Neovim analog of the VS Code Gate 4 e2e and the JetBrains
-- descriptor test: it drives the REAL server through Neovim's built-in LSP
-- client and asserts a deliberate type error squiggles the ORIGINAL source line
-- (the `count = "oops"` line), NOT the `// T:` annotation line above it.
--
-- Unlike config_smoke.lua, this DOES spawn the server, so it requires Node and a
-- built parser .node. It skips cleanly (exit 0) when Node is absent, exactly as
-- the JetBrains e2e is gated on the JVM toolchain — CI without the toolchain
-- should not report a failure for a test it cannot run.

local this = debug.getinfo(1, 'S').source:sub(2)
local plugin_root = vim.fn.fnamemodify(this, ':h:h')        -- client-neovim/
local repo_root = vim.fn.fnamemodify(this, ':h:h:h')        -- repo/
package.path = table.concat({
  plugin_root .. '/lua/?.lua',
  plugin_root .. '/lua/?/init.lua',
  package.path,
}, ';')

-- Skip gate: no Node (and no ETY_NODE) means we can't spawn the server. Report
-- a skip, not a failure.
local has_node = vim.fn.executable('node') == 1
  or (type(vim.env.ETY_NODE) == 'string' and vim.env.ETY_NODE ~= '')
if not has_node then
  print('# SKIP attach_diagnose: Node not found (set ETY_NODE or install node)')
  os.exit(0)
end

-- Require the native 0.11+ registration API; if this Neovim is too old, skip
-- rather than fail (the smoke test still covers the config on any version).
if not (vim.lsp.config and vim.lsp.enable) then
  print('# SKIP attach_diagnose: requires Neovim 0.11+ (vim.lsp.config/enable)')
  os.exit(0)
end

local ok, ety = pcall(require, 'ety')
if not ok then
  io.stderr:write('not ok - require("ety") failed: ' .. tostring(ety) .. '\n')
  os.exit(1)
end

local failures = 0
local function check(name, cond, detail)
  if cond then
    print('ok - ' .. name)
  else
    failures = failures + 1
    print('not ok - ' .. name .. (detail and ('  # ' .. detail) or ''))
  end
end

-- Register + enable ety, THEN open the fixture so the FileType event triggers
-- the auto-attach.
ety.setup()

local fixture = repo_root .. '/fixtures/workspace/type-error.js'
check('fixture exists', vim.fn.filereadable(fixture) == 1, fixture)
vim.cmd('edit ' .. vim.fn.fnameescape(fixture))
local bufnr = vim.api.nvim_get_current_buf()
-- Be deterministic about classification in headless mode.
if vim.bo[bufnr].filetype == '' then
  vim.bo[bufnr].filetype = 'javascript'
end

-- Wait for the ety client to attach to this buffer.
local attached = vim.wait(20000, function()
  return #vim.lsp.get_clients({ name = 'ety', bufnr = bufnr }) > 0
end, 100)
check('ety client attaches to the buffer', attached)

-- Then wait for it to publish at least one diagnostic.
local got = vim.wait(20000, function()
  return #vim.diagnostic.get(bufnr) > 0
end, 100)
check('a diagnostic is published', got)

local diags = vim.diagnostic.get(bufnr)
-- The error is the string-to-number assignment on `count = "oops";` (file line
-- 2 -> 0-indexed lnum 1). The `// T: number` annotation is on line 1 (lnum 0)
-- and must NOT carry the squiggle: that is the line-mapping invariant.
local on_oops = false
local on_annotation = false
for _, d in ipairs(diags) do
  if d.lnum == 1 then on_oops = true end
  if d.lnum == 0 then on_annotation = true end
end
check('diagnostic lands on the original error line (lnum 1, the "oops" line)',
  on_oops, vim.inspect(vim.tbl_map(function(d) return d.lnum end, diags)))
check('diagnostic does NOT land on the // T: annotation line (lnum 0)',
  not on_annotation)

if failures > 0 then
  io.stderr:write(('\n%d check(s) failed\n'):format(failures))
  os.exit(1)
end
print('\nall checks passed')

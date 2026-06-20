-- Milestone 10 (Neovim client -> Gate 8): red-first config smoke. Run with:
--   nvim --headless -l client-neovim/test/config_smoke.lua
-- RED until client-neovim/lua/ety/init.lua exists.
--
-- Pure config assertions: it resolves the launch command WITHOUT spawning the
-- server, exactly as the JetBrains EtyLspServerDescriptorTest resolves a launch
-- command without launching it. So Node need not be installed to run this, and
-- it never touches the network or a child process. The transport itself
-- (server boots over --stdio) is already proven by server/test/stdio-boot.test
-- .js; Neovim reuses that seam, so there is deliberately no server test here.

-- Make `require('ety')` resolve to ../lua/ety/init.lua regardless of cwd.
local this = debug.getinfo(1, 'S').source:sub(2)
local plugin_root = vim.fn.fnamemodify(this, ':h:h') -- client-neovim/
package.path = table.concat({
  plugin_root .. '/lua/?.lua',
  plugin_root .. '/lua/?/init.lua',
  package.path,
}, ';')

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

local function ends_with(s, suffix)
  return type(s) == 'string' and s:sub(-#suffix) == suffix
end

-- 1. Node resolution prefers an explicit opt over everything else.
check('resolve_node prefers opts.node',
  ety.resolve_node({ node = '/opt/n/node' }) == '/opt/n/node')

-- 2. Then ETY_NODE from the environment (the JetBrains-parity override).
vim.env.ETY_NODE = '/custom/path/to/node'
check('resolve_node honors ETY_NODE',
  ety.resolve_node() == '/custom/path/to/node')
vim.env.ETY_NODE = nil

-- 3. cmd is exactly { <node>, <server main.js>, '--stdio' }.
local cmd = ety.build_cmd({ node = 'node' })
check('build_cmd has three parts',
  type(cmd) == 'table' and #cmd == 3, vim.inspect(cmd))
check('build_cmd[1] is the node executable', cmd[1] == 'node')
check('build_cmd[2] points at server/src/main.js',
  ends_with(cmd[2], 'server/src/main.js'), tostring(cmd[2]))
check('build_cmd[3] selects stdio transport', cmd[3] == '--stdio')

-- 4. By default the server claims JS, JSX, and the html host (Milestone 13).
local cfg = ety.config({ node = 'node' })
check('filetypes default to javascript + javascriptreact + html',
  vim.deep_equal(cfg.filetypes, { 'javascript', 'javascriptreact', 'html' }),
  vim.inspect(cfg.filetypes))
check('config reuses the stdio cmd',
  type(cfg.cmd) == 'table' and cfg.cmd[3] == '--stdio')

-- 5. The default host set is exactly { 'html' }, handed to the server as
--    init_options.scriptHosts.
check('init_options.scriptHosts defaults to { html }',
  type(cfg.init_options) == 'table'
    and vim.deep_equal(cfg.init_options.scriptHosts, { 'html' }),
  vim.inspect(cfg.init_options))

-- 6. Opting a template format in widens both the filetypes and scriptHosts,
--    normalized (dot-stripped, lowercased, de-duped).
local opted = ety.config({ node = 'node', script_hosts = { 'html', '.TPL', 'tpl' } })
check('script_hosts opt-in normalizes and de-dupes',
  vim.deep_equal(opted.init_options.scriptHosts, { 'html', 'tpl' }),
  vim.inspect(opted.init_options.scriptHosts))
check('opted filetypes include the template host',
  vim.deep_equal(opted.filetypes, { 'javascript', 'javascriptreact', 'html', 'tpl' }),
  vim.inspect(opted.filetypes))

if failures > 0 then
  io.stderr:write(('\n%d check(s) failed\n'):format(failures))
  os.exit(1)
end
print('\nall checks passed')

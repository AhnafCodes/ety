-- ety -- Neovim client (Milestone 10 / Gate 8). Plumbing only: it registers the
-- SAME language server the VS Code and JetBrains clients drive, over LSP stdio
-- (the transport pinned by server/test/stdio-boot.test.js). No type logic lives
-- here, exactly as client/ and client-jetbrains/ carry none.
--
-- Neovim spawns `node <server>/src/main.js --stdio` as an EXTERNAL process, so
-- Node must be on PATH (or set ETY_NODE) -- the same requirement as the
-- JetBrains client, and for the same reason: Neovim is not a Node host.

local M = {}

M.base_filetypes = { 'javascript', 'javascriptreact' }
M.default_script_hosts = { 'html' }
M.root_markers = { 'package.json', 'jsconfig.json', 'tsconfig.json', '.git' }

-- Host extensions whose <script> blocks ety analyzes (Milestone 13). Default
-- { 'html' }; pass opts.script_hosts to opt the server-side template formats in.
-- Normalized: lowercased, dot-stripped, de-duplicated, non-strings dropped.
-- This list is handed to the server via init_options.scriptHosts AND used to
-- derive the attach filetypes, so client and server agree on what is a host.
function M.script_hosts(opts)
  opts = opts or {}
  local raw = opts.script_hosts
  if type(raw) ~= 'table' then raw = M.default_script_hosts end
  local seen, out = {}, {}
  for _, h in ipairs(raw) do
    if type(h) == 'string' then
      local ext = h:lower():gsub('^%.', '')
      if ext ~= '' and not seen[ext] then
        seen[ext] = true
        out[#out + 1] = ext
      end
    end
  end
  if #out == 0 then return { 'html' } end
  return out
end

-- Base JS/JSX filetypes plus one per configured host extension. For html/jsp/
-- aspx the Neovim filetype name matches the extension; exotic filetypes (e.g. a
-- custom .ftl detection) can be added by passing opts.filetypes explicitly.
function M.filetypes(opts)
  opts = opts or {}
  if type(opts.filetypes) == 'table' then return opts.filetypes end
  local fts = vim.list_extend({}, M.base_filetypes)
  for _, ext in ipairs(M.script_hosts(opts)) do
    fts[#fts + 1] = ext
  end
  return fts
end

-- Resolve a Node executable. The editor is not a Node process, so PATH is not
-- guaranteed inside it. Order: explicit opt -> ETY_NODE -> PATH -> bare name.
-- The bare-name fallback lets the spawn surface a clear "node not found" rather
-- than us guessing an install location.
function M.resolve_node(opts)
  opts = opts or {}
  if type(opts.node) == 'string' and opts.node ~= '' then
    return opts.node
  end
  local env = vim.env.ETY_NODE
  if type(env) == 'string' and env ~= '' then
    return env
  end
  local exe = (vim.fn.has('win32') == 1) and 'node.exe' or 'node'
  local on_path = vim.fn.exepath(exe)
  if on_path ~= '' then
    return on_path
  end
  return exe
end

-- The plugin root (...client-neovim). init.lua sits at <root>/lua/ety/init.lua,
-- so the root is three directories up from this file.
local function plugin_root()
  local this = debug.getinfo(1, 'S').source:sub(2)
  return vim.fn.fnamemodify(this, ':h:h:h')
end

-- Locate server/src/main.js. Bundled beside the plugin first (a packaged plugin
-- ships server/ next to lua/), then the monorepo sibling for development -- the
-- same bundled-then-dev ladder the VS Code (resolveServerModule) and JetBrains
-- (EtyLspServerDescriptor) clients follow.
function M.resolve_server(opts)
  opts = opts or {}
  if type(opts.server_path) == 'string' and opts.server_path ~= '' then
    return opts.server_path
  end
  local root = plugin_root()
  local candidates = {
    root .. '/server/src/main.js',   -- packaged: <plugin>/server/src/main.js
    root .. '/../server/src/main.js', -- dev: monorepo sibling
  }
  for _, p in ipairs(candidates) do
    if vim.fn.filereadable(p) == 1 then
      return vim.fn.fnamemodify(p, ':p') -- normalize away any '..'
    end
  end
  error('ety: could not locate server/src/main.js (looked in: '
    .. table.concat(candidates, '; ') .. ')')
end

-- { node, server, '--stdio' } -- the launch command, identical in shape to the
-- other clients'; only the transport flag is hard-pinned here.
function M.build_cmd(opts)
  return { M.resolve_node(opts), M.resolve_server(opts), '--stdio' }
end

-- The LSP config table: cmd + the filetypes the server claims + root markers +
-- the host extensions handed to the server (Milestone 13). No custom handlers --
-- push diagnostics and hover come from Neovim's built-in LSP client against the
-- server's advertised capabilities (incl. the Milestone 9 base-type completion,
-- negotiated server-side).
function M.config(opts)
  return {
    cmd = M.build_cmd(opts),
    filetypes = M.filetypes(opts),
    root_markers = M.root_markers,
    -- Sent verbatim as the LSP `initializationOptions`, so the server projects
    -- the same extensions' <script> blocks the client attaches to.
    init_options = { scriptHosts = M.script_hosts(opts) },
  }
end

-- Register ety with Neovim. Prefers the native 0.11+ API; on older Neovim it
-- returns the config so the caller can wire it via an autocmd + vim.lsp.start
-- or through nvim-lspconfig (see README).
function M.setup(opts)
  opts = opts or {}
  local cfg = M.config(opts)
  if vim.lsp.config and vim.lsp.enable then
    vim.lsp.config('ety', cfg)
    vim.lsp.enable('ety')
  end
  return cfg
end

return M

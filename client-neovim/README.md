# ety — Neovim client

Brings ety's `// T:` diagnostics and hovers to Neovim by registering the
**same** language server as the VS Code and JetBrains clients (`server/`), over
LSP **stdio**. It contains no type logic of its own — it is a thin client, like
the other two.

> Requires Neovim **0.11+** (for the native `vim.lsp.config` / `vim.lsp.enable`
> API) and **Node on PATH** (or `ETY_NODE=/path/to/node`). Neovim spawns the
> server as an external `node … --stdio` process — the same Node requirement as
> the JetBrains client, for the same reason (Neovim is not a Node host).

## Layout

```
client-neovim/
├── lua/ety/init.lua     # setup(); resolves node + server/src/main.js, registers via vim.lsp
├── test/config_smoke.lua # headless config smoke (resolves the cmd without spawning)
├── README.md
└── GATE-8-CHECKLIST.md
```

This module is **outside** the npm workspace (it is Lua, not Node) and does not
run under `npm test`. The transport it relies on — the server booting over
stdio — is guarded by `server/test/stdio-boot.test.js`, which *does* run in
`npm test`. Neovim reuses that exact seam, so there is no server-side code here.

## Install & enable

### Native (Neovim 0.11+)

With any plugin manager that puts this directory on the runtimepath
(`lazy.nvim` shown):

```lua
{
  'your/ety',                 -- or a local dir during development
  config = function()
    require('ety').setup()    -- registers + enables the 'ety' server
  end,
}
```

`setup({ node = '/path/to/node', server_path = '/path/to/server/src/main.js' })`
accepts overrides; both are optional (it resolves `ETY_NODE`→PATH and a
bundled-then-monorepo server path on its own).

### nvim-lspconfig users

`require('ety').setup()` returns the resolved config table, so you can hand its
`cmd` / `filetypes` / `root_markers` to your existing lspconfig flow if you
prefer to manage servers there.

## Develop

```bash
# Config smoke (no Node, no server spawn needed):
nvim --headless -l client-neovim/test/config_smoke.lua

# Try it live: open a fixture and check diagnostics/hover.
nvim fixtures/workspace/type-error.js
```

`config_smoke.lua` asserts the resolved `cmd` is `{ node, …/server/src/main.js,
'--stdio' }`, the `filetypes` are exactly `javascript`/`javascriptreact`, and
the Node resolver honors `ETY_NODE`. It does **not** spawn the server (so Node
need not be installed) and needs no GUI — mirroring the JetBrains descriptor
smoke test.

## Status

Scaffold (Milestone 10 / Gate 8). Done: the `setup`/`resolve`/`config` module
and the headless config smoke (authored; run on a machine with Neovim 0.11+).
Remaining to close Gate 8: the headless attach-and-diagnose e2e, and the manual
visual check in a real Neovim session — see
[`GATE-8-CHECKLIST.md`](./GATE-8-CHECKLIST.md).

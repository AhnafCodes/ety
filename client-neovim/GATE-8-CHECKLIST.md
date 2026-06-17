# Gate 8 — Neovim manual verification

Turnkey steps to confirm the ety Neovim client works in a real session. Mirrors
[Gate 5](../client-jetbrains/GATE-5-CHECKLIST.md) (JetBrains) — the same server,
the same fixtures, the same expectations, through Neovim's built-in LSP client.

## §0 — Prerequisites

- Neovim **0.11+** (`nvim --version`).
- **Node on PATH** (`node -v`) or `export ETY_NODE=/path/to/node`.
- Server deps + parser built once, from the repo root:
  ```bash
  npm ci
  npm run build:parser     # builds the platform-specific ety-parser .node
  ```
- This plugin on the runtimepath, with `require('ety').setup()` run (see README).

## §1 — The client attaches

1. `nvim fixtures/workspace/box.js`
2. `:lua =vim.lsp.get_clients({ name = 'ety' })[1] ~= nil` → prints `true`.
3. `:checkhealth vim.lsp` → the `ety` client is listed and attached to the buffer.

If it does not attach: `:lua =require('ety').build_cmd()` to see the resolved
command; confirm `node` runs it by hand: `node <that main.js> --stdio` should
start and wait on stdin.

## §2 — Diagnostics land on the ORIGINAL line

1. `nvim fixtures/workspace/type-error.js`
2. `:lua =vim.diagnostic.get(0)` → exactly one diagnostic.
3. Its `lnum` is the **`"oops"` line (line 2, 0-indexed `lnum = 1`)** — *not* the
   `// T:` annotation line. This is the whole architecture claim: the squiggle
   maps back to editable source, never the injected type.
4. Visually: `]d` jumps the cursor onto `"oops"`, and the virtual-text/underline
   sits there.

## §3 — Hover shows the resolved type

1. In `fixtures/workspace/box.js`, place the cursor on `boxed`.
2. Press `K` (or `:lua vim.lsp.buf.hover()`).
3. The floating window shows **`Box<number>`**. Repeat on `doubled` (→
   `Box<number>`) and `value` (→ `T`).

## §4 — JSX is handled

1. `nvim fixtures/workspace/component.jsx`
2. `:lua =vim.diagnostic.get(0)` → the squiggle is on the `'oops'` value, and
   there are **no** spurious JSX errors (the server type-checks JSX without
   transforming it).

## §5 — Base-type completion (Milestone 9, negotiated server-side)

1. In a `.js` buffer, type `let i = 0; // T:` and trigger completion after the
   colon (`<C-x><C-o>` for omnifunc, or your completion plugin).
2. **`number`** appears as a suggestion. (Try `let s = "x"; // T:` → `string`.)
3. This required no Neovim-specific work — it arrives purely because the server
   advertises `completionProvider` and Neovim's LSP client honors it.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No client attaches | `setup()` not run, or filetype not `javascript`/`javascriptreact` | confirm `:lua =vim.bo.filetype`; ensure `require('ety').setup()` ran |
| Client attaches then exits | `node` not found, or `.node` parser not built | `:lua =require('ety').build_cmd()`; run `npm run build:parser` |
| Diagnostic on the `// T:` line | wrong server / stale build | rebuild parser; confirm `build_cmd()[2]` is the repo's `server/src/main.js` |
| Hover empty | cursor not on the annotated symbol | place it on the identifier, not the `// T:` text |

## Recording

Capture a short screen recording of §2 (squiggle on the original line) and §3
(hover) as the durable evidence for Gate 8, exactly as Gate 5 asks for JetBrains.

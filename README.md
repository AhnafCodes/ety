# ety

**Types in comments for plain JavaScript.** Write ordinary `.js`/`.jsx` — no build step, no `.ts` files — and put your types in `// T:` comments. ety is a language server that gives you Type(TypeScript's) diagnostics and hovers on top of untouched JavaScript source.

```javascript
let count = 0;               // T: number
let current = null;          // T: User | null
const cache = new Map();     // T: Map{string, User}
const double = x => x * 2;   // T: (number) => number

function createUser(name, role) {
// T: (name: string, role?: Role) => User
    return { name, role };
}
```

`count = "oops"` now squiggles. Hovering `createUser` shows the full signature. The file on disk stays plain JavaScript that runs anywhere.

## Why? ety - EcmaScript Type Comments.

Ety is inspired from Python's Type Comments, a Hidden GEM(first form of hinting was the type comment (PEP 484)).

<img width="1024" height="559" alt="678063c1-d592-4167-8f12-d535e262b136" src="https://github.com/user-attachments/assets/cffad46b-c416-4dc5-8f56-4e85894b2cb3" />

With it in a Variable Declarition statement  Name & Value are in the focus and Type are secondary(in the METALANE i.e. // T comments). Un-Cluttered and Less Verbose. 


## How it works

ety never rewrites your file. It builds a **virtual document** by inserting JSDoc lines above your annotations, hands that to the TypeScript Language Service, and maps the results back to your real source.

```
.js source ──► Rust parser (Oxc) ──► annotations ──► transformer ──► virtual doc
   ▲                                                                      │
   │                                                                      ▼
   └────── LSP diagnostics / hover ◄──── line maps ◄──── TypeScript Language Service
```

Three invariants make the mapping trivial and robust:

- **Immutable source** — the user's bytes are never edited.
- **Additive overlay** — insertions are always *whole lines* (injected JSDoc, hoisted imports), so character columns on code lines are identical between the real and virtual documents.
- **Line-only mapping** — because columns never shift, the entire source map is two line-number maps (`vToO` / `oToV`). No intra-line offset tracking.

A type error inside an injected JSDoc line is remapped onto the `// T:` comment you can actually edit, so the squiggle always lands on real, editable text.

## Annotation syntax

Generics use `{}` instead of `<>` to avoid JSX/HTML conflicts: `Box{T}` → `Box<T>`, `Map{K, V}` → `Map<K, V>`.

The one disambiguation rule:

| Form | Meaning | Example |
|------|---------|---------|
| `{` **immediately after** an identifier | generic args | `Map{string}` → `Map<string>` |
| `{…}` **immediately followed by** `(` | generic param list | `{T}(T[]) => T[]` → `<T>(T[]) => T[]` |
| anything else | object type, verbatim | `{ id: string }` |

> **The one constraint:** never put a space between a type name and its generic args. `Map{string}` is a generic; `Map {string}` is an object type. Identifiers are unicode-aware, so `Бокс{string}` works too.

Placement is strict — the parser never looks *above* a node:

- **Rule 1 (trailing):** variables, properties, and types use a trailing `// T:` on the *same line*, after the statement ends.
- **Rule 2 (inside-block):** functions and classes use `// T:` on the *first line inside* the body.

Imports get their own form, hoisted to the top of the virtual document:

```javascript
// T: import { User, Role } from './types'
```

### Every form

A single module exercising each supported annotation:

```javascript
// ── Imports — hoisted to the top of the virtual document ──
// T: import { User, Role } from './types'

// ── Variables & properties — Rule 1, trailing on the same line ──
let count = 0;                       // T: number
let current = null;                  // T: User | null  (union)
const cache = new Map();             // T: Map{string, User}
const ids = new Set();               // T: Set{string}
const pending = fetchUser();         // T: Promise{User}
let entries = [];                    // T: [string, number][]  (array of tuples)
const config = {};                   // T: { host: string, port: number }  (object type, verbatim)
const nested = new Map();            // T: Map{string, {id: string}}  (nested object inside a generic)

// ── Functions — Rule 2, first line inside the body ──
function createUser(name, role) {
// T: (name: string, role?: Role) => User
    return { id: crypto.randomUUID(), name, role: role ?? 'user' };
}

// Concise arrows have no block body, so they take a trailing annotation
// on the whole statement (Rule 1):
const double = x => x * 2;           // T: (number) => number

// Function expressions assigned to a variable use the inside-block form:
const greet = function (user) {
// T: (user: User) => string
    return `hi ${user.name}`;
};

// ── Classes & generics — Rule 2 for the class and each method ──
class Box {
// T: {T}
    value;                           // T: T
    map(fn) {
        // T: {U}((T) => U) => Box{U}
        return new Box(fn(this.value));
    }
}

const boxed = new Box(42);           // T: Box{number}
```

Each becomes a JSDoc line in the virtual document — `// T: number` → `/** @type {number} */`, the class `// T: {T}` → `/** @template T */`, and a function signature is given synthetic parameter names where you omit them (`(number) => number` → `(p0: number) => number`). You never see any of that; it lives only in the document handed to TypeScript.

### Suppressing diagnostics

A `// T: ignore` directive silences every diagnostic on the line it sits on —
the ety analog of `@ts-ignore`, but trailing (same line) rather than above, to
match the "never look above a node" rule. `// T:i` is the shorthand.

```javascript
const user = getUser();
user.naem;                 // T: ignore   (typo silenced on this line)
widen(0.1 + 0.2);          // T:i         (shorthand)
```

It injects nothing into the virtual document; it only marks its line so the
language server drops any diagnostic that maps back to it. Only the exact
payloads `ignore` and `i` are directives — a type literally named `ignored`
is still a normal annotation.

## Project layout

```
crates/ety-parser/   Rust (Oxc) → napi addon: extracts // T: annotations from the AST
server/              Node LSP server
  src/transform.js     virtual-doc builder + the {} scanners (pure, no I/O)
  src/tsHost.js        TypeScript Language Service host
  src/handlers.js      diagnostics + hover, as pure (state, deps) functions
  src/main.js          connection wiring only
client/              VS Code extension (launches the server over IPC)
fixtures/            contract (napi boundary), transform (golden), workspace (e2e)
```

It's an npm workspaces monorepo (`crates/ety-parser`, `server`, `client`).

## Build & test

```bash
npm install
npm run build:parser   # compiles the Rust napi addon (requires the Rust toolchain)
npm test               # 120 Node unit/integration tests (vitest)
cargo test --manifest-path crates/ety-parser/Cargo.toml   # 20 Rust tests
npm run test:e2e       # 5 end-to-end tests in a real VS Code (downloads VS Code once)
```

CI (`.github/workflows/ci.yml`) runs all three layers on every push; e2e runs headless under xvfb on Linux.

### Pinned dependencies

Both are pinned exactly and guarded by tests that fail loudly on drift, because behavior is version-sensitive:

- **Oxc** `=0.135.0` (parser)
- **TypeScript** `6.0.3` (language service)

## Try it in VS Code

The end-to-end suite is the turnkey demo — it launches a real VS Code with the
extension loaded against `fixtures/workspace/` and asserts hover and diagnostics:

```bash
npm install && npm run build:parser && npm run test:e2e
```

### Interactive session

For a hands-on session, the repo ships a `.vscode/launch.json` with a
`"Run Extension"` configuration (`extensionDevelopmentPath` → `client/`,
pre-opening `fixtures/workspace/`). Open the repo root in VS Code and press
<kbd>F5</kbd> — a second **[Extension Development Host]** window opens with the
extension loaded and the server running. Unlike `test:e2e`, this window stays
open: open any `.js`/`.jsx` file, add a `// T:` annotation and introduce a type
error — it squiggles on the right line, and hovering an annotated symbol shows
its type.

```bash
npm install && npm run build:parser   # one-time: the addon must exist first
code .                                 # open the repo root, then press F5
```

No file to spare? A scratch buffer works too: <kbd>Cmd/Ctrl+N</kbd>, set the
language to **JavaScript** (status bar, bottom-right — unsaved buffers start as
plaintext), and type. The extension attaches to `untitled:` buffers as well as
saved files, so `let test = 1 // T: number` then `test = "hello"` squiggles
without ever hitting disk.

Edited `client/` or `server/` code? Reload the dev host with <kbd>Cmd/Ctrl+R</kbd>.
Breakpoints work in both the client and the forked server process. One gotcha:
imported files must be **open** for their types to resolve (see v1 limitations),
so if a hover comes up empty, open the file the type is declared in.

## v1 limitations

- **Imported files must be open** for their types to resolve. (Closed files are read raw from disk without their annotations; v2 plans *transform-on-read*.)
- **No autocompletion inside `// T:`** — completion would land in comment trivia in the virtual document. Hover and diagnostics are the core and don't depend on it.

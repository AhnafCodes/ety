---
name: writing-ety
description: Write or edit type annotations for plain JavaScript using ety's `// T:` comments (a.k.a. EcmaScript Type Comments / //T). Use whenever adding types to .js/.jsx (or <script> blocks) without TypeScript — especially generics, function signatures, typedefs, classes, and imports. Covers ety's non-obvious rules that differ from TypeScript/JSDoc.
---

# Writing ety annotations

ety gives plain JavaScript TypeScript-grade diagnostics and hovers by reading types from
`// T:` comments. It is a **language server**, not a transpiler: it never rewrites your
`.js` file and never writes anything to disk. Your job here is to emit *correct* `// T:`
annotations — the editor's ety server does the actual type-checking.

`// T:` and `// type:` are exact equivalents. Prefer `// T:`.

## The four rules that models get wrong

ety collides on purpose with TypeScript/JSDoc priors. Get these right first:

1. **Generics use `{}`, never `<>`.** `Map{string, User}`, `Set{T}`, `Promise{User}`,
   `Array{string}`, `Partial{User}`. Writing `Map<string, User>` is wrong.

2. **No space between a name and its generic args.** `Map{string}` is a generic;
   `Map {string}` is parsed as an object type. This is the single hardest constraint.

3. **Placement depends on the construct, and ety NEVER looks above a node:**
   - **Variables, properties, concise arrows, casts** → trailing `// T:` on the *same line*, after the statement.
   - **Functions, methods, classes** → `// T:` on the *first line inside* the body.
   - Putting a type comment *above* a function/class (JSDoc-style) does nothing in ety.

4. **`typedef` is implemented; `callback` is NOT (deferred, no milestone).** Use `typedef`
   for object/union/alias types. Do not emit `// T: callback …` — it binds to nothing today.

## Cheat sheet

```javascript
// ── Variables & properties: trailing, same line ──
let count = 0;                  // T: number
let current = null;             // T: User | null
const cache = new Map();        // T: Map{string, User}
const ids = new Set();          // T: Set{string}
let entries = [];               // T: [string, number][]
const config = {};              // T: { host: string, port: number }
const el = document.getElementById('x');  // T: HTMLInputElement   (cast = annotate the binding)

// ── Functions: first line INSIDE the body ──
function createUser(name, role) {
// T: (name: string, role?: Role) => User
    return { name, role };
}

// Positional (no names) also works; void return may be omitted:
function add(a, b) {
// T: (number, number) => number
    return a + b;
}
function log(msg) {
// T: (string)            // => void implied
    console.log(msg);
}

// Concise arrow (no block body): trailing, Rule 1
const double = x => x * 2;      // T: (number) => number

// Function expression assigned to a var: inside-block form
const greet = function (user) {
// T: (user: User) => string
    return `hi ${user.name}`;
};

// ── Generics ──
function identity(x) {
// T: {T}(T) => T
    return x;
}
function getProp(obj, key) {
// T: {T, K extends keyof T}(T, K) => T[K]
    return obj[key];
}
// constraint: {T extends string}(...)   default: {T = string}(...)

// ── Async: Promise is implicit ──
async function fetchUser(id) {
// T: (string) => User | null      // becomes Promise<User | null>
    return api.get(`/users/${id}`);
}

// ── Imports: hoisted to top of the virtual doc ──
// T: import { User, Role } from './types'
// (relative paths work as-is; the file declaring the type must be OPEN in the editor — v1 limitation)
```

### Classes — every annotation is BELOW its definition

```javascript
class Box {
// T: # A generic container        ← class description (standalone, uses `#`)
// T: @template T                  ← generic param for the class
    value;                          // T: T - the contained value   (property: trailing)
    id;                             // T: string @readonly
    constructor(value) {
        // T: (T)
        this.value = value;
    }
    map(fn) {
        // T: {U}((T) => U) => Box{U}
        return new Box(fn(this.value));
    }
}
class Admin extends User {
// T: # @implements {Disposable}    ← extends/implements still type-check
    perms;                          // T: string[]
}
```

### typedef (object/union/alias types)

```javascript
// T: typedef User = { id: string, name: string, role: Role }
// T: typedef Role = 'admin' | 'user' | 'guest'
// T: typedef ID = string | number
// T: typedef Config = { apiKey: string, timeout?: number, readonly baseUrl: string }
```

`typedef` is a **reserved leading word** (like `ignore`/`i`) — a `// T:` whose first word is
`typedef` is a declaration, not a type. Optional (`?`) and `readonly` work inside the object
body verbatim. A `typedef` is importable across files (it projects a synthetic `export const`).

## Descriptions — `#` for the whole declaration, `-` for individual properties

These are two different things; don't conflate them:

- **`// T: #` describes the declaration as a whole** — the typedef/function/class
  *descriptor*. `@`-tags get their own `// T:` lines:
  `// T: @throws: Error - msg`, `// T: @deprecated: use vX`, `// T: @see: other`.
- **` - text` describes one individual or sub-property** — a variable, a param, a class
  field, or a single property inside an object/typedef body. Trailing, after that item's type.

```javascript
let count = 0;  // T: number - current item count          (individual item: the `-`)

function calc(x) {
// T: (number) => number
// T: # Calculates the result                              (whole declaration: the `#`)
// T: @throws: Error - when x is negative
    return x * 2;
}

// typedef: `#` describes the typedef itself; `-` describes each property
// T: typedef User = { id: string - unique id, name: string - display name }
// T: # A registered user in the system
```

## Suppressing diagnostics

```javascript
user.naem;            // T: ignore      silence every diagnostic on THIS line (trailing, never above)
widen(0.1 + 0.2);     // T:i            shorthand

// T: ignore-start                      silence every line in the inclusive range…
legacy.whatever();
sketchy(x);
// T: ignore-end                        …both marker lines included
```
Block form: `ignore-start` … `ignore-end` suppress the whole range. An unclosed `ignore-start`
runs to end of file; a stray `ignore-end` is a no-op. Only the exact payloads `ignore`, `i`,
`ignore-start`, and `ignore-end` are directives — a type literally named `ignored` is still a
normal annotation.

## Type syntax quick reference

- **Primitives:** `string number boolean null undefined symbol bigint void any unknown never`
- **Arrays:** `T[]`, `T[][]`, or `Array{T}`
- **Objects:** `{ k: T }`, optional `{ k?: T }`, readonly `{ k: T @readonly }`, index `{ [k: string]: T }`
- **Built-in generics:** `Map{K,V} Set{T} WeakMap{K,V} Promise{T} Record{K,V} Partial{T} Required{T} Readonly{T} Pick{T,K} Omit{T,K}`
- **Unions/intersections:** `A | B`, `A & B`
- **Tuples:** `[T, U]`, named `[name: T]`, rest `[T, ...U[]]`
- **Literals:** `'a' | 'b'`, `1 | 2`, `true`, `` `on${string}` ``
- **Functions:** `(params) => ret`, void `(params)`, generic `{T}(T) => T`
- **Optional vs nullable:** `x?` means *may be undefined* (param/property); use `| null` explicitly for nullable.
- **Rest params:** `(...number[]) => T`. **Default params:** `(string, number = 1) => T`.

## Disambiguation (generic `{T}` vs object `{ k: T }`)

- `{ident}(` → generics (must be immediately before `(`): `{T}(T) => T`
- `{ id: type }` → object literal (has a colon)
- `Name{...}` with no space → built-in/named generic: `Map{string, number}`
- Bare `// T: {T}` with nothing after is **ambiguous and rejected** — always write `{T}(...) => ...`.

## Don'ts

- Don't create `.ts` files, add a build step, or run a CLI — ety has no CLI and writes nothing.
- Don't use `<...>` generics, ever.
- Don't put a space before generic args (`Map {T}` is an object type).
- Don't annotate functions/classes *above* the definition — annotate inside the body.
- Don't emit `// T: callback …` (deferred). Use `typedef` instead.
- Don't expect CommonJS, method overloads, conditional/mapped types, or `infer` — unsupported (ESM only; use unions/typedefs).

## A note on limits

You can produce well-formed ety, but you can't *validate* it — only the running ety language
server reports whether `count = "oops"` actually squiggles. Treat correct syntax as the goal
here; leave verification to the editor.

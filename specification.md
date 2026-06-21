

# //T or EcmaScript Type Comments Specification(ety)

**Version:** 0.2.0  
**Status:** Draft



## Why //T or jty?

//T or Ety  brings type safety to JavaScript with minimal syntax. Compare traditional JSDoc with Ety's `//T` comments:

### Simple Function

<table>
<tr>
<th>JSDoc (9 comment lines)</th>
<th>//T (3 lines)</th>
</tr>
<tr>
<td>

```javascript
/**
 * Creates a new user with the 
 * given details
 * @param {string} name - User's name
 * @param {string} email - User's email
 * @param {Role} [role] - Optional role
 * @returns {User} The created user
 * @throws {Error} If email is invalid
 */
function createUser(name, email, role) {
    return {
        id: crypto.randomUUID(),
        name,
        email,
        role: role ?? 'user'
    };
}
```

</td>
<td>

```javascript
function createUser(name, email, role) {
// T: (string, string, Role?) => User
// T: * Creates a new user with the given details
// T:  @throws: ErrorType - If email is invalid
    return {
        id: crypto.randomUUID(),
        name,
        email,
        role: role ?? 'user'
    };
}
```

</td>
</tr>
</table>

### Generic Function

<table>
<tr>
<th>JSDoc</th>
<th>//T</th>
</tr>
<tr>
<td>

```javascript
/**
 * Filters an array based on a predicate
 * @template T
 * @param {T[]} items - Array to filter
 * @param {function(T): boolean} predicate
 * @returns {T[]} Filtered array
 */
function filter(items, predicate) {
    return items.filter(predicate);
}
```

</td>
<td>

```javascript
function filter(items, predicate) {
// T: {T}(T[], (T) => boolean) => T[]
// T: * Filters an array based on a predicate
    return items.filter(predicate);
}
```

</td>
</tr>
</table>

### Type Definitions

<table>
<tr>
<th>JSDoc</th>
<th>//T</th>
</tr>
<tr>
<td>

```javascript
/**
 * A registered user in the system
 * @typedef {Object} User
 * @property {string} id - Unique identifier
 * @property {string} name - Display name
 * @property {string} email - Email address
 * @property {Role} role - User's role
 */

/**
 * User permission level
 * @typedef {'admin' | 'user' | 'guest'} Role
 */

/**
 * Called when user data changes
 * @callback OnUserChange
 * @param {User} user - Current user
 * @param {User | null} prev - Previous user
 * @returns {void}
 */
```

</td>
<td>

```javascript
// T: typedef User = { id: string, name: string, email: string, role: Role }
// T: * A registered user in the system

// T: typedef Role = 'admin' | 'user' | 'guest'
// T: * User permission level

// T: callback OnUserChange = (user: User, prev: User | null) => void
// T: * Called when user data changes
```

</td>
</tr>
</table>

### Async Function with Generics

<table>
<tr>
<th>JSDoc</th>
<th>//T</th>
</tr>
<tr>
<td>

```javascript
/**
 * Fetches data from an API endpoint
 * @template T
 * @param {string} url - API endpoint
 * @param {RequestInit} [options] - Fetch options
 * @returns {Promise<T>} Parsed response
 */
async function fetchJson(url, options) {
    const res = await fetch(url, options);
    return res.json();
}
```

</td>
<td>

```javascript
async function fetchJson(url, options) {
// T: {T}(string, RequestInit?) => T
// T: * Fetches data from an API endpoint
    const res = await fetch(url, options);
    return res.json();
}
```

</td>
</tr>
</table>

### Class Definition

<table>
<tr>
<th>JSDoc</th>
<th>//T</th>
</tr>
<tr>
<td>

```javascript
/**
 * A generic data container
 * @template T
 */
class Box {
    /**
     * The contained value
     * @type {T}
     */
    value;
    
    /**
     * Creates a new Box
     * @param {T} value - Initial value
     */
    constructor(value) {
        this.value = value;
    }
    
    /**
     * Transforms the value
     * @template U
     * @param {function(T): U} fn
     * @returns {Box<U>}
     */
    map(fn) {
        return new Box(fn(this.value));
    }
}
```

</td>
<td>

```javascript
class Box {
// T: @template T
// T: * A generic data container

    value;  // T: T - The contained value
    
    constructor(value) {
        // T: (T)
        this.value = value;
    }
    
    map(fn) {
        // T: {U}((T) => U) => Box{U}
        // T: * Transforms the value
        return new Box(fn(this.value));
    }
}
```

</td>
</tr>
</table>

### Variables and Collections

<table>
<tr>
<th>JSDoc</th>
<th>//T</th>
</tr>
<tr>
<td>

```javascript
/** @type {number} */
let count = 0;

/** @type {Map<string, User>} */
const userCache = new Map();

/** @type {Set<string>} */
const activeIds = new Set();

/** @type {Array<[string, number]>} */
let entries = [];
```

</td>
<td>

```javascript
let count = 0;                  // T: number
const userCache = new Map();    // T: Map{string, User}
const activeIds = new Set();    // T: Set{string}
let entries = [];               // T: [string, number][]
```

</td>
</tr>
</table>

---

### Key Differences

| Aspect | JSDoc | //T |
|--------|-------|-----|
| Location | Above code | Inline with code |
| Verbosity | High (multi-line blocks) | Low (single line) |
| Generic syntax | `@template T` + `{T}` | `{T}(T) => T` |
| Readability | Separated from code | Adjacent to code |
| IDE support | Native | Via language server (LSP) |
| Learning curve | Moderate | Low (TypeScript-like) |

---

### When to Use //T or Ety

//T or Ety is ideal when you:

| Scenario | Ety Fit |
|----------|---------|
| Find JSDoc too verbose | ✅ Excellent |
| Need IDE intellisense for JS | ✅ Excellent |
| Can use an editor with the ety plugin | ✅ Required |
| Cannot use TypeScript (organizational/legacy constraints) | ✅ Excellent |
| Building npm packages with JS source + types | ✅ Excellent |
| Migrating legacy JS codebase incrementally | ✅ Good |
| Greenfield project with full control | ⚠️ Consider TypeScript |
| Team unfamiliar with type systems | ⚠️ Training needed |

**Best Use Cases:**

1. **npm Libraries** — Ship JavaScript source with full type support without TypeScript compilation
2. **Legacy Codebases** — Add types incrementally without rewriting to TypeScript
3. **Organizational Constraints** — When TypeScript adoption is blocked but type safety is desired
4. **Rapid Prototyping** — Quick type annotations without build step complexity

**When to Use TypeScript Instead:**

- Greenfield projects with no constraints
- Teams already proficient in TypeScript
- Projects requiring advanced type features (conditional types, mapped types)

---

## Overview

Ety (also `//T`) is a lightweight type annotation syntax using trailing comments (inspired by [Python Type Comments](https://typing.python.org/en/latest/guides/modernizing.html#type-comments)). It brings TypeScript-grade diagnostics and hovers to plain JavaScript with no build step, no `.ts` files, and no generated artifacts on disk.

**Key Principle:** Ety is a **language server**, not a transpiler or code generator. It never rewrites your source and never writes files. Your `.js`/`.jsx` stays byte-for-byte unchanged and runs anywhere; the types live only in `// T:` comments and in an **in-memory virtual document** that the server hands to the TypeScript Language Service.

### Architecture (LSP + Virtual Document)

Ety builds a *virtual document* by inserting JSDoc lines above your annotations, hands that to the TypeScript Language Service, and maps the results back to your real source. Nothing is written to disk.

```
.js source ──► Rust parser (Oxc) ──► annotations ──► transformer ──► virtual doc
   ▲                                                                      │
   │                                                                      ▼
   └────── LSP diagnostics / hover ◄──── line maps ◄──── TypeScript Language Service
```

Three invariants keep the mapping trivial and robust:

- **Immutable source** — the user's bytes are never edited.
- **Additive overlay** — insertions are always *whole lines* (injected JSDoc, hoisted imports), so character columns on code lines are identical between the real and virtual documents.
- **Line-only mapping** — because columns never shift, the entire source map is two line-number maps (`vToO` / `oToV`). No intra-line offset tracking.

A type error inside an injected JSDoc line is remapped onto the `// T:` comment you can actually edit, so the squiggle always lands on real, editable text.

#### Pipeline stages

| Stage | Component | Role |
|-------|-----------|------|
| Parse | Rust (Oxc) napi addon — `crates/ety-parser` | Parses the `.js` AST and extracts `// T:` annotations with their positions. |
| Transform | `server/src/transform.js` (pure, no I/O) | Builds the virtual document (injected JSDoc + hoisted imports) and the line maps. Hosts the `{}`-generic scanners. |
| Type-check | `server/src/tsHost.js` | TypeScript Language Service host; serves the virtual documents and produces diagnostics/hover. |
| Serve | `server/src/handlers.js` | Diagnostics, hover, and inference-driven completion as pure `(state, deps)` functions; remap TypeScript results back through the line maps onto the original source. |
| Wire | `server/src/main.js` | Connection plumbing only. |

The server is launched by the editor plugin (VS Code, JetBrains, Neovim) over LSP — there is no standalone CLI, generator, or watcher.

> **Historical note:** Earlier drafts (≤ v0.1.3) described a *transpilation pipeline* that **generated** JSDoc stub files (`-ty.jsdoc.js`) into a shadow `.types/` directory, which the IDE then consumed through `jsconfig.json` path mapping, all driven by a `Ety generate --watch` CLI. That approach was an early, buggy prototype and has been **removed**. Ety now serves types directly over LSP from an in-memory virtual document: no stub files, no `.types/` directory, and no generator/watcher CLI exist. The "Generates" examples throughout this document describe the JSDoc that ety projects **into the virtual document**, not files it writes.

---

## Syntax

### Prefixes

Both prefixes are equivalent:
```javascript
let count = 0;  // type: number
let count = 0;  // T: number
```

### Generic Syntax

Ety uses curly braces `{T}` for generics instead of angle brackets `<T>`:

```javascript
let items = [];       // T: Array{string}
let map = new Map();  // T: Map{string, number}

function identity(x) {
// T: {T}(T) => T
    return x;
}
```

> **Rationale:** Curly braces avoid conflicts with HTML/JSX contexts and provide a distinct Ety identity while remaining visually clean.

---

## Parser Rules and Ambiguity Resolution

### Distinguishing Generics `{T}` from Object Literals `{ key: value }`

The `{T}` generic syntax could be confused with object literal types `{ key: type }`. The parser uses **positional and structural rules** to disambiguate:

#### Rule 1: Generics Must Precede Function Signatures

Generic type parameters `{T}` must appear **immediately before** an opening parenthesis `(`:

```javascript
// ✅ Generic — {T} followed by (
// T: {T}(T) => T

// ✅ Generic with constraint — {T extends X} followed by (
// T: {T extends string}(T) => T

// ✅ Object literal — has colon after identifier
// T: { name: string, age: number }

// ✅ Object literal as parameter
// T: ({ name: string }) => void
```

#### Rule 2: Object Literals Require Colons

Object literal types **must** contain `identifier: type` pairs:

```javascript
// Object literal: contains "name: string"
// T: { name: string }

// Generic: no colon between { and identifier
// T: {T}(T) => T
```

#### Rule 3: Built-in Generic Types

Known generic type names followed by `{` are parsed as generics:

```javascript
// ✅ Built-in generic types
// T: Map{string, number}
// T: Set{User}
// T: Promise{T}
// T: Array{string}
// T: Partial{User}
// T: Record{string, number}
```

#### Parsing Decision Table

| Pattern | Interpretation | Example |
|---------|----------------|---------|
| `{identifier}(` | Generic | `{T}(T) => T` |
| `{id, id}(` | Multiple generics | `{T, U}(T, U) => void` |
| `{id extends ...}(` | Constrained generic | `{T extends string}(T) => T` |
| `{ id: type }` | Object literal | `{ name: string }` |
| `{ id: type, ... }` | Object literal | `{ x: number, y: number }` |
| `KnownGeneric{...}` | Built-in generic | `Map{string, number}` |

#### Ambiguous Cases (Parser Errors)

The parser will **reject** ambiguous patterns:

```javascript
// ❌ ERROR: Ambiguous — is this generic T or object with property T?
// T: {T}
// Fix: Use context
// T: {T}(T) => T        // Generic
// T: { T: string }      // Object with property named T

// ❌ ERROR: Missing parenthesis after generic
// T: {T} => T
// Fix: Add parenthesis
// T: {T}() => T
```

### Grammar (Simplified BNF)

```bnf
type_comment   ::= "// T:" type_expr
                 | "// type:" type_expr

type_expr      ::= function_type
                 | variable_type
                 | typedef_decl
                 | callback_decl

function_type  ::= [generics] "(" params ")" ["=>" return_type]

generics       ::= "{" generic_list "}"
generic_list   ::= generic_param ("," generic_param)*
generic_param  ::= IDENTIFIER ["extends" type_expr] ["=" type_expr]

params         ::= param ("," param)*
param          ::= [IDENTIFIER ":"] type_expr ["?"]

variable_type  ::= type_expr ["-" description]

object_type    ::= "{" property_list "}"
property_list  ::= property ("," property)*
property       ::= IDENTIFIER ["?"] ":" type_expr ["@readonly"]

generic_type   ::= IDENTIFIER "{" type_args "}"
type_args      ::= type_expr ("," type_expr)*
```

---

## Error Handling and Source Mapping

### Error Message Format

When Ety encounters an error, messages must trace back to the original source:

```
Error: Invalid type syntax
  --> src/services/auth.js:15:5
   |
15 |     // T: {T}(string => User
   |         ^^^^^^^^^^^^^^^^^^^^
   |         Expected ')' after parameter list
```

### Error Categories

| Category | Example | Message |
|----------|---------|---------|
| Syntax Error | `// T: {T}(string =>` | `Expected ')' after parameter list` |
| Unknown Type | `// T: Uzer` | `Unknown type 'Uzer'. Did you mean 'User'?` |
| Missing Import | `// T: (User) => void` | `Type 'User' not found. Add: // T: import User from '...'` |
| Ambiguous Generic | `// T: {T}` | `Ambiguous generic. Use '{T}(...)' for function or '{ T: type }' for object` |
| Invalid Position | `let x = 1; // T: string // T: number` | `Multiple type annotations on same line` |

### Source Maps (line-only)

Because every insertion ety makes is a *whole line* (injected JSDoc, hoisted imports), columns on code lines never shift between the real and virtual documents. The entire source map is therefore two line-number maps held in memory:

- **`vToO`** — virtual line → original line
- **`oToV`** — original line → virtual line

There are no source-map comments, no `mapping.json`, and no generated files. When TypeScript reports a diagnostic at a virtual line, ety looks it up in `vToO` to find the original line. A diagnostic that lands on an *injected* JSDoc line (which has no original counterpart) is remapped onto the nearest `// T:` comment the user can actually edit, so the squiggle always lands on real, editable text.

### IDE Integration

When the TypeScript Language Service reports a type error against the virtual document, ety remaps it back onto the original source before publishing the diagnostic over LSP:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Error Tracing Flow                               │
└─────────────────────────────────────────────────────────────────────────┘

  TS error (virtual doc)          vToO line map           Original Source
  ──────────────────────          ─────────────           ───────────────

  virtual auth.js                 vToO[12] = 15            src/auth.js
  Line 12: Type 'Uzer'    ───────────────────────►        Line 15:
  is not assignable...                                    // T: (string) => Uzer
                                                                           ^^^^
```

---

## Live Updates (LSP)

There is no watch mode, no file watcher, and no regeneration step — those belonged to the removed stub-generation prototype. Because ety is a language server, the editor drives updates through the LSP document lifecycle:

1. **Change detection** — The editor sends `textDocument/didChange` on every keystroke (incremental sync). Ety re-parses and re-projects the affected document in memory; nothing is written to disk.
2. **Debouncing** — Diagnostics are debounced server-side (`DEBOUNCE_MS`, default 200ms in `handlers.js`) so rapid typing coalesces into a single type-check pass.
3. **Error recovery** — A parse or handler error degrades a single request, not the process. `vscode-languageserver` catches handler exceptions and answers a JSON-RPC error, so one bad annotation never crashes the server (a crash loop would brick the editor, since the client only restarts the server a limited number of times).
4. **Open-document scope** — Ety analyzes the documents the editor has open. Imported types resolve only when the file declaring them is also open (v1 limitation; closed files are read raw from disk without their annotations).
5. **Live configuration** — `ety.scriptHosts` changes arrive via `workspace/didChangeConfiguration`; the server re-reads the setting and re-projects every open document so a newly-enabled host takes effect without a restart.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Live Update Flow                                │
└─────────────────────────────────────────────────────────────────────────┘

  LSP event                         ety server                 Action
  ─────────                        ──────────                 ──────

  didChange (user.js)  ──────►   re-parse + re-project ──►   publishDiagnostics
                                 (debounce 200ms)            for user.js (in memory)

  didOpen (new.js)     ──────►   parse + project       ──►   publishDiagnostics

  didClose (old.js)    ──────►   drop virtual doc      ──►   clear diagnostics
                                 + line maps
```

---

## Type Definitions

> ⚠️ **Planned — Milestone 14 / Gate 12 (`typedef`); `callback` still deferred.** Standalone `// T:` declarations bind to no JavaScript AST node, so they need the parser's *node-less* extraction path — the same partition that already emits `import`, `=>` return, and `// T: ignore` annotations from the comment stream before node matching. `typedef` is the next arm of that path (Milestone 14); `callback` (its function-type cousin) follows the identical mechanism and stays deferred until its own milestone. The projections below are the **planned** Milestone 14 output, not present behavior — until it lands, declare shared shapes inline (object types on a variable) or in a real `.d.ts`/JSDoc file.
>
> **Reserved leading word.** After payload normalization, a `// T:` whose first word is `typedef` is a *declaration*, never a type — joining `ignore`/`i` (see [Directives](#directives)) in the reserved set. `callback` will join it when implemented.

### Typedef

```javascript
// T: typedef User = { id: string, name: string, age: number }
// T: typedef ID = string | number
// T: typedef Status = 'pending' | 'active' | 'closed'
```

**Projects to (virtual document, with a synthetic binding hoisted to module scope):**
```javascript
/**
 * @typedef {{ id: string, name: string, age: number }} User
 */
export const User = {};

/**
 * @typedef {string | number} ID
 */
export const ID = {};

/**
 * @typedef {'pending' | 'active' | 'closed'} Status
 */
export const Status = {};
```

The object body is emitted as an **inline object type** (`@typedef {{ … }} Name`) — exactly what `convertGenerics` already produces for an object payload. It type-checks identically to the expanded `@typedef {Object}` + `@property` form, but preserves `readonly`, nests for free, and needs no property-splitting. (`@property` expansion is a possible future formatting option for richer per-property hover.) The synthetic `export const Name = {}` makes the type resolvable across files via `// T: import`; it is **hoisted to module scope** (beside the import hoist), so a `typedef` written inside a function body still emits a legal top-level `export`.

**With optional and readonly properties:**
```javascript
// T: typedef Config = { apiKey: string, timeout?: number, readonly baseUrl: string }
```

**Generates:**
```javascript
/**
 * @typedef {{ apiKey: string, timeout?: number, readonly baseUrl: string }} Config
 */
export const Config = {};
```

> The inline-object form carries `?` (optional) and `readonly` through verbatim — both are valid inside a TypeScript object type. (An earlier draft wrote `@property {string} baseUrl @readonly`, which does **not** work: text after a `@property` name is parsed as the property *description*, not a modifier, so per-property `readonly` is unavailable in the `@property` form. Inline-object emission is what makes `readonly` expressible.)

**With a description** (reusing the ` - ` convention, same as `param`/`type` annotations — no separate `// T: *` continuation line):
```javascript
// T: typedef User = { id: string, name: string, age: number } - A registered user in the system
```

**Generates:**
```javascript
/**
 * A registered user in the system
 * @typedef {{ id: string, name: string, age: number }} User
 */
export const User = {};
```

### Callback

> ⏳ **Deferred (no milestone yet).** `callback` follows the same node-less extraction mechanism as `typedef` (Milestone 14) and will be specified when scheduled. The projections below are illustrative planned syntax, not present behavior.

```javascript
// T: callback OnSuccess = (data: any) => void
// T: callback Comparator = {T}(a: T, b: T) => number
// T: callback Mapper = {T, U}(item: T, index: number) => U
```

**Projects to (virtual document, with synthetic binding):**
```javascript
/**
 * @callback OnSuccess
 * @param {any} data
 * @returns {void}
 */
export const OnSuccess = {};

/**
 * @callback Comparator
 * @template T
 * @param {T} a
 * @param {T} b
 * @returns {number}
 */
export const Comparator = {};

/**
 * @callback Mapper
 * @template T
 * @template U
 * @param {T} item
 * @param {number} index
 * @returns {U}
 */
export const Mapper = {};
```

---

## Import Types

### Full Path (TypeScript JSDoc Syntax)

```javascript
function save(user) {
// T: (import('src/models').User)
    db.insert(user);
}
```

### Shorthand (from)

```javascript
function save(user) {
// T: (User from 'src/models')
    db.insert(user);
}
```

### Standalone Import Alias

```javascript
// T: import User from 'src/models'
// T: import { Config, Options } from 'src/config'
```

> **Note:** Import specifiers are resolved against the real module graph, so relative paths (e.g., `'./models'`) work normally — no baseUrl/`paths` configuration is required. The imported file must be **open** in the editor for its `// T:` annotations to resolve (v1 limitation).
NOTE: class and function/method typing(// T: ) is  below not above defination to avoid collision.
---

## Variables

```javascript
let count = 0;                    // T: number
const name = "";                  // T: string
let items = [];                   // T: string[]
let matrix = [];                  // T: Array{Array{number}}
let map = new Map();              // T: Map{string, number}
let set = new Set();              // T: Set{User}
let weakMap = new WeakMap();      // T: WeakMap{object, string}
let user = {};                    // T: User
let pair = ['key', 42];           // T: [string, number]
let lookup = {};                  // T: Record{string, number}
```

**With descriptions:**
```javascript
let count = 0;  // T: number - Current item count
```

**Projects to (virtual document):**
```javascript
/**
 * Current item count
 * @type {number}
 */
export let count;
```

---

## Functions

### Signature Style

**Positional:**
```javascript
function add(a, b) {
// T: (number, number) => number
    return a + b;
}
```

**Named:**
```javascript
function add(a, b) {
// T: (a: number, b: number) => number
    return a + b;
}
```

**Void return (explicit):**
```javascript
function logMessage(msg) {
    // T: (string) => void
    console.log(msg);
}
```

**Void return (shorthand):**
```javascript
function logMessage(msg) {
// T: (string)
    console.log(msg);
}
```

> **Note:** When no return type is specified (e.g., `(string)`), `=> void` is implied.

**With description:**
```javascript
function add(a, b) {
// T: (number, number) => number
// T: * Adds two numbers together
    return a + b;
}
```

**Projects to (virtual document):**
```javascript
/**
 * Adds two numbers together
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function add(a, b) {}
```

### Per-Parameter Style

```javascript
function add(
    a,  // T: number - First operand
    b   // T: number - Second operand
) {
    return a + b;  // T: => number
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {number} a - First operand
 * @param {number} b - Second operand
 * @returns {number}
 */
export function add(a, b) {}
```

### Arrow Functions

```javascript
const add = (a, b) => a + b;  // T: (number, number) => number
const greet = (name) => `Hello ${name}`;  // T: (string) => string
```

**Projects to (virtual document) — preserves const declaration:**
```javascript
/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const add = (a, b) => {};

/**
 * @param {string} name
 * @returns {string}
 */
export const greet = (name) => {};
```

### Default Exports

```javascript
export default function calculate(x) {
// T: (number) => number
    return x * 2;
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {number} x
 * @returns {number}
 */
export default function calculate(x) {}
```

**Arrow function default export:**
```javascript
const handler = (req, res) => { ... };  // T: (Request, Response) => void
export default handler;
```

**Projects to (virtual document):**
```javascript
/**
 * @param {Request} req
 * @param {Response} res
 * @returns {void}
 */
const handler = (req, res) => {};
export default handler;
```

### Rest Parameters

```javascript
function sum(...nums) {
// T: (...number[]) => number
    return nums.reduce((a, b) => a + b, 0);
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {...number} nums
 * @returns {number}
 */
export function sum(...nums) {}
```

### Optional Parameters

Use `?` suffix. Optional means the parameter may be `undefined`.

```javascript
function greet(name, times) {
// T: (string, number?) => string
    return name.repeat(times ?? 1);
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {string} name
 * @param {number} [times]
 * @returns {string}
 */
export function greet(name, times) {}
```

### Default Parameters

```javascript
function greet(name, times = 1) {
    // T: (string, number = 1) => string
    return name.repeat(times);
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {string} name
 * @param {number} [times=1]
 * @returns {string}
 */
export function greet(name, times) {}
```

### Destructured Parameters

```javascript
function process({ name, age }) {
// T: ({ name: string - Display name,
// T: age: number - Age in years })
    console.log(name, age);
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {Object} param0
 * @param {string} param0.name - Display name
 * @param {number} param0.age - Age in years
 */
export function process({ name, age }) {}
```

**With optional properties and defaults:**
```javascript
function process({ name, age = 18 }) {
// T: ({ name: string, age?: number })
    console.log(name, age);
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {Object} param0
 * @param {string} param0.name
 * @param {number} [param0.age]
 */
export function process({ name, age }) {}
```

### Async Functions

`Promise{T}` wrapper is implicit for async functions:

```javascript
async function fetchUser(id) {
// T: (number) => User
    return api.get(`/users/${id}`);
}
```

**Projects to (virtual document):**
```javascript
/**
 * @param {number} id
 * @returns {Promise<User>}
 */
export async function fetchUser(id) {}
```

**Explicit Promise (also valid):**
```javascript
async function fetchUser(id) {
// T: (number) => Promise{User}
    return api.get(`/users/${id}`);
}
```

> **Note:** The `@async` JSDoc tag is omitted as it has no effect on type checking. The `Promise<>` wrapper in `@returns` is sufficient.

### Generics

```javascript
function identity(x) {
// T: {T}(T) => T
    return x;
}
```

**Projects to (virtual document):**
```javascript
/**
 * @template T
 * @param {T} x
 * @returns {T}
 */
export function identity(x) {}
```

**Multiple type parameters:**
```javascript
function pair(a, b) {
// T: {T, U}(T, U) => [T, U]
    return [a, b];
}
```

**Projects to (virtual document):**
```javascript
/**
 * @template T
 * @template U
 * @param {T} a
 * @param {U} b
 * @returns {[T, U]}
 */
export function pair(a, b) {}
```

**With constraints:**
```javascript
function longest(a, b) {
    // T: {T extends { length: number }}(T, T) => T
    return a.length >= b.length ? a : b;
}

function getProperty(obj, key) {
// T: {T, K extends keyof T}(T, K) => T[K]
    return obj[key];
}
```

**Projects to (virtual document):**
```javascript
/**
 * @template {{ length: number }} T
 * @param {T} a
 * @param {T} b
 * @returns {T}
 */
export function longest(a, b) {}

/**
 * @template T
 * @template {keyof T} K
 * @param {T} obj
 * @param {K} key
 * @returns {T[K]}
 */
export function getProperty(obj, key) {}
```

**Generic with default:**
```javascript
function createArray(length, value) {
// T: {T = string}(number, T) => T[]
    return Array(length).fill(value);
}
```

**Projects to (virtual document):**
```javascript
/**
 * @template [T=string]
 * @param {number} length
 * @param {T} value
 * @returns {T[]}
 */
export function createArray(length, value) {}
```

### This Context

```javascript
function onClick(event) {
// T: (event: MouseEvent)
// T: @this: HTMLElement
    console.log(this.id); 
}
```

**Projects to (virtual document):**
```javascript
/**
 * @this {HTMLElement}
 * @param {MouseEvent} event
 * @returns {void}
 */
export function onClick(event) {}
```

---

## Class 

```javascript

class User {
// T: * Represents a system user    
    name;  // T: string - Display name
    id;    // T: string @readonly - Unique identifier
    
    constructor(name) {
    // T: (string)
        this.name = name;
        this.id = crypto.randomUUID();
    }
    
    greet() {
    // T: () => string
    // T: * Returns a greeting message
        return `Hello, ${this.name}`;
    }
    
    static create(data) {
    // T: (Partial{User}) => User
        return new User(data.name);
    }
}
```

**Projects to (virtual document):**
```javascript
/**
 * Represents a system user
 */
export class User {
    /**
     * Display name
     * @type {string}
     */
    name;
    
    /**
     * Unique identifier
     * @type {string}
     * @readonly
     */
    id;
    
    /**
     * @param {string} name
     */
    constructor(name) {}
    
    /**
     * Returns a greeting message
     * @returns {string}
     */
    greet() {}
    
    /**
     * @param {Partial<User>} data
     * @returns {User}
     */
    static create(data) {}
}
```

### Class Inheritance

```javascript

class Admin extends User {
// T: * Administrator with elevated permissions

    permissions;  // T: string[] - Granted permissions
    
    constructor(name, permissions) {
        // T: (string, string[])
        super(name);
        this.permissions = permissions;
    }
    
    grant(permission) {
        // T: (string)
        this.permissions.push(permission);
    }
}
```

**Projects to (virtual document):**
```javascript
/**
 * Administrator with elevated permissions
 * @extends User
 */
export class Admin extends User {
    /**
     * Granted permissions
     * @type {string[]}
     */
    permissions;
    
    /**
     * @param {string} name
     * @param {string[]} permissions
     */
    constructor(name, permissions) {
        super();
    }
    
    /**
     * @param {string} permission
     * @returns {void}
     */
    grant(permission) {}
}
```

> **Critical:** Derived class constructors must include `super()` call in stubs to be valid JavaScript. The tool automatically injects `super();` into any constructor of a class that extends another class.

### Generic Classes

```javascript

class Box {
// T: * A generic container class
// T: @template T
    value;  // T: T
    
    constructor(value) {
        // T: (T)
        this.value = value;
    }
    
    map(fn) {
        // T: {U}((T) => U) => Box{U}
        return new Box(fn(this.value));
    }
}
```

**Projects to (virtual document):**
```javascript
/**
 * A generic container class
 * @template T
 */
export class Box {
    /**
     * @type {T}
     */
    value;
    
    /**
     * @param {T} value
     */
    constructor(value) {}
    
    /**
     * @template U
     * @param {function(T): U} fn
     * @returns {Box<U>}
     */
    map(fn) {}
}
```

### Interface Implementation

```javascript

class Resource {
// T: * @implements {Disposable}
    dispose() {
        // T: ()
        cleanup();
    }
}
```

**Projects to (virtual document):**
```javascript
/**
 * @implements {Disposable}
 */
export class Resource {
    /**
     * @returns {void}
     */
    dispose() {}
}
```

### Readonly Properties

```javascript
class Config {
    apiKey;   // T: string @readonly  - API authentication key
    baseUrl;  // T: string @readonly  - Base URL for requests
}
```

**Projects to (virtual document):**
```javascript
export class Config {
    /**
     * API authentication key
     * @type {string}
     * @readonly
     */
    apiKey;
    
    /**
     * Base URL for requests
     * @type {string}
     * @readonly
     */
    baseUrl;
}
```

---

## Enums

```javascript
const Roles = {
    Admin: 1,
    User: 0
};  // T: enum number - User permission levels
```

**Projects to (virtual document, values retained):**
```javascript
/**
 * User permission levels
 * @enum {number}
 */
export const Roles = {
    Admin: 1,
    User: 0
};
```

**String enum:**
```javascript
const Status = {
    Pending: 'pending',
    Active: 'active',
    Closed: 'closed'
};  // T: enum string
```

**Projects to (virtual document):**
```javascript
/**
 * @enum {string}
 */
export const Status = {
    Pending: 'pending',
    Active: 'active',
    Closed: 'closed'
};
```

> **Note:** Enum values are retained in the stub for reference. The `@enum` tag provides type checking but does not enforce values at runtime.

---

## Type Casting

### Variable Declaration (Recommended)

For declaring a variable with a specific type, annotate the binding. The type narrows the declared variable, which is the recommended way to assert a cast:

```javascript
const input = document.getElementById('name');  // T: HTMLInputElement
```

**Virtual document (JSDoc injected):**
```javascript
/** @type {HTMLInputElement} */
const input = document.getElementById('name');
```

### Inline Cast (deferred)

A future inline-assertion form using the `as` keyword is planned:

```javascript
const input = document.getElementById('name');  // T: as HTMLInputElement
```

> **Deferred.** True inline casts (`/** @type {HTMLInputElement} */ (expr)`) require rewriting *inside* a line, which breaks ety's line-only/immutable-source invariants. They are **not implemented** — use the variable-declaration form above. If an autofix that edits the real file is ever added, it would be an explicit, opt-in code action, not part of the live virtual-document overlay.

---

## Barrel Exports (Re-exports)

Barrel files (`index.js`) that re-export from other modules are fully supported. Re-export statements are left **verbatim** in the virtual document and resolved against the real module graph — there is no specifier rewriting.

### Export All

```javascript
export * from './user';
export * from './auth';
```

**Virtual document (unchanged):**
```javascript
export * from './user';
export * from './auth';
```

### Named Re-exports

```javascript
export { User, createUser } from './user';
export { authenticate as auth } from './auth';
```

**Virtual document (unchanged):**
```javascript
export { User, createUser } from './user';
export { authenticate as auth } from './auth';
```

### Mixed Barrel

```javascript
// T: typedef PublicAPI = { version: string }

export * from './user';
export { Auth } from './auth';
export const VERSION = '1.0.0';  // T: string
```

**Virtual document (JSDoc injected; re-exports untouched):**
```javascript
/**
 * @typedef {{ version: string }} PublicAPI
 */
export const PublicAPI = {};

export * from './user';
export { Auth } from './auth';

/** @type {string} */
export const VERSION = '1.0.0';
```

---

## Directives

```javascript
let legacy = getConfig();  // T: ignore


// T: ignore-start
let a = foo();
let b = bar();
// T: ignore-end
```

---

## Embedded Host Documents (`<script>` tags)

`// T:` annotations are not limited to `.js`/`.jsx` source — Ety also processes the
JavaScript inside `<script>` blocks of **host documents**. `.html` is supported by
default; the server-side template formats `.jsp`, `.aspx`, `.tpl`, and `.ftl` are
**opt-in** (the static parts of their `<script>` bodies are JavaScript, but they also
interleave template expressions that are not, so they ship behind the `scriptHosts`
setting rather than on by default).

| Host | Support | Notes |
|------|---------|-------|
| `.html` | ✅ Core | `<script>` bodies are plain JavaScript |
| `.jsp` / `.aspx` / `.tpl` / `.ftl` | Opt-in (`scriptHosts`) | in-script template expressions are neutralized before analysis |

```html
<!-- index.html -->
<!DOCTYPE html>
<html>
  <body>
    <div id="app"></div>
    <script type="module">
      let count = 0;            // T: number
      const cache = new Map();  // T: Map{string, User}

      count = "oops";          // ← squiggles here, on this real HTML line
    </script>
  </body>
</html>
```

**What is and isn't analyzed:**

- **Only `<script>` … `</script>` bodies** whose type is JavaScript (`type="module"`,
  `type="text/javascript"`, or no `type`). The host markup itself is opaque.
- **Ignored:** inline event-handler attributes (`onclick="…"`), `<script src="…">`
  with no body, and non-JS script types (`application/json`, `importmap`, `text/template`).
- **HTML5 raw-text rule:** a script body ends at the first `</script`, even when it
  appears inside a JavaScript string — `const s = "</script>"` closes the element.

**Position fidelity (line- and column-parallel).** Ety analyzes a projection of the
host that keeps every `<script>` line byte-for-byte (indentation included) and blanks
everything outside script bodies. Because line *and* column are preserved, diagnostics
and hovers map onto the **original host file** unchanged — a type error squiggles its
real `.html` line, not the `<script>` tag or the `// T:` comment.

**Template expressions in opt-in formats.** For `.jsp`/`.aspx`/`.tpl`/`.ftl`, recognized
server-side delimiters that appear *inside* a script body (`${…}`, `<%…%>`, `<%=…%>`,
`<#…>`, `[#…]`) are replaced with width-preserving inert filler before analysis, so the
static JavaScript still type-checks without the template language itself being typed.

**Configuration.** The recognized host extensions are controlled by `scriptHosts`
(default `["html"]`); add the template extensions to enable them:

```json
{ "scriptHosts": ["html", "jsp", "aspx", "tpl", "ftl"] }
```

---

## Description Syntax

**Standalone description (functions, classes, typedefs):**
```javascript
function calculate(x) {
// T: (number) => number
// T: * Calculates using complex formula
// T: @deprecated: Use calculateV2 instead
// T: @throws: Error - When x is negative
// T: @see: calculateV2
    return x * 2;
}
```

**Projects to (virtual document):**
```javascript
/**
 * Calculates using complex formula
 * @param {number} x
 * @returns {number}
 * @deprecated Use calculateV2 instead
 * @throws {Error} When x is negative
 * @see calculateV2
 */
export function calculate(x) {}
```

**Inline description (parameters, properties, variables):**
```javascript
let count = 0;  // T: number - Current count
```
NOTE: * Vs -  // T * Heading vs // T: number - Current count "-" is inline comment description

### Supported JSDoc Tags in Descriptions

| Tag | Usage |
|-----|-------|
| `@deprecated: message` | Mark as deprecated with optional message |
| `@throws: ErrorType` | Document thrown exceptions |
| `@see` | Reference related symbols or URLs |
| `@link` | Inline link to symbol or URL |
| `@example` | Code example (multiline supported) |
| `@since` | Version when added |
| `@version` | Current version |
| `@author` | Author information |
| `@private` | Mark as private |
| `@protected` | Mark as protected |
| `@public` | Mark as public |

**Tag ordering in generated JSDoc:**
1. Description
2. `@template`
3. `@this`
4. `@param`
5. `@returns`
6. `@throws {Error}`
7. `@deprecated`
8. `@see`
9. Other tags

---

## Type Syntax Reference

### Primitives

| Type | Syntax | Example |
|------|--------|---------|
| String | `string` | `// T: string` |
| Number | `number` | `// T: number` |
| Boolean | `boolean` | `// T: boolean` |
| Null | `null` | `// T: null` |
| Undefined | `undefined` | `// T: undefined` |
| Symbol | `symbol` | `// T: symbol` |
| BigInt | `bigint` | `// T: bigint` |
| Any | `any` or `*` | `// T: any` |
| Unknown | `unknown` | `// T: unknown` |
| Never | `never` | `// T: never` |
| Void | `void` | `// T: () => void` |

### Arrays

| Type | Syntax | Example |
|------|--------|---------|
| Array (shorthand) | `T[]` | `// T: string[]` |
| Array (generic) | `Array{T}` | `// T: Array{string}` |
| Nested array | `T[][]` or `Array{Array{T}}` | `// T: number[][]` |
| Readonly array | `T[] @readonly` | `// T: string[] @readonly ` |

### Objects

| Type | Syntax | Example |
|------|--------|---------|
| Object literal | `{ key: type }` | `// T: { name: string }` |
| Optional property | `{ key?: type }` | `// T: { name?: string }` |
| Readonly property | `{  key: type @readonly }` | `// T: { id: string @readonly }` |
| Index signature | `{ [key: string]: type }` | `// T: { [key: string]: number }` |
| Record | `Record{K, V}` | `// T: Record{string, number}` |

### Built-in Generics

| Type | Syntax | Example |
|------|--------|---------|
| Array | `Array{T}` | `// T: Array{string}` |
| Map | `Map{K, V}` | `// T: Map{string, number}` |
| Set | `Set{T}` | `// T: Set{User}` |
| WeakMap | `WeakMap{K, V}` | `// T: WeakMap{object, string}` |
| WeakSet | `WeakSet{T}` | `// T: WeakSet{object}` |
| Promise | `Promise{T}` | `// T: Promise{User}` |
| Record | `Record{K, V}` | `// T: Record{string, number}` |
| Partial | `Partial{T}` | `// T: Partial{User}` |
| Required | `Required{T}` | `// T: Required{Config}` |
| Readonly | `Readonly{T}` | `// T: Readonly{User}` |
| Pick | `Pick{T, K}` | `// T: Pick{User, 'id' \| 'name'}` |
| Omit | `Omit{T, K}` | `// T: Omit{User, 'password'}` |

### Unions & Intersections

| Type | Syntax | Example |
|------|--------|---------|
| Union | `A \| B` | `// T: string \| number` |
| Intersection | `A & B` | `// T: Named & Aged` |
| Nullable | `T \| null` | `// T: string \| null` |
| Optional (param) | `T?` | `// T: (string, number?) => void` |

### Tuples

| Type | Syntax | Example |
|------|--------|---------|
| Tuple | `[T, U]` | `// T: [string, number]` |
| Named tuple | `[name: T, age: U]` | `// T: [name: string, age: number]` |
| Rest in tuple | `[T, ...U[]]` | `// T: [string, ...number[]]` |

### Literals

| Type | Syntax | Example |
|------|--------|---------|
| String literal | `'value'` | `// T: 'click' \| 'hover'` |
| Number literal | `123` | `// T: 1 \| 2 \| 3` |
| Boolean literal | `true` / `false` | `// T: true` |
| Template literal | `` `prefix${T}` `` | `// T: \`on${string}\`` |

### Functions

| Type | Syntax | Example |
|------|--------|---------|
| Function type | `(params) => return` | `// T: (number) => string` |
| Void function | `(params)` or `(params) => void` | `// T: (string)` |
| Generic function | `{T}(T) => T` | `// T: {T}(T) => T` |
| With constraint | `{T extends U}(T) => T` | `// T: {T extends string}(T) => T` |
| Multiple generics | `{T, U}(T, U) => [T, U]` | `// T: {T, U}(T, U) => [T, U]` |

### Imports

| Type | Syntax | Example |
|------|--------|---------|
| Import type | `import('path').Type` | `// T: import('src/models').User` |
| Import shorthand | `Type from 'path'` | `// T: User from 'src/models'` |

### Optional vs Nullable

| Syntax | Meaning | Generated JSDoc |
|--------|---------|-----------------|
| `number?` | Optional (may be undefined) | `@param {number} [x]` |
| `number \| null` | Nullable (may be null) | `@param {number \| null} x` |
| `number \| undefined` | Explicitly undefined | `@param {number \| undefined} x` |
| `x?: number` (in typedef body) | Optional property | preserved inline: `@typedef {{ x?: number }}` |

> **Alignment with TypeScript:** The `?` modifier indicates optional (undefined), not nullable. Use explicit `| null` for nullable types.

---

## Output Strategy: In-Memory Virtual Document

Ety produces no files. For each open source document it constructs a **virtual document** in memory: a copy of your source with JSDoc lines inserted *above* each annotated node (and `// T: import` lines hoisted to the top). That virtual document — never your real file — is what the TypeScript Language Service type-checks.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Virtual Document (in memory)                       │
└─────────────────────────────────────────────────────────────────────────┘

   REAL SOURCE (on disk, untouched)        VIRTUAL DOCUMENT (in memory only)
   ─────────────────────────────────       ─────────────────────────────────

   src/models/user.js                       (virtual) src/models/user.js
   // T: typedef User = {...}        ──►     /** @typedef {{...}} User */
                                             ... User declarations ...

   src/services/auth.js                      (virtual) src/services/auth.js
   function login(name) {            ──►     /** @param {string} name */
   // T: (string) => User                    function login(name) {

   Key Points:
   ───────────
   • No -ty.jsdoc.js stubs, no .types/ directory — nothing is written.
   • Inserted lines are whole lines, so code columns never shift.
   • A vToO / oToV line map ties each virtual line to its real line.
   • Imports are resolved against the real module graph, not rewritten.
```

### Virtual Document Projection Rules

Each source construct projects to JSDoc + a declaration in the virtual document (the source itself is never modified):

| Source Construct | Virtual-Document Projection |
|------------------|-----------------------------|
| `function name(params) { ... }` | JSDoc block + `function name(params) { ... }` |
| `export default function name(params) { ... }` | JSDoc block + `export default function name(...)` |
| `const fn = (params) => ...` | JSDoc block above the `const` declaration |
| `let fn = (params) => ...` | JSDoc block above the `let` declaration |
| `class Name { ... }` | JSDoc block per class/method/property |
| `class Child extends Parent { ... }` | JSDoc block; `super()` semantics preserved from the real source |
| `const x = value` / `let x = value` | `/** @type {…} */` above the declaration |
| `// T: typedef Name = ...` | JSDoc `@typedef {{...}}` + a synthetic `export const Name` binding, hoisted to module scope (Milestone 14) |
| `// T: callback Name = ...` | JSDoc `@callback` + a synthetic `const Name` binding (deferred) |
| `const ENUM = { ... }` (with `// T: enum`) | `/** @enum {…} */` above the object (values retained) |
| `export * from './path'` | left as-is; resolved against the real module graph |
| `export { A, B } from './path'` | left as-is; resolved against the real module graph |

> Synthetic parameter names are supplied where a positional signature omits them — `(number) => number` projects as `(p0: number) => number`. You never see this; it lives only in the virtual document.

### Generic Syntax Transformation

Ety uses `{T}` syntax, which the transformer rewrites to JSDoc's `<T>` in the virtual document:

| Ety Syntax | Virtual-Document JSDoc |
|------------|------------------------|
| `Map{string, number}` | `Map<string, number>` |
| `Set{User}` | `Set<User>` |
| `Promise{T}` | `Promise<T>` |
| `{T}(T) => T` | `@template T` + `@param {T}` + `@returns {T}` |
| `{T extends string}` | `@template {string} T` |

### Imports

`// T: import` annotations are hoisted to the top of the virtual document and resolved against the **real module graph** — there is no stub-sibling rewriting, no `.types/` path, and no `jsconfig.json` `paths` mapping. Plain JavaScript `import`/`export` statements are left exactly as written.

```javascript
// T: import { User, Role } from './types'
```

Because resolution follows the real files, relative imports work normally; you do **not** need baseUrl-relative specifiers.

> **v1 limitation — imported files must be open.** Types from another module resolve only when that file is also open in the editor. Closed files are read raw from disk *without* their `// T:` annotations, so a hover on an imported symbol may come up empty until you open the file that declares it. (v2 plans *transform-on-read* to lift this.)

> **No project configuration needed.** There is no `jsconfig.json`/`deno.json` `paths` setup and nothing to add to `.gitignore` — ety writes nothing, so there is nothing to ignore.

---

## Running ety

Ety has **no standalone CLI** — there is nothing to `generate`, `clean`, `inject`, or `watch`, because nothing is written to disk. Ety is a language server launched by an editor plugin over LSP. Installing the plugin for your editor is all that is required:

| Editor | Distribution |
|--------|--------------|
| VS Code | `client/ety-client-0.0.1.vsix` — *Extensions: Install from VSIX…* |
| JetBrains (IntelliJ, WebStorm, PyCharm) | `client-jetbrains/build/distributions/ety-jetbrains-0.0.1.zip` — *Install Plugin from Disk…* |
| Neovim | Install the `client-neovim` directory via your plugin manager (e.g. `lazy.nvim`) |

Once the plugin is active, open any `.js`/`.jsx` file (or a configured `<script>` host) and ety attaches automatically — diagnostics and hovers appear live as you type, including on unsaved `untitled:` buffers.

> **Building from source.** The repo is an npm-workspaces monorepo (`crates/ety-parser`, `server`, `client`). `npm run build:parser` compiles the Rust napi addon, `npm test` runs the Node suite, and `npm run test:e2e` launches a real VS Code against `fixtures/workspace/`. See the README for the full developer workflow.

---

## Configuration

Ety is configured through **LSP settings** delivered by the editor (e.g. VS Code's `settings.json` under the `ety.*` namespace), not a project config file. There is no `Ety.config.json`, and no output/watch/runtime settings exist (ety writes nothing and has no watcher or runtime targets).

| Setting | Type | Default | Effect |
|---------|------|---------|--------|
| `ety.scriptHosts` | `string[]` | `["html"]` | Host document extensions whose `<script>` bodies ety analyzes. Add `"jsp"`, `"aspx"`, `"tpl"`, `"ftl"` to opt those template formats in. |

```json
// VS Code settings.json
{
  "ety.scriptHosts": ["html", "jsp", "aspx", "tpl", "ftl"]
}
```

The setting is read at `initialize` and kept live via `workspace/didChangeConfiguration`: changing it re-projects every open document immediately. Attaching a *new* file type still requires a window reload, because the client's document selector is fixed per session.

---

## Complete Example

**Source:** `src/models/user.js`
```javascript
// T: typedef User = { id: string, name: string, email: string, role: Role } - A registered user in the system

// T: typedef Role = 'admin' | 'user' | 'guest' - User permission level

// T: callback OnUserChange = (user: User, prev: User | null) => void
// T: * Called when user data changes
```

> ⚠️ **Current behavior:** `typedef` is [planned for Milestone 14](#type-definitions) and `callback` is deferred — neither is implemented yet. These standalone `// T:` lines bind to no JavaScript node, so the parser currently emits **no annotations** and the virtual document is **byte-for-byte identical to the source above** — `User`, `Role`, and `OnUserChange` do not resolve yet, and the imports of them in `user-service.js` below would be unresolved. The block below shows the *planned* Milestone 14 projection for the `typedef`s (and the deferred shape for the `callback`).

**Planned virtual document for `src/models/user.js`** (`typedef` per Milestone 14; `callback` deferred):
```javascript
/**
 * A registered user in the system
 * @typedef {{ id: string, name: string, email: string, role: Role }} User
 */
export const User = {};

/**
 * User permission level
 * @typedef {'admin' | 'user' | 'guest'} Role
 */
export const Role = {};

/**
 * Called when user data changes
 * @callback OnUserChange
 * @param {User} user
 * @param {User | null} prev
 * @returns {void}
 */
const OnUserChange = {};
```

---

**Source:** `src/services/user-service.js`
```javascript
// T: import User, Role, OnUserChange from 'src/models/user'

const subscribers = new Set();  // T: Set{OnUserChange}

function createUser(name, email, role) {
// T: (name: string, email: string, role?: Role) => User
// T: * Creates a new user with the given details
// T: @throws: Error - If email is invalid
    return {
        id: crypto.randomUUID(),
        name,
        email,
        role: role ?? 'user'
    };
}

async function fetchUser(id) {
// T: (string) => User | null
    return api.get(`/users/${id}`);
}

function updateUsers(users, transform) {
// T: {T extends User}(T[], (T) => T) => T[]
    return users.map(transform);
}

export { createUser, fetchUser, updateUsers };
```

**Virtual document for `src/services/user-service.js`** (import hoisted to the top; JSDoc injected above each node; **real bodies preserved**):
```javascript
import { User, Role, OnUserChange } from 'src/models/user';

/**
 * @type {Set<OnUserChange>}
 */
const subscribers = new Set();

/**
 * Creates a new user with the given details
 * @param {string} name
 * @param {string} email
 * @param {Role} [role]
 * @returns {User}
 * @throws {Error} If email is invalid
 */
function createUser(name, email, role) {
    return {
        id: crypto.randomUUID(),
        name,
        email,
        role: role ?? 'user'
    };
}

/**
 * @param {string} id
 * @returns {Promise<User | null>}
 */
async function fetchUser(id) {
    return api.get(`/users/${id}`);
}

/**
 * @template {User} T
 * @param {T[]} users
 * @param {function(T): T} transform
 * @returns {T[]}
 */
function updateUsers(users, transform) {
    return users.map(transform);
}

export { createUser, fetchUser, updateUsers };
```

> The injected JSDoc lines are *additive* — every original line keeps its column positions, so a diagnostic on, say, the `return` inside `createUser` maps straight back to the same line in the real file.

---

**Source:** `src/index.js` (Barrel)
```javascript
export * from './models/user';
export * from './services/user-service';
export { default as config } from './config';
```

**Virtual document for `src/index.js` (re-exports left verbatim):**
```javascript
export * from './models/user';
export * from './services/user-service';
export { default as config } from './config';
```

---

## Unsupported Features

The following features are explicitly **not supported** in Ety v0.2:

| Feature | Reason |
|---------|--------|
| Method overloads | Complex to express in comment syntax; use union types |
| Conditional types | Too complex for lightweight annotation |
| Mapped types | Use explicit typedef instead |
| `infer` keyword | Not expressible in JSDoc |
| CommonJS | ESM only; use `import`/`export` |

---

## Summary

| Feature | Support |
|---------|---------|
| Primitives | ✅ |
| Arrays | ✅ (`T[]` and `Array{T}`) |
| Built-in generics | ✅ (`Map{K,V}`, `Set{T}`, `Promise{T}`, etc.) |
| Generic constraints | ✅ (`{T extends U}`) |
| Objects & Records | ✅ |
| Optional properties | ✅ |
| Create properties | ✅ |
| Unions & Intersections | ✅ |
| Nullable | ✅ |
| Tuples | ✅ |
| Functions (all styles) | ✅ |
| Arrow functions | ✅ (preserves const/let) |
| Default exports | ✅ |
| Async/Await | ✅ (implicit Promise) |
| Classes | ✅ |
| Generic classes | ✅ |
| Class inheritance | ✅ (with super() in stubs) |
| Interface implementation | ✅ |
| Typedef | ⏳ Planned (Milestone 14 / Gate 12) |
| Callback | ⏳ Planned (deferred — no milestone yet) |
| Enum | ✅ (values retained) |
| Type imports | ✅ (rewritten in stubs) |
| Barrel exports | ✅ (export *, export {}) |
| Embedded `<script>` JS | ✅ (`.html` default; `.jsp`/`.aspx`/`.tpl`/`.ftl` opt-in via `scriptHosts`) |
| Descriptions | ✅ |
| JSDoc tags | ✅ (@deprecated, @throws, @see, etc.) |
| Inline casts | ⏳ Deferred (breaks line-only invariant) |
| Node.js ESM | ✅ |
| Bun | ✅ |
| Deno | ✅ |

---

## Benefits

1. **Zero Source Clutter** — Source files contain only code and minimal type comments
2. **Zero Artifacts** — No `.types/` directory, no stub files, nothing to ignore or clean up
3. **No Runtime Risk** — The real file runs as-is; types live only in the in-memory virtual document
4. **Full IDE Support** — A language server provides live diagnostics and hovers directly
5. **Immutable Source** — Your bytes are never edited; the overlay is whole-line and reversible
6. **No Configuration** — No `jsconfig.json`/`deno.json` `paths` setup required
7. **JSDoc and TypeScript Aligned** — Semantics match JSDoc and TypeScript conventions
8. **Barrel Support** — Re-exports work seamlessly, resolved against the real module graph
9. **Distinct Syntax** — `{T}` generic syntax is unique to Ety, avoiding HTML/JSX conflicts
10. **Multi-Editor** — VS Code, JetBrains, and Neovim plugins over one LSP server
11. **Error Traceability** — Errors map back to original `// T:` source locations

---

## Changelog

### v0.2.0

- **Architecture pivot — LSP, not transpilation.** Ety is now a language server that builds an **in-memory virtual document** and hands it to the TypeScript Language Service, mapping results back to the real source. The prior stub-generation model was removed.
- **Removed:** the `.types/` shadow directory, `-ty.jsdoc.js` stub files, import-specifier rewriting, the `jsconfig.json`/`deno.json` `paths` requirement, and the `Ety generate`/`clean`/`inject`/`init` CLI.
- **Removed:** watch mode and the file watcher — updates are driven live by the LSP document lifecycle (incremental sync, server-side debounce).
- Rewrote **Overview**, **Output Strategy** (now *In-Memory Virtual Document*), **Source Maps** (now two line-number maps `vToO`/`oToV`), and **Live Updates**.
- **Configuration** is now LSP settings (`ety.*`), not `Ety.config.json`; the only setting is `ety.scriptHosts`.
- Distributed as editor plugins: VS Code, JetBrains, and Neovim.
- Inline `as` casts marked **deferred** (incompatible with the line-only/immutable-source invariants).
- Documented that `typedef` and `callback` are **not yet implemented** — the parser binds annotations only to real AST nodes, and standalone `// T:` declarations are not emitted. Their sections now describe planned syntax.
- **`typedef` planned design pinned to Milestone 14 / Gate 12.** The projection now uses an **inline object type** (`@typedef {{ … }} Name`, not `@typedef {Object}` + `@property`), so `readonly` and nesting carry through verbatim; descriptions reuse the existing ` - ` convention (not a `// T: *` continuation line); the synthetic `export const Name` binding is hoisted to module scope; and `typedef` is a reserved leading word alongside `ignore`/`i`. The invalid per-property `@readonly` form was corrected. `callback` remains deferred and follows the same node-less mechanism.

### v0.1.3

- Added Embedded Host Documents support — `// T:` annotations inside `<script>` blocks
- `.html` supported by default; `.jsp`/`.aspx`/`.tpl`/`.ftl` opt-in via `scriptHosts`
- Added `scriptHosts` configuration option (default `["html"]`)

### v0.1.2

- Added "When to Use Ety" decision guide
- Added Parser Rules and Ambiguity Resolution section
- Added Grammar specification (BNF)
- Added Error Handling and Source Mapping section
- Added Watch Mode Reliability requirements
- Added `Ety check` command for syntax validation
- Added `Ety.config.json` configuration file support
- Added `--strict` and `--config` CLI options

### v0.1.1

- **Breaking Change:** Generic syntax changed from `<T>` to `{T}`
  - Avoids HTML/JSX conflicts
  - Provides distinct Ety identity
  - All built-in generics now use `{T}`: `Map{K,V}`, `Set{T}`, `Promise{T}`, etc.
- Added comprehensive Type Syntax Reference with all categories
- Added generic class support with `@template` on class
- Added generic default syntax: `{T = string}`
- Added Generic Syntax Transformation table
- Documented all built-in generic utility types (`Partial{T}`, `Pick{T,K}`, etc.)
- Added tuple syntax including named and rest tuples
- Added template literal type syntax
- Added Deno runtime configuration support
- Added multi-runtime CLI options (`--runtime node|deno`)
- ESM-only (removed CommonJS references)

### v0.1.0

- Added `super()` call in derived class constructor stubs
- Added barrel export support (`export *`, `export { } from`)
- Added transpilation pipeline diagram
- Added shadow directory concept diagram
- Added import resolution flow diagram

### v0.0.1

- Initial specification
- Core type annotation syntax
- Shadow directory output strategy
- JSDoc stub generation

---


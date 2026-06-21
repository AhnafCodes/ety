

# //T or EcmaScript Type Comments Specification(ety)

**Version:** 0.1.2  
**Status:** Draft



## Why //T or jty?

//T or typ2  brings type safety to JavaScript with minimal syntax. Compare traditional JSDoc with jty's `//T` comments:

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
| IDE support | Native | Via generated stubs |
| Learning curve | Moderate | Low (TypeScript-like) |

---

### When to Use //T or jty

//T or jty is ideal when you:

| Scenario | jty Fit |
|----------|---------|
| Find JSDoc too verbose | ✅ Excellent |
| Need IDE intellisense for JS | ✅ Excellent |
| Can run a generator/watcher | ✅ Required |
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

Ety (also `//T`) is a lightweight type annotation syntax using trailing comments (inspired by [Python Type Comments](https://typing.python.org/en/latest/guides/modernizing.html#type-comments)) that generates JSDoc stub files. It provides a minimal type authoring format while generating type-only stub files in a shadow `.types/` directory for IDE intellisense.

**Key Principle:** No transpilation of JS code—only watching and generation of `//T` comments into JSDoc stubs.

### Transpilation Pipeline  ❌ ❌ ❌ ❌ ❌ <- this was the ety initial working/buggy way of achieving before pivotting to using LSP

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Ety Transpilation Pipeline                      │
└─────────────────────────────────────────────────────────────────────────┘

  SOURCE FILES                    Ety TOOL                    STUB FILES
  ────────────                    ────────                    ──────────

  src/
  ├── models/
  │   └── user.js ─────────┐
  │       // T: typedef... │
  │                        │     ┌─────────────┐
  ├── services/            ├────►│             │
  │   └── auth.js ─────────┤     │  jty        │         .types/
  │       // T: (string)   │     │  generate   │         └── src/
  │                        │     │             │             ├── models/
  └── index.js ────────────┘     └──────┬──────┘             │   └── user-ty.jsdoc.js
      // T: ...                         │                    │       /** @typedef ... */
                                        │                    │       export const User = {};
                                        ▼                    │
                                  ┌───────────┐              ├── services/
                                  │  Parser   │              │   └── auth-ty.jsdoc.js
                                  │  ───────  │              │       /** @param {string} */
                                  │  Extract  │              │       export function...
                                  │  // T:    │              │
                                  │  comments │              └── index-ty.jsdoc.js
                                  └─────┬─────┘
                                        │
                                        ▼
                                  ┌───────────┐
                                  │ Generator │    
                                  │ ───────── │
                                  │ • JSDoc   │
                                  │ • Stubs   │
                                  │ • Imports │
                                  └───────────┘
```

---

## Syntax

### Prefixes

Both prefixes are equivalent:
```javascript
let count = 0;  // type: number
let count = 0;  // T: number
```

### Generic Syntax

jty uses curly braces `{T}` for generics instead of angle brackets `<T>`:

```javascript
let items = [];       // T: Array{string}
let map = new Map();  // T: Map{string, number}

function identity(x) {
// T: {T}(T) => T
    return x;
}
```

> **Rationale:** Curly braces avoid conflicts with HTML/JSX contexts and provide a distinct jty identity while remaining visually clean.

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

When jty encounters an error, messages must trace back to the original source:

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

### Source Maps

Generated stub files should include source map comments for IDE navigation:

```javascript
// .types/src/auth-ty.jsdoc.js

/**
 * @param {string} name
 * @param {string} email
 * @returns {User}
 */
export function createUser(name, email) {}
//# sourceURL=../../src/auth.js
//# sourceLine=15
```

### IDE Integration

When an IDE reports a type error in a stub file, the error should be mappable to the original `// T:` comment:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Error Tracing Flow                               │
└─────────────────────────────────────────────────────────────────────────┘

  IDE Error (in stub)              Source Map              Original Source
  ──────────────────              ──────────              ───────────────

  .types/src/auth-ty.jsdoc.js     mapping.json            src/auth.js
  Line 12: Type 'Uzer'    ───────────────────────►        Line 15:
  is not assignable...                                    // T: (string) => Uzer
                                                                           ^^^^
```

---

## Watch Mode Reliability

### Requirements

Watch mode (`jty generate --watch`) must guarantee:

1. **File Change Detection** — Any `.js` file modification triggers regeneration
2. **Atomic Writes** — Stub files are written atomically (write to temp, then rename)
3. **Debouncing** — Rapid successive saves are debounced (default: 100ms)
4. **Error Recovery** — Parse errors don't crash the watcher
5. **Dependency Tracking** — Changes to imported types trigger dependent file regeneration

### Watch Mode Behavior

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Watch Mode Flow                                 │
└─────────────────────────────────────────────────────────────────────────┘

  File System Event                 jty Watcher                Action
  ─────────────────                ───────────                ──────

  src/models/user.js
  (modified)          ──────►      Debounce (100ms)  ──────►  Regenerate:
                                                              • user-ty.jsdoc.js
                                                              • auth-ty.jsdoc.js (imports User)
                                                              • index-ty.jsdoc.js (re-exports)

  src/new-file.js
  (created)           ──────►      Detect new file   ──────►  Generate:
                                                              • new-file-ty.jsdoc.js
                                                              
  src/old-file.js
  (deleted)           ──────►      Detect deletion   ──────►  Remove:
                                                              • old-file-ty.jsdoc.js
```

### CLI Output (Watch Mode)

```bash
$ jty generate src/ --watch

[jty] Watching src/ for changes...
[jty] Generated 12 stub files

[14:32:01] src/models/user.js changed
[14:32:01] ✓ .types/src/models/user-ty.jsdoc.js (2ms)
[14:32:01] ✓ .types/src/services/auth-ty.jsdoc.js (1ms, dependency)

[14:32:15] src/utils/helpers.js changed
[14:32:15] ✗ Parse error at line 23: Unclosed parenthesis
           |
        23 |     // T: (string, number
           |         ^^^^^^^^^^^^^^^^^

[14:32:30] src/utils/helpers.js changed
[14:32:30] ✓ .types/src/utils/helpers-ty.jsdoc.js (1ms)
```

### Configuration

**jty.config.json** (optional):
```json
{
  "watch": {
    "debounce": 100,
    "ignored": ["**/*.test.js", "**/*.spec.js"],
    "persistent": true
  },
  "output": {
    "dir": ".types",
    "ext": "-ty.jsdoc.js"
  },
  "parser": {
    "strict": true,
    "unknownTypeError": "warn"
  }
}
```

---

## Type Definitions

### Typedef

```javascript
// T: typedef User = { id: string, name: string, age: number }
// T: typedef ID = string | number
// T: typedef Status = 'pending' | 'active' | 'closed'
```

**Generates (with dummy export):**
```javascript
/**
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {number} age
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

**With optional and only properties:**
```javascript
// T: typedef Config = { apiKey: string, timeout?: number, baseUrl: string @readonly }
```

**Generates:**
```javascript
/**
 * @typedef {Object} Config
 * @property {string} apiKey
 * @property {number} [timeout]
 * @property {string} baseUrl @readonly
 */
export const Config = {};
```

**With descriptions:**
```javascript
// T: typedef User = { id: string, name: string, age: number }
// T: * A registered user in the system
```

**Generates:**
```javascript
/**
 * A registered user in the system
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {number} age
 */
export const User = {};
```

### Callback

```javascript
// T: callback OnSuccess = (data: any) => void
// T: callback Comparator = {T}(a: T, b: T) => number
// T: callback Mapper = {T, U}(item: T, index: number) => U
```

**Generates (with dummy export):**
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

> **Important:** Use baseUrl-relative imports (e.g., `'src/models'`) rather than relative paths (e.g., `'./models'`). See [IDE Configuration](#ide-configuration) for details.
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub) — preserves const declaration:**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub):**
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

**Generates (stub with values retained):**
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

**Generates (stub):**
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

For declaring a variable with a specific type:

```javascript
const input = document.getElementById('name');  // T: HTMLInputElement
```

**Generates (stub):**
```javascript
/** @type {HTMLInputElement} */
export let input;
```

### Inline Cast

For inline type assertions, use the `as` keyword. This generates an inline JSDoc cast in the source file (not the stub):

```javascript
const input = document.getElementById('name');  // T: as HTMLInputElement
```

**Generates (in source, via inject mode):**
```javascript
const input = /** @type {HTMLInputElement} */ (document.getElementById('name'));
```

> **Note:** Inline casts are only generated when using `jty inject` mode, not stub generation.

---

## Barrel Exports (Re-exports)

Barrel files (`index.js`) that re-export from other modules are fully supported.

### Export All

```javascript
export * from './user';
export * from './auth';
```

**Generates (stub):**
```javascript
export * from './user-ty.jsdoc.js';
export * from './auth-ty.jsdoc.js';
```

### Named Re-exports

```javascript
export { User, createUser } from './user';
export { authenticate as auth } from './auth';
```

**Generates (stub):**
```javascript
export { User, createUser } from './user-ty.jsdoc.js';
export { authenticate as auth } from './auth-ty.jsdoc.js';
```

### Mixed Barrel

```javascript
// T: typedef PublicAPI = { version: string }

export * from './user';
export { Auth } from './auth';
export const VERSION = '1.0.0';  // T: string
```

**Generates (stub):**
```javascript
/**
 * @typedef {Object} PublicAPI
 * @property {string} version
 */
export const PublicAPI = {};

export * from './user-ty.jsdoc.js';
export { Auth } from './auth-ty.jsdoc.js';

/** @type {string} */
export let VERSION;
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

`// T:` annotations are not limited to `.js`/`.jsx` source — jty also processes the
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

**Position fidelity (line- and column-parallel).** jty analyzes a projection of the
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

**Generates (stub):**
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
| `number?` (in typedef) | Optional property | `@property {number} [x]` |

> **Alignment with TypeScript:** The `?` modifier indicates optional (undefined), not nullable. Use explicit `| null` for nullable types.

---

## Output Strategy: Shadow Types Directory

### The Shadow Directory Concept

The `.types/` directory mirrors your source tree exactly, creating a "shadow" of your codebase containing only type information.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Shadow Directory Structure                         │
└─────────────────────────────────────────────────────────────────────────┘

     SOURCE TREE                              SHADOW TREE
     ───────────                              ───────────
     (Your Code)                              (Generated Types)

     project/                                 project/
     │                                        │
     ├── src/                                 ├── .types/
     │   │                                    │   │
     │   ├── models/                          │   └── src/
     │   │   ├── user.js ─────────────────────────► models/
     │   │   │   // T: typedef User = {...}   │       └── user-ty.jsdoc.js
     │   │   │                                │           /** @typedef {Object} User */
     │   │   └── post.js ─────────────────────────►       export const User = {};
     │   │       // T: typedef Post = {...}   │
     │   │                                    │       └── post-ty.jsdoc.js
     │   ├── services/                        │
     │   │   └── auth.js ─────────────────────────► services/
     │   │       // T: (string) => User       │       └── auth-ty.jsdoc.js
     │   │                                    │           /** @param {string} */
     │   └── index.js ────────────────────────────►       export function login() {}
     │       export * from './models'         │
     │                                        │   └── index-ty.jsdoc.js
     │                                        │       export * from './models-ty.jsdoc.js'
     ├── jsconfig.json                        │
     └── package.json                         └── (paths mapping points here)

     Key Points:
     ───────────
     • Every .js file gets a corresponding -ty.jsdoc.js stub
     • Directory structure is exactly mirrored
     • Imports are rewritten to point to stub siblings
     • Source files remain untouched (no JSDoc clutter)
```

### Directory Structure

Generated stub files are placed in a `.types/` directory at project root, mirroring the source tree exactly.

```
project/
├── src/
│   ├── lib/
│   │   └── math.js
│   ├── models/
│   │   └── user.js
│   └── index.js
├── .types/
│   └── src/
│       ├── lib/
│       │   └── math-ty.jsdoc.js
│       ├── models/
│       │   └── user-ty.jsdoc.js
│       └── index-ty.jsdoc.js
├── jsconfig.json
└── package.json
```

### Stub Generation Rules

| Source Construct | Stub Output |
|------------------|-------------|
| `function name(params) { ... }` | `export function name(params) {}` |
| `export default function name(params) { ... }` | `export default function name(params) {}` |
| `const fn = (params) => ...` | `export const fn = (params) => {};` |
| `let fn = (params) => ...` | `export let fn = (params) => {};` |
| `class Name { ... }` | `export class Name { /* empty methods */ }` |
| `class Child extends Parent { ... }` | `export class Child extends Parent { constructor() { super(); } }` |
| `const x = value` | `export let x;` |
| `let x = value` | `export let x;` |
| `// T: typedef Name = ...` | JSDoc `@typedef` + `export const Name = {};` |
| `// T: callback Name = ...` | JSDoc `@callback` + `export const Name = {};` |
| `const ENUM = { ... }` (with `// T: enum`) | `export const ENUM = { ... };` (values retained) |
| `export * from './path'` | `export * from './path-ty.jsdoc.js';` |
| `export { A, B } from './path'` | `export { A, B } from './path-ty.jsdoc.js';` |

### Generic Syntax Transformation

jty uses `{T}` syntax which transforms to JSDoc's `<T>` in generated stubs:

| jty Syntax | Generated JSDoc |
|------------|-----------------|
| `Map{string, number}` | `Map<string, number>` |
| `Set{User}` | `Set<User>` |
| `Promise{T}` | `Promise<T>` |
| `{T}(T) => T` | `@template T` + `@param {T}` + `@returns {T}` |
| `{T extends string}` | `@template {string} T` |

### Import Rewriting

Imports within generated stubs are rewritten to reference sibling stub files.

**Source:** `src/auth.js`
```javascript
import { User } from 'src/models/user';
```

**Generated:** `.types/src/auth-ty.jsdoc.js`
```javascript
import { User } from 'src/models/user-ty.jsdoc.js';
```

### IDE Configuration

#### Node.js / Bun

**jsconfig.json:**
```json
{
  "compilerOptions": {
    "baseUrl": "./",
    "paths": {
      "src/*": [".types/src/*", "src/*"]
    },
    "checkJs": true
  },
  "include": ["src/**/*", ".types/**/*"],
  "exclude": ["node_modules"]
}
```

#### Deno

Deno uses `deno.json` with import maps instead of `jsconfig.json` paths.

**deno.json:**
```json
{
  "compilerOptions": {
    "checkJs": true
  },
  "imports": {
    "src/": "./.types/src/"
  }
}
```

> **Note:** Deno requires explicit file extensions in imports. Use `import { User } from 'src/models/user.js'` in source files, and jty will generate stubs with `-ty.jsdoc.js` extension.

> **URL Imports:** External URL imports (e.g., `https://deno.land/...`) pass through unchanged. Use `// T: ignore` if needed:
> ```javascript
> import { serve } from "https://deno.land/std/http/server.ts";  // T: ignore
> ```

### Import Resolution Flow

Understanding why baseUrl imports are required:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Import Resolution Flow                           │
└─────────────────────────────────────────────────────────────────────────┘

  SCENARIO A: Relative Import (❌ No Types)
  ─────────────────────────────────────────

  // In src/services/auth.js
  import { User } from './models/user';
                         │
                         ▼
  ┌─────────────────────────────────────┐
  │  IDE Resolution Steps:              │
  │  1. Sees relative path './'         │
  │  2. Resolves from current dir       │
  │  3. Finds: src/models/user.js       │◄──── Source file (no JSDoc)
  │  4. paths mapping IGNORED           │
  └─────────────────────────────────────┘
                         │
                         ▼
                    ❌ No Intellisense


  SCENARIO B: BaseUrl Import (✅ Full Types)
  ──────────────────────────────────────────

  // In src/services/auth.js
  import { User } from 'src/models/user';
                         │
                         ▼
  ┌─────────────────────────────────────┐
  │  IDE Resolution Steps:              │
  │  1. Sees non-relative path          │
  │  2. Checks jsconfig.json paths      │
  │  3. Tries: .types/src/models/user   │
  │  4. Finds: -ty.jsdoc.js             │◄──── Stub file (full JSDoc)
  └─────────────────────────────────────┘
                         │
                         ▼
                    ✅ Full Intellisense


  jsconfig.json Configuration:
  ────────────────────────────
  {
    "compilerOptions": {
      "baseUrl": "./",
      "paths": {
        "src/*": [".types/src/*", "src/*"]
                  ▲              ▲
                  │              └── Fallback: source file
                  └── First try: stub file
      }
    }
  }
```

> **Critical Usage Note:**
> 
> To ensure the IDE resolves types from the generated stubs instead of the untyped source files, **always use baseUrl-relative imports** rather than relative paths.
> 
> | Import Style | Resolution | Intellisense |
> |--------------|------------|--------------|
> | `import { add } from './lib/math'` | Resolves to `./lib/math.js` (source) | ❌ No types |
> | `import { add } from 'src/lib/math'` | Resolves to `.types/src/lib/math-ty.jsdoc.js` via paths | ✅ Full types |
> 
> The `paths` mapping in `jsconfig.json` only takes effect for non-relative module specifiers. Relative imports (`./`, `../`) bypass the mapping entirely and resolve directly to the source file.

### .gitignore / .dockerignore

```gitignore
.types/
```

---

## CLI

```bash
jty generate src/              # Generate stubs to .types/
jty generate src/ --watch      # Watch mode

jty init                       # Create config (auto-detect runtime)
jty init --runtime node        # Node.js/Bun config (jsconfig.json)
jty init --runtime deno        # Deno config (deno.json)


jty clean                      # Remove .types/ directory
jty check src/                 # Validate // T: syntax without generating
stage - 2
jty inject src/                # Inject JSDoc into source files (inline casts)
```

**Options:**
```
--out <dir>       Output directory (default: .types)
--ext <suffix>    File suffix (default: -ty.jsdoc.js)
--runtime <rt>    Target runtime for init: node, deno
--verbose         Show processed files
--watch           Watch for changes and regenerate
--strict          Treat warnings as errors
--config <file>   Path to jty.config.json
```

---

## Configuration File

**jty.config.json** (optional):
```json
{
  "include": ["src/**/*.js"],
  "exclude": ["**/*.test.js", "**/*.spec.js"],
  "scriptHosts": ["html"],
  "output": {
    "dir": ".types",
    "ext": "-ty.jsdoc.js"
  },
  "watch": {
    "debounce": 100,
    "persistent": true
  },
  "parser": {
    "strict": true,
    "unknownTypeError": "warn"
  },
  "runtime": "node"
}
```

---

## Complete Example

**Source:** `src/models/user.js`
```javascript
// T: typedef User = { id: string, name: string, email: string, role: Role }
// T: * A registered user in the system

// T: typedef Role = 'admin' | 'user' | 'guest'
// T: * User permission level

// T: callback OnUserChange = (user: User, prev: User | null) => void
// T: * Called when user data changes
```

**Generated:** `.types/src/models/user-ty.jsdoc.js`
```javascript
/**
 * A registered user in the system
 * @typedef {Object} User
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {Role} role
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
export const OnUserChange = {};
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

**Generated:** `.types/src/services/user-service-ty.jsdoc.js`
```javascript
import { User, Role, OnUserChange } from 'src/models/user-ty.jsdoc.js';

/**
 * @type {Set<OnUserChange>}
 */
export let subscribers;

/**
 * Creates a new user with the given details
 * @param {string} name
 * @param {string} email
 * @param {Role} [role]
 * @returns {User}
 * @throws {Error} If email is invalid
 */
export function createUser(name, email, role) {}

/**
 * @param {string} id
 * @returns {Promise<User | null>}
 */
export async function fetchUser(id) {}

/**
 * @template {User} T
 * @param {T[]} users
 * @param {function(T): T} transform
 * @returns {T[]}
 */
export function updateUsers(users, transform) {}
```

---

**Source:** `src/index.js` (Barrel)
```javascript
export * from './models/user';
export * from './services/user-service';
export { default as config } from './config';
```

**Generated:** `.types/src/index-ty.jsdoc.js`
```javascript
export * from './models/user-ty.jsdoc.js';
export * from './services/user-service-ty.jsdoc.js';
export { default as config } from './config-ty.jsdoc.js';
```

---

## Unsupported Features

The following features are explicitly **not supported** in jty v0.2:

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
| Typedef | ✅ (with dummy export) |
| Callback | ✅ (with dummy export) |
| Enum | ✅ (values retained) |
| Type imports | ✅ (rewritten in stubs) |
| Barrel exports | ✅ (export *, export {}) |
| Embedded `<script>` JS | ✅ (`.html` default; `.jsp`/`.aspx`/`.tpl`/`.ftl` opt-in via `scriptHosts`) |
| Descriptions | ✅ |
| JSDoc tags | ✅ (@deprecated, @throws, @see, etc.) |
| Inline casts | ✅ (inject mode only) |
| Node.js ESM | ✅ |
| Bun | ✅ |
| Deno | ✅ (via deno.json imports) |

---

## Benefits

1. **Zero Source Clutter** — Source files contain only code and minimal type comments
2. **Clear Separation** — Generated files isolated in `.types/`
3. **No Runtime Risk** — Stub files contain no executable logic
4. **Full IDE Support** — Path mapping provides seamless intellisense
5. **Valid JavaScript** — Commented and generated files are syntactically correct JS
6. **Import Compatibility** — Dummy exports satisfy JS module resolution
7. **JSDoc and TypeScript Aligned** — Semantics match JSDoc and TypeScript conventions
8. **Barrel Support** — Re-exports work seamlessly
9. **Distinct Syntax** — `{T}` generic syntax is unique to jty, avoiding HTML/JSX conflicts
10. **Multi-Runtime** — Works with Node.js, Bun, and Deno
11. **Error Traceability** — Errors map back to original source locations

---

## Changelog

### v0.1.3

- Added Embedded Host Documents support — `// T:` annotations inside `<script>` blocks
- `.html` supported by default; `.jsp`/`.aspx`/`.tpl`/`.ftl` opt-in via `scriptHosts`
- Added `scriptHosts` configuration option (default `["html"]`)

### v0.1.2

- Added "When to Use jty" decision guide
- Added Parser Rules and Ambiguity Resolution section
- Added Grammar specification (BNF)
- Added Error Handling and Source Mapping section
- Added Watch Mode Reliability requirements
- Added `jty check` command for syntax validation
- Added `jty.config.json` configuration file support
- Added `--strict` and `--config` CLI options

### v0.1.1

- **Breaking Change:** Generic syntax changed from `<T>` to `{T}`
  - Avoids HTML/JSX conflicts
  - Provides distinct jty identity
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


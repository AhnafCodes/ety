# ety (`//T`) Language Server Specification

> **Canonical Name:** `ety`  
> **Comment Syntax:** `// T:`  
> **Aliases:** `typ2` (earlier working name)

---

## Key Principle

**Immutable Source. Additive Overlay. Line-Only Mapping.**

| Principle | Meaning |
|-----------|---------|
| **Immutable Source** | The user's `.js` file is never parsed, modified, or written to by the LSP. The `//T` comments are the canonical source of truth. Everything downstream is derived from them, never fed back into them. |
| **Additive Overlay** | The virtual document is strictly a superset of the original. The transformer only ever inserts — JSDoc blocks above annotated nodes, hoisted type imports at the top. It never deletes a character, never rewrites a line, never reorders anything. If you diffed the virtual document against the original, every original line would appear verbatim at shifted positions. |
| **Line-Only Mapping** | Because the overlay is purely additive and insertions are always full lines, character positions within any line are identical between the original and virtual documents. The only translation needed is line numbers, in both directions. A `Map<virtualLine, originalLine>` and its inverse are the entire source map — no byte ranges, no segment trees, no `@jridgewell/trace-mapping`. |

These three constraints are load-bearing. Violate any one and the architecture collapses:

- Modify the source → `//T` is no longer the source of truth; you have a transpiler
- Insert inline rather than full lines → character offsets diverge; Line-Only Mapping breaks
- Map anything beyond lines → the simplicity that makes this debuggable and fast disappears

---

## v1 Scope

v1 is deliberately narrow: it delivers **type checking, hover, and diagnostics for `@type`-shaped annotations** and nothing else. The richer annotation grammar (multi-line docs, `typedef`, `callback`, descriptions) is deferred to v2 so the core line-mapping invariant is proven before grammar complexity is layered on. A narrow spec that is fully honest beats a broad spec that is partially fiction.

| Feature | v1 Status |
|---------|-----------|
| Trailing `// T:` type on variables, properties | ✅ Core |
| Inside-block `// T:` type on functions, methods, classes | ✅ Core |
| `convertGenerics` with `{}` disambiguation | ✅ Core |
| Depth-aware parameter naming (`pN: Type`) | ✅ Core |
| Class generic params via `// T: {T}` → `@template` | ✅ Core |
| `// T: import { ... } from '...'` hoisting | ✅ Core (resolves against open/cached files only — see below) |
| Hover on typed symbols | ✅ Core |
| Diagnostics mapped to original lines | ✅ Core |
| Multi-line `// T:` blocks (descriptions, `@throws`) | ❌ v2 |
| `// T: @template T` literal syntax | ❌ v2 (use the `{T}` form on the class line) |
| `// T: typedef Name = ...` | ❌ v2 (use a standard `/** @typedef */` block for now) |
| `// T: callback Name = ...` | ❌ v2 (use a standard `/** @callback */` block for now) |
| Trailing descriptions (`// T: Type - description`) | ❌ v2 (v1 treats the whole payload as the type; do not add a description) |
| Constructor annotations | ❌ v2 (no constructor syntax in v1; TS infers params from usage) |
| Nested function-type parameter naming | ❌ v2 (see the Named-parameter note in Phase 2) |
| Autocompletion inside `// T:` | ❌ v2 (see Deferred: Autocompletion) |
| Cross-file types from unopened files | ❌ v2 (workspace-wide transform-on-read) |

**Deferred grammar requires a different parser shape.** `typedef` and `callback` are *standalone* comments attached to no AST node, so they don't fit the `check_block` / `check_inline` model and need a separate extraction pass. Multi-line coalescing requires the parser to gather consecutive `// T:` lines per node instead of returning the first match. Both are v2 design problems, not v1 implementation details.

---

## Annotation Syntax

`//T` uses `{}` instead of `<>` for generics to avoid JSX/HTML parser conflicts.
`Box{T}` = `Box<T>`, `Map{K, V}` = `Map<K, V>`

### The `{}` Disambiguation Rule

Because object types also use braces (`{ id: string }`), `{}` is overloaded. A single rule resolves it, and it is the one rule users must not violate:

- **Postfix args** — a `{` *immediately following a type identifier with no space* is a generic: `Map{string, User}`, `Box{T}`, `Promise{T}`. "Identifier" is unicode-aware (`\p{L}\p{N}_$`), matching JavaScript itself: `Бокс{string}` is a generic, same as the ASCII case.
- **Prefix type-parameter list** — a `{` whose matching `}` is *immediately followed by `(`* is a generic parameter declaration: `{T}(T[]) => T[]`.
- **Everything else** — a standalone `{` (after `=`, `,`, `:`, `=>`, or at the start with no trailing `(`) is an **object type** and is preserved verbatim.

Closing braces are matched to their opener with a stack, so nesting converts correctly: `Map{string, {id: string}}` → `Map<string, {id: string}>`.

> **The one constraint:** never put a space between a type name and its generic arguments. `Map{string}` is a generic; `Map {string}` would be read as the identifier `Map` followed by an object type. The conversion logic lives in `convertGenerics` (Phase 2).

> **Payloads can never close the injected comment.** Phase 2 wraps every payload in `/** … */`, so a literal `*/` inside a payload would terminate that comment mid-line and dump the remainder into the virtual document as code — corrupting offsets for everything below. `toJsDocType` therefore neutralizes `*/` to `* /` before emitting. The type is still invalid, so TypeScript reports an error that diagnostics remapping places on the `// T:` comment itself: a hostile payload degrades to a visible squiggle on the annotation, never to a corrupted virtual document.

### Placement Rules

Two strict, mutually exclusive rules govern where `//T` annotations may appear.
No other placement is valid. The parser never looks above a node.

**Rule 1 — Trailing/Inline**
Variables, properties, and type definitions use a trailing `// T:` comment on the *same line* as the declaration.

```javascript
let count = 0;               // T: number
const userCache = new Map(); // T: Map{string, User}
const activeIds = new Set(); // T: Set{string}
let entries = [];            // T: [string, number][]
```

> **Note:** Trailing annotations match at the **statement** level (`VariableDeclaration`), so the comment must follow the end of the statement — after the `;` on the statement's final line. For a multi-declarator statement (`let x = 1, y = 2; // T: number`, including the multi-line form), this produces a single `@type` above the whole `let`/`const`. Whether that type applies to each declarator is then determined by TypeScript's handling of `@type` over a multi-declarator statement — it is not guaranteed per-declarator; use separate statements for reliable typing. A comment trailing a *non-final* line of a multi-line declaration (`let x = 1, // T: number` followed by `y = 2;`) falls *inside* the statement's span and is **not matched** — it is silently inert, by design, so the rule stays crisp: trailing means after the statement ends.

**Rule 2 — Succeeding Line (Inside-Block Only)**
Functions and classes use a `// T:` comment on the *first line inside* their block body. Never on the line preceding the declaration.

```javascript
function createUser(name, email, role) {
// T: (string, string, Role?) => User
    return { id: crypto.randomUUID(), name, email, role: role ?? 'user' };
}
```

Preceding-line annotations are not part of the syntax. The parser never inspects bytes above a node's `span.start`.

**Concise Arrow Functions**
Concise arrow functions with no block body (`x => expr`) have no valid inside-block position. They are annotated via a trailing comment on the enclosing `VariableDeclaration` (the whole `const ...;` statement) — Rule 1 applies naturally, no special handling needed.

```javascript
const double = x => x * 2; // T: (number) => number
```

**Function Expression Assigned to Variable**
When a `// T:` appears inside the function body, the Inside-Block Check applies unconditionally. The statement-level Inline Check on the enclosing `VariableDeclaration` never fires, because `check_inline` only scans *after* the statement's end and the comment sits inside the statement's span.

```javascript
const createUser = function(name) {
// T: (string) => User
    return { name };
}
```

### Type Definitions and Callbacks (v2)

`// T: typedef ...` and `// T: callback ...` are **deferred to v2**. They are standalone comments attached to no AST node, so they require a separate extraction pass (see v1 Scope). Until then, declare shared types with a standard JSDoc block, which TypeScript reads natively:

```javascript
/** @typedef {{ id: string, name: string, email: string, role: Role }} User */
/** @typedef {'admin' | 'user' | 'guest'} Role */
/** @callback OnUserChange @param {User} user @param {User | null} prev @returns {void} */
```

### Type Imports

To use types defined in other files, use the import annotation. These are hoisted to the top of the virtual document regardless of where they appear in the source.

```javascript
// T: import { User, Role } from './types'
```

### Generic Functions

```javascript
function filter(items, predicate) {
// T: {T}(T[], (T) => boolean) => T[]
    return items.filter(predicate);
}
```

### Async Functions

Async functions must explicitly declare `Promise{T}` as the return type.

```javascript
async function fetchJson(url, options) {
// T: {T}(string, RequestInit?) => Promise{T}
    const res = await fetch(url, options);
    return res.json();
}
```

### Class Definition

Class-level generic parameters use the `{T}` form (consistent with `{}` everywhere else). The transformer emits `/** @template T */` for it, not `@type` — see the class branch in `toJsDocType`.

```javascript
class Box {
// T: {T}

    value;  // T: T

    constructor(value) {
        this.value = value;
    }

    map(fn) {
        // T: {U}((T) => U) => Box{U}
        return new Box(fn(this.value));
    }
}
```

> **Constructors are not annotatable in v1.** There is no `// T:` constructor syntax: a payload like `(T)` contains no `=>`, so `extractParamList` returns null and the transformer would emit `/** @type {(T)} */` — a parenthesized type, not a constructor signature. In v1, constructor parameter types are inferred by TypeScript from usage; explicit constructor annotation (via `@param` generation) is v2.
>
> **Method `@type` must be verified at Gate 3a.** `@type` with a function-type literal is confirmed TypeScript behavior on function *declarations* (fixed in TS 3.0, issue #25618 — parameters, return type, and type params are all applied positionally). The same tag above a class *method* goes through a different checker path and is unverified; Gate 3a includes a fixture for it. If the fixture fails, methods need an `@param`/`@returns` generation branch (`kind === 'method'`), fed by the existing depth-aware splitters.

---

## Architecture Overview

```
User's .js file  (never modified)
       │
       ▼
┌─────────────────────────────────┐
│  Phase 1: Rust / Oxc Parser     │  ← runs on every keystroke
│  - Parse AST + Trivias          │
│  - Extract //T comment spans    │
│  - Map to AST nodes             │
│  - Return flat EtyAnnotation[]  │  ← one napi-rs boundary crossing
└─────────────────────────────────┘
       │  Vec<EtyAnnotation> (byte offsets + raw strings)
       ▼
┌─────────────────────────────────┐
│  Phase 2: Node.js Transformer   │
│  - Byte offsets → line numbers  │
│  - Build virtualToOriginalLine  │
│  - Build originalToVirtualLine  │
│  - Hoist // T: import lines     │
│  - Inject @type / @template     │
│    JSDoc above annotated nodes  │
│  - Produce virtual document     │  ← in memory only, never on disk
└─────────────────────────────────┘
       │  virtual source string
       ▼
┌─────────────────────────────────┐
│  Phase 3: TypeScript LS         │
│  - Receives virtual doc via     │
│    getScriptSnapshot()          │
│  - Returns diagnostics & hover  │
│    at virtual positions         │
└─────────────────────────────────┘
       │  virtual positions
       ▼
┌─────────────────────────────────┐
│  Phase 4: LSP Response          │
│  - Map virtual lines → original │
│  - Character offsets unchanged  │
│  - Send to IDE                  │
└─────────────────────────────────┘
```

**Note:** The LSP shell and the TypeScript Language Service host (both in Phase 3) are developed together — the LSP shell is the skeleton, the TS Language Service is the engine. They cannot be tested independently.

---

## Phase 1: Rust Parser

### Output Struct

Return only what Node.js needs. The AST, Trivias, and arena memory stay in Rust and are freed immediately after the parse call.

```rust
#[napi(object)]
pub struct EtyAnnotation {
    pub node_start_offset: u32,  // start of the annotated declaration
    pub ety_start_offset: u32,   // start of the //T comment
    pub ety_end_offset: u32,     // end of the //T comment
    pub kind: String,            // "function" | "variable" | "property" | "class"
    pub name: String,            // "createUser", "count", etc.
    pub ety: String,             // raw annotation string: "(string) => User"
}
```

`node_start_offset` and `ety_start_offset` serve different purposes. `node_start_offset` tells the transformer where to insert the JSDoc in the virtual file. `ety_start_offset` / `ety_end_offset` give the exact span of the `// T:` comment, which the transformer precomputes into a `commentRange` so diagnostics originating inside an injected line can be remapped onto the annotation text (see Phase 3 Diagnostics).

### Parsing

```rust
let allocator = Allocator::default();
let source_type = SourceType::default().with_module(true);
let ret = Parser::new(&allocator, &source, source_type).parse();
let trivias = ret.trivias;
let program = ret.program;
```

Do not enable comment attachment. Oxc's attachment pass resolves ownership for every comment in the file using formatter heuristics — copyright headers, linter directives, standard JSDoc, and developer notes all get processed unnecessarily. Those heuristics can change in any release (attachment is an implementation detail, not a semver-stable API). Leave the AST and Trivias completely separate.

### Extracting //T Spans

Iterate `trivias.comments()`. Filter for single-line comments whose trimmed text starts with `T:`. **Payload normalization:** the stored `ety` string is the comment text after the first `T:`, with surrounding whitespace trimmed. Phase 2 depends on this exact form — the `import ` prefix check (`slice(7)`) and the class `{T}` regex both assume it. Store as `(span_start, span_end, ety_string)`. This is a linear scan over structured span data — no regex, no raw string search over source bytes.

### The Two Checks

Apply these checks as strictly separate functions. Never run both on the same node.

**Inside-Block Check** — for functions and classes with block bodies:

```rust
fn check_block(
    body: &BlockStatement,
    annotations: &[(u32, u32, &str)],
) -> Option<&str> {
    let open_brace = body.span.start;
    let first_stmt_start = body.body.first()
        .map(|s| s.span().start)
        .unwrap_or(body.span.end); // empty body guard

    annotations.iter()
        .filter(|(s, e, _)| *s > open_brace && *e < first_stmt_start)
        .map(|(_, _, ety)| *ety)
        .next()
}
```

The empty-body edge case (`function foo() {}`) must be handled explicitly — without the guard, you query a zero-width or inverted range.

**Inline/Trailing Check** — for variables and properties:

```rust
fn check_inline(
    node_end: u32,
    source: &str,
    annotations: &[(u32, u32, &str)],
) -> Option<&str> {
    let next_newline = source[node_end as usize..]
        .find('\n')
        .map(|i| node_end + i as u32)
        .unwrap_or(source.len() as u32);

    annotations.iter()
        .filter(|(s, _, _)| *s >= node_end && *s < next_newline)
        .map(|(_, _, ety)| *ety)
        .next()
}
```

Using byte range rather than line number comparison prevents false matches on files with multiple semicolon-separated declarations per line.

**Class-Body Check** — a variant of `check_block` for the class-level `{T}` annotation, which sits between the class body's opening brace and its first element:

```rust
fn check_class_body<'a>(
    body: &ClassBody,
    annotations: &[(u32, u32, &'a str)],
) -> Option<&'a str> {
    let open_brace = body.span.start;
    let first_elem_start = body.body.first()
        .map(|e| e.span().start)
        .unwrap_or(body.span.end); // empty class body guard

    annotations.iter()
        .filter(|(s, e, _)| *s > open_brace && *e < first_elem_start)
        .map(|(_, _, ety)| *ety)
        .next()
}
```

### AST Visitor — Hard Separation

```rust
impl<'a> Visit<'a> for EtyVisitor<'_> {

    // Inside-Block Check only
    fn visit_function(&mut self, func: &Function) {
        if let Some(body) = &func.body {
            if let Some(ety) = check_block(body, &self.annotations) {
                self.results.push(/* ... */);
            }
        }
        // concise arrow (no block body) falls through to visit_variable_declaration
    }

    // Oxc's node is `ArrowFunctionExpression`, so the generated visitor method
    // is `visit_arrow_function_expression` (NOT `visit_arrow_expression`).
    fn visit_arrow_function_expression(&mut self, arrow: &ArrowFunctionExpression) {
        if let Some(body) = arrow.body.as_block_statement() {
            if let Some(ety) = check_block(body, &self.annotations) {
                self.results.push(/* ... */);
            }
        }
        // concise body: no block, no inside-block annotation possible
    }

    fn visit_method_definition(&mut self, method: &MethodDefinition) {
        if let Some(body) = &method.value.body {
            if let Some(ety) = check_block(body, &self.annotations) {
                self.results.push(/* ... */);
            }
        }
    }

    // Fires for BOTH `class Box {}` (ClassDeclaration) and
    // `const Box = class {}` (ClassExpression) — Oxc represents both with the
    // same `Class` node, so a single visit_class handler covers both forms.
    fn visit_class(&mut self, class: &Class) {
        // Class-level annotations sit before the first member,
        // between the opening brace of the class body and the first ClassElement.
        // Apply a variant of check_block using class.body.span.
        if let Some(ety) = check_class_body(&class.body, &self.annotations) {
            self.results.push(/* name: class.id (None for anonymous class expressions) */);
        }
    }

    // Inline/Trailing Check only
    // Visit the WHOLE statement (VariableDeclaration), not individual
    // declarators. With per-declarator visits, a multi-line multi-declarator
    // statement (`let x = 1,\n y = 2; // T: number`) attaches the annotation
    // to `y` and injects the JSDoc mid-statement — syntactically legal but
    // non-functional, since TS only applies @type ahead of the let/const
    // keyword. Statement-level matching pins node_start_offset to the
    // statement start, so the JSDoc always lands above the whole declaration.
    // Side effect: multi-declarator statements fire once, so they no longer
    // need deduplication (the dedupe pass remains for method double-fire).
    fn visit_variable_declaration(&mut self, decl: &VariableDeclaration) {
        if let Some(ety) = check_inline(decl.span.end, self.source, &self.annotations) {
            self.results.push(/* node_start_offset: decl.span.start */);
        }
    }

    fn visit_property_definition(&mut self, prop: &PropertyDefinition) {
        if let Some(ety) = check_inline(prop.span.end, self.source, &self.annotations) {
            self.results.push(/* ... */);
        }
    }
}
```

### Deduplication (Required)

One situation makes a single physical `// T:` comment match more than once:

- **Visitor double-fire.** The Oxc walk descends into children, so a class method is visited twice: `visit_method_definition` runs `check_block` on `method.value.body`, and then the walk reaches the inner `Function` node and `visit_function` runs `check_block` on the *same body*.

(Multi-declarator statements were a second source of duplicates when the visitor matched per-`VariableDeclarator`; statement-level matching via `visit_variable_declaration` fires once per statement, eliminating that class entirely.)

Without deduplication, each duplicate becomes a stacked duplicate JSDoc line in the virtual document. The fix is one pass before crossing the napi boundary: **dedupe results by `ety_start_offset`, keeping the first match.** Each physical comment yields at most one annotation. Gate 1 asserts this.

### Byte Offset to Line Number Conversion

Build a line index once per parse call. Reuse it for every node in the visitor.

```rust
fn build_line_index(source: &str) -> Vec<u32> {
    std::iter::once(0)
        .chain(source.bytes().enumerate()
            .filter(|(_, b)| *b == b'\n')
            .map(|(i, _)| i as u32 + 1))
        .collect()
}

fn byte_to_line(offset: u32, line_index: &[u32]) -> u32 {
    line_index.partition_point(|&o| o <= offset) as u32 - 1
}
```

---

## Phase 2: Node.js Transformer

### `LineIndex` Helper

`LineIndex` is defined first because both the transformer and the Phase 3 LSP handlers depend on it. The TypeScript Compiler API returns diagnostics and hover spans as **absolute byte offsets** (`number`), not `{ line, character }` objects. Accessing `.character` on a TS diagnostic's `start` will silently return `undefined` and produce broken ranges. `LineIndex` converts between offsets and positions in both directions.

Build it once per document change and store it in `lineMaps` alongside the line maps — do not reconstruct it on every hover or diagnostic request.

> **Line-ending policy:** `\n` is the sole line terminator; CRLF input is **not** normalized, so `\r` is simply the last character of a line (where no LSP column ever points). Both sides of the napi boundary must see identical bytes — normalizing in Node but not in Rust would silently desync every offset, which is why no normalization happens anywhere.

```javascript
class LineIndex {
    constructor(text) {
        this.lineStarts = [0];
        let pos = 0;
        while ((pos = text.indexOf('\n', pos) + 1) > 0) {
            this.lineStarts.push(pos);
        }
    }

    // Absolute byte offset -> { line, character }
    getLineAndChar(offset) {
        let low = 0, high = this.lineStarts.length - 1;
        while (low < high) {
            const mid = Math.ceil((low + high) / 2);
            if (this.lineStarts[mid] <= offset) low = mid;
            else high = mid - 1;
        }
        return { line: low, character: offset - this.lineStarts[low] };
    }

    // { line, character } -> absolute byte offset
    getOffset(line, character) {
        return this.lineStarts[line] + character;
    }
}
```

### `convertGenerics` — the `{}` Disambiguation Implementation

Implements the rule from the Annotation Syntax section. A naive `replace(/{/g, '<')` would corrupt object types (`{id: string}` → `<id: string>`); this stack scanner classifies each brace pair instead, and skips string literals so a literal type like `'{}'` is left intact.

```javascript
function convertGenerics(input) {
    const isIdent = c => /[A-Za-z0-9_$]/.test(c);

    // Does the {…} starting at openIdx close with a '(' immediately after? (prefix param list)
    const closesBeforeParen = (s, openIdx) => {
        let depth = 0, i = openIdx;
        while (i < s.length) {
            const c = s[i];
            if (c === "'" || c === '"' || c === '`') {                  // skip strings
                const q = c; i++;
                while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) { i++; break; } i++; }
                continue;
            }
            if (c === '{') depth++;
            else if (c === '}' && --depth === 0) {
                let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;
                return s[j] === '(';
            }
            i++;
        }
        return false;
    };

    let out = '', i = 0;
    const stack = []; // 'generic' | 'object'
    while (i < input.length) {
        const c = input[i];
        if (c === "'" || c === '"' || c === '`') {                      // copy strings verbatim
            const q = c; out += c; i++;
            while (i < input.length) {
                out += input[i];
                if (input[i] === '\\') { i++; if (i < input.length) out += input[i]; i++; continue; }
                if (input[i] === q) { i++; break; }
                i++;
            }
            continue;
        }
        if (c === '{') {
            // #9 fix: check the IMMEDIATE predecessor, not the last non-space
            // char. The spec rule says a space before `{` makes it an object
            // type, so `Map {string}` must NOT be read as a generic. out's last
            // char equals input[i-1] (non-brace chars are copied verbatim).
            const prevChar = out[out.length - 1];
            const kind = (prevChar && isIdent(prevChar)) || closesBeforeParen(input, i) ? 'generic' : 'object';
            stack.push(kind);
            out += kind === 'generic' ? '<' : '{';
            i++; continue;
        }
        if (c === '}') {
            out += (stack.pop() ?? 'object') === 'generic' ? '>' : '}';
            i++; continue;
        }
        out += c; i++;
    }
    return out;
}
```

### Parameter Splitting Helpers

The parameter rewrite cannot use regex: `\(([^)]*)\)` stops at the first `)`, so a callback parameter like `(T[], (T) => boolean) => T[]` yields the garbage capture `T[], (T`. Both the param-list *extraction* and the comma *split* must be depth-aware. These run after `convertGenerics`, so `<>` are generic delimiters; `=>` arrows are skipped so their `>` doesn't unbalance the depth counter. `extractParamList` additionally only accepts a `(...)` group that is immediately followed by `=>`, so a grouped or return type like `((string) => void)` is not mistaken for the parameter list.

```javascript
// Split on top-level commas only — ignores nested (), [], <>, {}, and strings.
function splitTopLevel(s) {
    const parts = []; let depth = 0, start = 0, i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === "'" || c === '"' || c === '`') {                 // skip strings
            const q = c; i++;
            while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) { i++; break; } i++; }
            continue;
        }
        if (c === '=' && s[i + 1] === '>') { i += 2; continue; }    // arrow, not a bracket
        if ('([<{'.includes(c)) depth++;
        else if (')]>}'.includes(c)) depth--;
        else if (c === ',' && depth === 0) { parts.push(s.slice(start, i).trim()); start = i + 1; }
        i++;
    }
    const last = s.slice(start).trim();
    if (last) parts.push(last);
    return parts;
}

// Find the function's parameter list: the first top-level "(...)" group that is
// immediately followed by '=>'. Returns { before, inner, after } or null.
// Tracks ALL bracket kinds (like splitTopLevel) — tracking only '()' would let a
// generic constraint containing a function type, e.g. <T extends () => void>(x: T) => T,
// be mistaken for the parameter list via the '()' inside the constraint.
function extractParamList(s) {
    let depth = 0, i = 0, open = -1;
    while (i < s.length) {
        const c = s[i];
        if (c === "'" || c === '"' || c === '`') {
            const q = c; i++;
            while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === q) { i++; break; } i++; }
            continue;
        }
        if (c === '=' && s[i + 1] === '>') { i += 2; continue; }
        if ('([<{'.includes(c)) {
            if (c === '(' && depth === 0 && open === -1) open = i;
            depth++;
        } else if (')]>}'.includes(c)) {
            depth--;
            if (c === ')' && depth === 0 && open !== -1) {
                // Fix 2: a top-level (...) group is the parameter list ONLY if it
                // is immediately followed by '=>'. Otherwise it is a grouped or
                // return type (e.g. "((string) => void)"); reset and keep scanning.
                let j = i + 1; while (j < s.length && /\s/.test(s[j])) j++;
                if (s[j] === '=' && s[j + 1] === '>') {
                    return { before: s.slice(0, open), inner: s.slice(open + 1, i), after: s.slice(i + 1) };
                }
                open = -1;
            }
        }
        i++;
    }
    return null;
}
```

### `toJsDocType` Converter

Converts a raw `//T` string to a JSDoc tag. For most annotations TypeScript understands function signatures inside `@type` tags, eliminating the need for individual `@param`/`@returns`. The one v1 exception is a **class**, which needs `@template`, not `@type`.

Order of operations:

1. **Class branch** — if `kind === 'class'`, the payload is a bare generic list `{T}` (or `{T, U}`). Emit `/** @template ... */` by reading the names out of the braces directly. (A standalone `{T}` is classified as an *object* by `convertGenerics` — no preceding identifier, no trailing `(` — so it would otherwise become `/** @type {{T}} */`. The class branch must not route through the normal path.)
2. Convert `{}` generics to `<>` via `convertGenerics` (object types preserved)
3. **Function-type guard** — only do parameter naming if the payload is actually a top-level function signature. A union, tuple, or object type that merely *contains* a function (`[(string) => void, number]`) must be wrapped in `@type` untouched, or `extractParamList` would mangle the inner `(`.
4. Name the top-level parameters using the depth-aware helpers. Parameters that are *already named* (`name: Type`, following the recommended convention) pass through unchanged; only unnamed positional types get a synthetic `pN:`.

```javascript
function toJsDocType(ety, kind) {
    // Step 1: class-level generic params -> @template (NOT @type).
    if (kind === 'class') {
        const m = ety.trim().match(/^\{(.+)\}$/);          // "{T}" or "{T, U}"
        if (m) return `/** @template ${m[1].trim()} */`;   // "@template T" / "@template T, U"
        // A class with no generics carries no // T: annotation, so a non-{...}
        // payload here is malformed; fall through to @type rather than crash.
    }

    // Step 2: {} -> <> for generics only (object types preserved)
    const angleFixed = convertGenerics(ety);

    // Step 3 (Fix 1): only attempt parameter naming for a genuine top-level
    // function signature. Strip a leading generic param list <...>, then require
    // the remainder to start with '(' or 'new ('. Anything else (union, tuple,
    // object, plain type) is wrapped in @type verbatim. The strip skips strings
    // and '=>' so a constraint like <T extends () => void> doesn't miscount.
    let s = angleFixed.trim();
    if (s.startsWith('<')) {
        let depth = 0, k = 0;
        for (; k < s.length; k++) {
            if (s[k] === "'" || s[k] === '"' || s[k] === '`') {
                const q = s[k]; k++;
                while (k < s.length) { if (s[k] === '\\') { k++; } else if (s[k] === q) break; k++; }
                continue;
            }
            if (s[k] === '=' && s[k + 1] === '>') { k++; continue; }
            if (s[k] === '<') depth++;
            else if (s[k] === '>') { if (--depth === 0) { k++; break; } }
        }
        s = s.slice(k).trim();
    }
    if (!s.startsWith('(') && !s.startsWith('new (')) {
        return `/** @type {${angleFixed}} */`;
    }

    // Step 4: name top-level parameters (depth-aware extraction + split).
    const pl = extractParamList(angleFixed);
    if (!pl) return `/** @type {${angleFixed}} */`;

    const named = splitTopLevel(pl.inner).map((p, i) => {
        // Fix 3: if the parameter already carries a top-level name (`name: Type`),
        // pass it through unchanged. The scan skips strings and '=>', and only a
        // ':' at bracket-depth 0 counts as a name separator (so the ':' inside an
        // object type or a nested function type does not trigger).
        let depth = 0, hasName = false;
        for (let k = 0; k < p.length; k++) {
            const c = p[k];
            if (c === "'" || c === '"' || c === '`') {
                const q = c; k++;
                while (k < p.length) { if (p[k] === '\\') { k++; } else if (p[k] === q) break; k++; }
                continue;
            }
            if (c === '=' && p[k + 1] === '>') { k++; continue; }
            if ('<({['.includes(c)) depth++;
            else if (')}]>'.includes(c)) depth--;
            else if (c === ':' && depth === 0) { hasName = true; break; }
        }
        if (hasName) return p; // already named, e.g. "role?: Role"

        const optional = p.endsWith('?');
        const type = optional ? p.slice(0, -1).trim() : p;
        return `p${i}${optional ? '?' : ''}: ${type}`;
    }).join(', ');

    return `/** @type {${pl.before}(${named})${pl.after}} */`;
}
```

> **Named-parameter requirement (the deeper issue).** The helpers above fix the *top-level* split, but TypeScript function types require a parameter name at **every** level: `(T) => boolean` is read by TS as a parameter *named* `T` of type `any`, not "takes a `T`". So a nested callback param written positionally still needs naming (`(p0: T) => boolean`), which the synthetic `pN:` pass does **not** do recursively. Two ways to resolve it:
>
> 1. Make the namer recursive — own a tested recursive descent over the type expression that injects `pN:` at each `(...) =>` level.
> 2. **(Recommended)** Adopt the convention of writing parameter names in signatures, e.g. `(items: T[], pred: (x: T) => boolean) => T[]`. **Fix 3 already supports this end-to-end:** an already-named parameter passes through untouched, so a fully-named signature needs no synthetic naming and nested function types resolve correctly. The synthetic `pN:` pass then only fires for legacy positional signatures, and the limitation below applies only to those.
>
> Positional signatures with nested function types (`(T[], (T) => boolean) => T[]`) still type-check the inner callback's parameter as a name rather than a type. Prefer named parameters (option 2) for any signature with nested functions; reserve positional form for flat primitive signatures where it reads cleaner.

### Building the Virtual Document and Line Maps

```javascript
function transformDocument(source, annotations) {
    const lines = source.split('\n');
    const totalOriginalLines = lines.length;

    // --- Fix #2: derive originalLine from the byte offset.
    // No line field crosses the napi-rs boundary; convert here using a
    // LineIndex over the ORIGINAL source. (napi-rs camelCases the Rust field
    // node_start_offset -> nodeStartOffset; single-word `ety` stays as-is.)
    const origIndex = new LineIndex(source);
    const withLines = annotations.map(a => ({
        ...a,
        originalLine: origIndex.getLineAndChar(a.nodeStartOffset).line,
        // --- Fix #2/#4: precompute the original // T: comment span now, while
        // origIndex is in scope. Diagnostics that originate inside an injected
        // line use this range instead of a meaningless virtual column.
        commentRange: {
            start: origIndex.getLineAndChar(a.etyStartOffset),
            end:   origIndex.getLineAndChar(a.etyEndOffset),
        },
    }));

    const importAnnotations = withLines.filter(a => a.ety.startsWith('import '));
    const typeAnnotations   = withLines.filter(a => !a.ety.startsWith('import '));

    const virtualLines = [];
    const vToO = new Map();     // virtualLine -> originalLine
    const oToV = new Map();     // originalLine -> virtualLine
    const lineKind = new Map(); // virtualLine -> { kind: 'code'|'jsdoc'|'import', commentRange? }
    let vLine = 0;
    let oLine = 0;

    // Shebang guard: '#!' is only valid on the very first line. If present,
    // flush it BEFORE hoisting imports — otherwise the hoisted imports push
    // the shebang mid-file and TS reports a phantom syntax error. Line-only
    // mapping is preserved; the hoist block simply starts at virtual line 1.
    if (lines[0]?.startsWith('#!')) {
        vToO.set(vLine, 0);
        oToV.set(0, vLine);
        lineKind.set(vLine, { kind: 'code' });
        virtualLines.push(lines[0]);
        vLine++; oLine = 1;
    }

    // --- Fix #7: hoist imports AND map each hoisted line back to its real source line.
    // Without this, a module-resolution error on a hoisted line would fall through
    // `?? vStart.line` and land on the wrong original line.
    for (const imp of importAnnotations) {
        virtualLines.push(`import ${imp.ety.slice(7)};`); // "import { User } from './types'"
        vToO.set(vLine, imp.originalLine);
        // --- Fix #4: tag as 'import' so a diagnostic here underlines the real
        // // T: import comment span, not a 6-column-shifted spot on that line.
        lineKind.set(vLine, { kind: 'import', commentRange: imp.commentRange });
        // oToV deliberately NOT set: the real // T: import comment line still
        // exists in place and gets its oToV entry during the flush below, so
        // oToV keeps pointing at the actual source line, not the hoisted copy.
        vLine++;
    }

    const sorted = [...typeAnnotations].sort((a, b) => a.originalLine - b.originalLine);

    for (const ann of sorted) {
        // Flush original lines up to (not including) the annotation's target line
        while (oLine < ann.originalLine) {
            vToO.set(vLine, oLine);
            oToV.set(oLine, vLine);
            lineKind.set(vLine, { kind: 'code' });
            virtualLines.push(lines[oLine]);
            vLine++; oLine++;
        }

        // Insert JSDoc above the annotated line
        const jsdoc = toJsDocType(ann.ety, ann.kind);
        const jsdocLines = jsdoc.split('\n');
        for (const jl of jsdocLines) {
            // Map inserted JSDoc lines back to the annotation's original line.
            // NOTE: Do NOT map the annotated line itself (oToV) here.
            // It is mapped in the next while-loop iteration or the final flush.
            // This "delayed mapping" is intentional: oToV ends up pointing to
            // the virtual line *after* the JSDoc block, where the actual code
            // lives. Adding oToV here would create an off-by-one that breaks
            // all hover positions. Trust the math.
            vToO.set(vLine, ann.originalLine); // vToO only — oToV is NOT set here
            // --- Fix #2: tag as 'jsdoc' so a diagnostic inside the type
            // annotation (e.g. a typo'd type name) underlines the // T: comment
            // text rather than a meaningless column on the code line.
            lineKind.set(vLine, { kind: 'jsdoc', commentRange: ann.commentRange });
            virtualLines.push(jl);
            vLine++;
        }
    }

    // Flush remaining original lines
    while (oLine < totalOriginalLines) {
        vToO.set(vLine, oLine);
        oToV.set(oLine, vLine);
        lineKind.set(vLine, { kind: 'code' });
        virtualLines.push(lines[oLine]);
        vLine++; oLine++;
    }

    return {
        virtualSource: virtualLines.join('\n'),
        vToO,
        oToV,
        lineKind,
    };
}
```

`character` offsets within any line are identical between original and virtual **only for real code lines**. Injected JSDoc lines and hoisted import lines have no column correspondence with the original, so diagnostics originating there are remapped to the owning `// T:` comment span (see Diagnostics, below). For code lines, only line numbers require translation.

---

## Phase 3: LSP Server

### Initialization

```bash
mkdir ety-lsp && cd ety-lsp && npm init -y
npm install vscode-languageserver vscode-languageserver-textdocument
```

```javascript
import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    TextDocumentSyncKind,
    DiagnosticSeverity,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fileURLToPath } from 'node:url';
import { parse_ety } from './ety-parser.node'; // napi-rs output
import ts from 'typescript';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// State maps are keyed by FILESYSTEM PATH, not by document.uri. The keys
// double as TypeScript file names, and module resolution calls fileExists /
// readFile on them against the real disk — fileExists('file:///dir/types.js')
// is always false, so URI keys silently break cross-file imports. The
// original URI rides inside the lineMaps entry for publishing diagnostics.
function uriToPath(uri) {
    return uri.startsWith('file://') ? fileURLToPath(uri) : uri;
}

const virtualDocs = new Map();   // path -> virtual source string
const lineMaps = new Map();      // path -> { vToO, oToV, lineKind, lineIndex, uri }
const versions = new Map();      // path -> document version (TS cache invalidation)
const diagTimers = new Map();    // path -> debounce timer for diagnostics
```

> **Implementation note (testability).** The snippets in this phase close over the module-level maps above for readability. The actual server factors every handler as a pure function over an injected `(state, deps)` pair — `state` bundling the four maps, `deps` carrying `connection`, `tsService`, and `parse_ety` — with `main.js` doing nothing but wiring. That shape is what lets the remapping and lifecycle logic unit-test without a connection or an editor.

### Capabilities

```javascript
let workspaceRoot = process.cwd(); // replaced by the real project root below

connection.onInitialize((params) => {
    // The user's project root. process.cwd() is only a fallback — in the
    // editor it is wherever the extension host spawned the server, and TS
    // walks UP from getCurrentDirectory to find node_modules/@types.
    const rootUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
    if (rootUri) workspaceRoot = uriToPath(rootUri);

    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            hoverProvider: true,
            // completionProvider is intentionally NOT declared — see "Deferred:
            // Autocompletion" below. Registering a ':' trigger here would advertise
            // a feature that returns nothing, because completion requested on a
            // // T: line lands inside a plain comment in the virtual document.
            //
            // diagnosticsProvider is NOT declared here either.
            // Diagnostics use the push model via connection.sendDiagnostics.
            // Pull model would use: diagnosticProvider: { interFileDependencies: false,
            //                                             workspaceDiagnostics: false }
        }
    };
});
```

> **Deferred: Autocompletion.** Type-name completion inside `// T:` does not work with the additive overlay as-is: the `// T:` line is still a plain comment in the virtual document, so `getCompletionsAtPosition` sees comment trivia and returns nothing. Making it work requires intercepting completion requests on `// T:` lines and *spoofing* the query position into the generated `/** @type {…} */` block — compute the cursor's offset within the type payload, add the JSDoc prefix length, and query TS there. Because `convertGenerics` can change payload length, that path reintroduces intra-line position tracking the rest of the design deliberately avoids. It is therefore a **v2 feature**; until it ships, leave `completionProvider` unregistered so the editor doesn't surface an empty dropdown. Hover and diagnostics are the core value and do not depend on it.

### TypeScript Language Service Host

> **Version Pinning (TS 6.0.3):** The TypeScript version is pinned exactly, alongside the Oxc pin. Three tests encode version-specific behavior that relies on this exact version: return-keyword anchoring, 80001 availability, and stale-cache semantics.

TypeScript never sees the real file for open documents: it reads **every** program file through `getScriptSnapshot`, where open documents come from `virtualDocs` and everything else — the standard lib, unopened imports — falls back to disk.

```javascript
const serviceHost = {
    getScriptFileNames: () => [...virtualDocs.keys()],
    getScriptVersion: (f) => (versions.get(f) ?? 0).toString(),
    getScriptSnapshot: (f) => {
        const virtual = virtualDocs.get(f);
        if (virtual !== undefined) return ts.ScriptSnapshot.fromString(virtual);
        // Disk fallback — NOT just for unopened imports (the documented v1
        // limitation): the language service loads EVERY program file through
        // getScriptSnapshot, including lib.es2022.d.ts itself. Returning
        // undefined here silently drops the standard lib (the host's readFile
        // only serves module resolution, never program file loading).
        // No try/catch needed: ts.sys.readFile catches internally and
        // returns undefined on ANY I/O error, permissions included.
        const disk = ts.sys.readFile(f);
        return disk !== undefined ? ts.ScriptSnapshot.fromString(disk) : undefined;
    },
    getCompilationSettings: () => ({
        allowJs: true,
        checkJs: true,
        // strict is off by default so untyped JS isn't flooded with
        // noImplicitAny/strictNullChecks errors on code the user hasn't
        // annotated yet. Make this configurable per-project if desired.
        strict: false,
        // Modern target + libs so the examples' fetch/crypto/Promise resolve
        // instead of erroring against an ancient default target with no DOM lib.
        target: ts.ScriptTarget.ES2022,
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
        // ESM source (with_module(true)) needs an explicit resolution strategy
        // or `./types` imports won't resolve.
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        // TS 6.0 breaking change: global node_modules/@types packages are no
        // longer included automatically — wildcard inclusion must be opted
        // into. Without this, @types/node etc. silently vanish.
        types: ['*'],
        // The documentSelector includes javascriptreact, so the service must
        // parse JSX rather than reading <div> as a comparison expression.
        // Preserve = type-check JSX without transforming it.
        jsx: ts.JsxEmit.Preserve,
    }),
    getCurrentDirectory: () => workspaceRoot, // see onInitialize in Capabilities
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    // Without these two, TS cannot ENUMERATE node_modules/@types — global
    // type packages silently stop resolving (fileExists alone only answers
    // point queries during module resolution).
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
};

const tsService = ts.createLanguageService(serviceHost);
```

> **Cross-file types (v1 limitation).** `getScriptFileNames` serves only documents in `virtualDocs` — i.e. files currently open in the editor. If an imported file (`./types.js`) is not open, TypeScript falls back to reading raw bytes from disk, sees a file with no transformed annotations, and reports the imported names as unknown. In v1, **imported files must be open** for their types to resolve. The v2 fix is *transform-on-read*: when `getScriptSnapshot` is asked for an unopened file, read it from disk, run `parse_ety` + `transformDocument`, cache the result, and serve that instead — plus a file watcher to invalidate the cache on external edits. This keeps the invariant that TypeScript only ever sees transformed virtual documents.

### Version Tracking (Critical)

The TypeScript compiler caches aggressively. If the virtual document is updated without changing `getScriptVersion`'s answer, TypeScript returns stale diagnostics. The LSP client already maintains `document.version` (1 on open, incremented on every change), so the server records that value rather than hand-rolling a counter.

> **One hook, not two.** `TextDocuments` fires `onDidChangeContent` for `didOpen` as well as for edits, so the single handler below covers both. Wiring an additional `onDidOpen` handler would run `processDocument` twice on every open.

> **URI vs. OS Path:** The LSP `document` uses `file:///...` URIs, but the state maps are keyed by filesystem path (see `uriToPath` in Initialization): the keys double as TypeScript file names, and module resolution calls `fileExists('file:///dir/types.js')` against the real filesystem, which always fails. Every handler converts at its boundary; only the publishing of diagnostics uses the original URI, carried in the `lineMaps` entry.

```javascript
documents.onDidChangeContent(({ document }) => {
    processDocument(document);
});

documents.onDidClose(({ document }) => {
    // Prevent unbounded growth: drop all per-document state on close.
    const path = uriToPath(document.uri);
    clearTimeout(diagTimers.get(path));
    diagTimers.delete(path);
    virtualDocs.delete(path);
    lineMaps.delete(path);
    versions.delete(path);
    connection.sendDiagnostics({ uri: document.uri, diagnostics: [] }); // clear squigglies
});

function processDocument(document) {
    const path = uriToPath(document.uri);
    try {
        const source = document.getText();
        const annotations = parse_ety(source); // one napi-rs crossing
        const { virtualSource, vToO, oToV, lineKind } = transformDocument(source, annotations);
        virtualDocs.set(path, virtualSource);
        // Build the LineIndex once here — reused by every diagnostic and hover
        // request. The original URI rides along for publishing diagnostics.
        lineMaps.set(path, { vToO, oToV, lineKind, lineIndex: new LineIndex(virtualSource), uri: document.uri });
        // document.version is LSP-maintained (didOpen: 1, then increments) —
        // distinct per content, which is all getScriptVersion needs.
        versions.set(path, document.version);
    } catch (err) {
        // Keep-last-good-state: a parse_ety throw (malformed addon input, a
        // future Rust panic surfaced as a JS error) must NOT wipe document
        // state — hover keeps answering from the previous virtual doc and
        // maps. No publish either: diagnostics would describe the stale doc.
        // Stale-but-working beats dead.
        connection.console.error(`ety: keeping last good state for ${document.uri}: ${err.stack ?? err}`);
        return;
    }

    // The Rust parse and the transform are cheap and run synchronously so hover
    // always has fresh maps. getSemanticDiagnostics is the expensive call —
    // debounce it so rapid typing doesn't queue a full TS check per keystroke.
    clearTimeout(diagTimers.get(path));
    diagTimers.set(path, setTimeout(() => pushDiagnostics(path), 200));
}
```

### Diagnostics

TypeScript reports `d.start` and `d.length` as **absolute byte offsets**, not positions. Convert them through `LineIndex` to a virtual `{ line, character }`. For a **code** line, only the line number is remapped and the character passes through unchanged. For an **injected** line — a JSDoc block (#2) or a hoisted import (#4) — the virtual column is meaningless on the original line, so the diagnostic is remapped to the owning `// T:` comment span instead, putting the squiggle on the annotation text the user can actually edit. Each diagnostic also carries a `category`, mapped to the corresponding LSP severity rather than forced to `Error`:

```javascript
function tsCategoryToSeverity(category) {
    switch (category) {
        case ts.DiagnosticCategory.Error:      return DiagnosticSeverity.Error;
        case ts.DiagnosticCategory.Warning:    return DiagnosticSeverity.Warning;
        case ts.DiagnosticCategory.Suggestion: return DiagnosticSeverity.Hint;
        case ts.DiagnosticCategory.Message:    return DiagnosticSeverity.Information;
        default:                               return DiagnosticSeverity.Error;
    }
}
```

```javascript
function pushDiagnostics(path) {
    const entry = lineMaps.get(path);
    if (!entry) return; // closed, or debounce fired before first processDocument
    const { vToO, lineIndex, lineKind, uri } = entry;

    // Syntactic diagnostics catch the user's plain JS syntax errors (and any
    // malformed injected JSDoc); semantic diagnostics catch type errors.
    // getSemanticDiagnostics alone silently drops parse errors.
    const located = [];
    for (const d of [
        ...tsService.getSyntacticDiagnostics(path),
        ...tsService.getSemanticDiagnostics(path),
    ]) {
        if (d.start === undefined) {
            // Project-level diagnostics (broken lib, bad compiler option)
            // carry no file location to squiggle. Don't drop them silently —
            // a misconfigured environment would be undebuggable; warn into
            // the client's output panel instead.
            connection.console.warn(
                `ety: project-level diagnostic for ${uri}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
            );
            continue;
        }
        located.push(d);
    }

    const diagnostics = located
        .map(d => {
            // 1. Absolute offset -> virtual { line, character }
            //    (d.length is optional in the TS typings — default to 0)
            const len = d.length ?? 0;
            const vStart = lineIndex.getLineAndChar(d.start);
            const vEnd   = lineIndex.getLineAndChar(d.start + len);

            // 2. Choose the range based on the kind of the originating line.
            const k = lineKind.get(vStart.line) ?? { kind: 'code' };
            let range;
            if (k.kind === 'code') {
                // Real code line: remap line numbers, pass characters through.
                range = {
                    start: { line: vToO.get(vStart.line) ?? vStart.line, character: vStart.character },
                    end:   { line: vToO.get(vEnd.line)   ?? vEnd.line,   character: vEnd.character },
                };
            } else {
                // #2 / #4: error originates in an injected JSDoc line or a hoisted
                // import. Underline the actual // T: comment span (precomputed in
                // transformDocument) instead of a bogus virtual column.
                range = k.commentRange;
            }

            return {
                range,
                message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
                severity: tsCategoryToSeverity(d.category),
            };
        });

    connection.sendDiagnostics({ uri, version: versions.get(path), diagnostics });
}
```

### Hover

Hover requests arrive with original-file positions. The line must be translated to its virtual equivalent, converted to an absolute offset for the TS API, then the returned span converted back. `getQuickInfoAtPosition` takes and returns absolute offsets, not positions.

> **Hovering over the `// T:` text itself needs no special handling.** Because the overlay is additive, every original line — including the comment lines — exists verbatim in the virtual document with its own `oToV` entry. A hover on the comment therefore lands inside comment trivia in the virtual doc, `getQuickInfoAtPosition` returns `undefined`, and the handler returns `null`. There is no character misalignment to guard against; the graceful no-op falls out of the architecture.

```javascript
connection.onHover(({ textDocument, position }) => {
    const path = uriToPath(textDocument.uri);
    const entry = lineMaps.get(path);
    if (!entry) return null; // not yet processed, or closed (race guard)
    const { oToV, vToO, lineIndex } = entry;

    // 1. Translate incoming original line -> virtual line
    const virtualLine = oToV.get(position.line) ?? position.line;

    // 2. Virtual { line, character } -> absolute offset for the TS API
    const virtualOffset = lineIndex.getOffset(virtualLine, position.character);

    const info = tsService.getQuickInfoAtPosition(path, virtualOffset);
    if (!info) return null;

    // 3. Returned absolute offsets -> virtual positions -> original lines
    const vStart = lineIndex.getLineAndChar(info.textSpan.start);
    const vEnd   = lineIndex.getLineAndChar(info.textSpan.start + info.textSpan.length);

    const oStartLine = vToO.get(vStart.line) ?? vStart.line;
    const oEndLine   = vToO.get(vEnd.line) ?? vEnd.line;

    return {
        contents: ts.displayPartsToString(info.displayParts),
        range: {
            start: { line: oStartLine, character: vStart.character },
            end:   { line: oEndLine,   character: vEnd.character },
        },
    };
});
```

---

## Phase 4: VS Code Extension

The extension has exactly one job — launch the server process and wire the protocol. No type logic lives here.

```bash
npx yo code  # choose "New Language Server Extension"
npm install vscode-languageclient
```

```javascript
import * as path from 'node:path';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node.js';

export function activate(context) {
    // Server launch MUST use the `module` + IPC fork form, not
    // `command: process.execPath`. Two reasons:
    //   1. Inside the extension host, process.execPath is the Electron binary,
    //      not node — a `command` launch would start Electron, never the server.
    //   2. TransportKind.ipc requires a forked child anyway: the IPC channel
    //      only exists between a parent and a child created via fork, which is
    //      exactly what the `module` form makes vscode-languageclient do
    //      (in the extension host's Node environment, via ELECTRON_RUN_AS_NODE).
    // The napi-rs addon is unaffected: Node-API is ABI-stable and loads fine
    // under Electron-as-Node.
    const serverModule = context.asAbsolutePath(path.join('server', 'src', 'main.js'));

    const client = new LanguageClient(
        'ety',
        'ety Language Server',
        {
            run:   { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc,
                     options: { execArgv: ['--nolazy', '--inspect=6009'] } },
        },
        {
            documentSelector: [
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'javascriptreact' }, // .jsx — {} generics exist to avoid JSX conflicts
            ],
        }
    );
    client.start();
    context.subscriptions.push(client);
}
```

---

## Build Order and Test Gates

Work through phases in strict order. Do not proceed past a gate until it passes. The transformer and line map logic in Phase 2 is where most bugs will surface — test it exhaustively with multi-annotation files before touching the TypeScript integration.

| Gate | What to Test |
|------|-------------|
| Gate 1 — after Phase 1 | Call `parse_ety` from a Node test script. Assert correct `node_start_offset`, `ety_start_offset`, and raw `ety` strings for a fixture file covering all node types: functions, arrow functions, class methods, variables, properties. **Assert deduplication:** a class-method fixture must yield exactly one annotation per physical `// T:` comment. **Assert statement-level variable matching:** `let x = 1, y = 2; // T: number` (single-line and multi-line forms) yields exactly one annotation with `node_start_offset` at the `let` keyword; a comment trailing a *non-final* line of a multi-line declaration yields **zero** annotations. |
| Gate 2 — after Phase 2 | Feed a known source with 5+ annotations to `transformDocument`. Assert the virtual document is identical to the original except for inserted JSDoc/import lines. Assert that `oToV` maps each original line to its virtual code line, and that `vToO` restricted to code lines is its inverse (`vToO` is many-to-one overall, since multiple JSDoc lines map to one original line, so they are *not* exact inverses). Assert character positions on any given code line are unchanged. Include a shebang fixture: `#!` must remain virtual line 0 with hoisted imports after it. Include a multi-line multi-declarator fixture: the JSDoc must inject above the `let`/`const` line, never mid-statement. |
| Gate 3a — after the TS host | Feed a known virtual document to `tsService.getSemanticDiagnostics`. Assert it returns errors for intentional type mismatches and no errors for correct code. **Must include a class-method fixture:** assert a deliberate type error inside a method body is caught via the injected `@type` above the method. `@type` on function *declarations* is confirmed TS behavior; on class *methods* it is unverified — if this fixture fails, add an `@param`/`@returns` generation branch for `kind === 'method'`. |
| Gate 3b — diagnostics in editor | Open a `.js` file in VS Code with a deliberate type error. Assert a red squiggly appears on the correct *original* line, not the shifted virtual line. Also assert a deliberate *syntax* error surfaces (syntactic diagnostics are included). |
| Gate 4 — extension | Hover over a typed variable. Assert the tooltip shows the resolved TypeScript type. |

---

## CLI Generator (Separate Tool)

The LSP (live editor feedback) and the CLI generator (`.d.ts` files for npm publishing) are distinct tools that share the same Rust parser and `toJsDocType` transformer. Only the output destination differs.

| Tool | Output | When |
|------|--------|------|
| LSP | In-memory virtual document | Every keystroke |
| `ety generate` | `.d.ts` files on disk | On save / CI |

The generator is out of scope for this specification but shares Phases 1 and 2 entirely.

---

## When to Use ety

| Scenario | ety Fit |
|----------|---------|
| Find JSDoc too verbose | ✅ Excellent |
| Cannot use TypeScript (organizational/legacy constraints) | ✅ Excellent |
| Building npm packages with JS source + types | ✅ Excellent |
| Migrating legacy JS codebase incrementally | ✅ Good |
| Greenfield project with full control | ⚠️ Consider TypeScript |
| Team unfamiliar with type systems | ⚠️ Training needed |
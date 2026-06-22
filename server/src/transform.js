// Phase 2: Node.js transformer (ety-lsp-spec.md).
// Pure functions only — no LSP, no TypeScript, no I/O. Everything here is
// unit-tested directly (implementation-plan.md, Methodology Rule 5).

// Offset <-> position conversion. The TS Compiler API returns diagnostics and
// hover spans as ABSOLUTE byte offsets, not { line, character } objects.
// Line-ending policy: '\n' is the sole terminator; CRLF is not normalized
// anywhere (both sides of the napi boundary must see identical bytes), so a
// '\r' is just the last character of its line.
export class LineIndex {
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

// s[i] must be the opening quote; returns the index just past the closing
// quote (or end of input if unclosed). Backslash escapes are honored.
const isQuote = c => c === "'" || c === '"' || c === '`';
function skipString(s, i) {
    const q = s[i]; i++;
    while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === q) { i++; break; }
        i++;
    }
    return i;
}

// THE tokenizer shared by every depth-aware scanner below. Yields string
// literals as atomic spans (their contents must never trip bracket/comma
// logic), '=>' as a single arrow token (its '>' must not unbalance generic
// depth), and every other character individually. Scanners keep their own
// depth rules but cannot drift on skip discipline — the drift bug this
// prevents was real (extractParamList once tracked only '()').
function* scan(s, i = 0) {
    while (i < s.length) {
        const c = s[i];
        if (isQuote(c)) {
            const end = skipString(s, i);
            yield { type: 'string', start: i, end };
            i = end;
        } else if (c === '=' && s[i + 1] === '>') {
            yield { type: 'arrow', start: i, end: i + 2 };
            i += 2;
        } else {
            yield { type: 'char', i, c };
            i++;
        }
    }
}

// The {} disambiguation rule (spec, Annotation Syntax): a `{` immediately
// after a type identifier is a generic (Map{string} -> Map<string>); a `{`
// whose matching `}` is immediately followed by `(` is a generic parameter
// list ({T}(...) -> <T>(...)); everything else is an object type, preserved
// verbatim. A stack matches closers to openers so nesting converts correctly;
// string literals are copied untouched.
export function convertGenerics(input) {
    // Unicode-aware: type names like Бокс are identifiers too (JS allows
    // them), so ASCII-only \w would silently demote Бокс{string} to an
    // object type.
    const isIdent = c => /[\p{L}\p{N}_$]/u.test(c);

    // Does the {…} starting at openIdx close with a '(' immediately after?
    const closesBeforeParen = (s, openIdx) => {
        let depth = 0;
        for (const t of scan(s, openIdx)) {
            if (t.type !== 'char') continue;
            if (t.c === '{') depth++;
            else if (t.c === '}' && --depth === 0) {
                let j = t.i + 1; while (j < s.length && /\s/.test(s[j])) j++;
                return s[j] === '(';
            }
        }
        return false;
    };

    let out = '';
    const stack = []; // 'generic' | 'object'
    for (const t of scan(input)) {
        if (t.type !== 'char') {                       // strings and '=>' copy verbatim
            out += input.slice(t.start, t.end);
            continue;
        }
        const c = t.c;
        if (c === '{') {
            // #9 fix: check the IMMEDIATE predecessor, not the last non-space
            // char — a space before `{` makes it an object type, so
            // `Map {string}` must NOT be read as a generic. out's last char
            // equals input[t.i - 1] (non-brace chars are copied verbatim).
            const prevChar = out[out.length - 1];
            const kind = (prevChar && isIdent(prevChar)) || closesBeforeParen(input, t.i) ? 'generic' : 'object';
            stack.push(kind);
            out += kind === 'generic' ? '<' : '{';
        } else if (c === '}') {
            out += (stack.pop() ?? 'object') === 'generic' ? '>' : '}';
        } else {
            out += c;
        }
    }
    return out;
}

// Split on top-level commas only — ignores nested (), [], <>, {}, and strings.
// Runs after convertGenerics, so <> are generic delimiters; '=>' is skipped
// so its '>' doesn't unbalance the depth counter.
export function splitTopLevel(s) {
    const parts = []; let depth = 0, start = 0;
    for (const t of scan(s)) {
        if (t.type !== 'char') continue;               // strings and '=>' are not structure
        const c = t.c;
        if ('([<{'.includes(c)) depth++;
        else if (')]>}'.includes(c)) depth--;
        else if (c === ',' && depth === 0) { parts.push(s.slice(start, t.i).trim()); start = t.i + 1; }
    }
    const last = s.slice(start).trim();
    if (last) parts.push(last);
    return parts;
}

// Find the function's parameter list: the first top-level "(...)" group that
// is immediately followed by '=>'. Returns { before, inner, after } or null.
// Tracks ALL bracket kinds (like splitTopLevel) — tracking only '()' would
// let a generic constraint containing a function type, e.g.
// <T extends () => void>(x: T) => T, be mistaken for the parameter list via
// the '()' inside the constraint.
export function extractParamList(s) {
    let depth = 0, open = -1;
    for (const t of scan(s)) {
        if (t.type !== 'char') continue;
        const c = t.c;
        if ('([<{'.includes(c)) {
            if (c === '(' && depth === 0 && open === -1) open = t.i;
            depth++;
        } else if (')]>}'.includes(c)) {
            depth--;
            if (c === ')' && depth === 0 && open !== -1) {
                // A top-level (...) group is the parameter list ONLY if it is
                // immediately followed by '=>'. Otherwise it is a grouped or
                // return type (e.g. "((string) => void)"); reset, keep scanning.
                let j = t.i + 1; while (j < s.length && /\s/.test(s[j])) j++;
                if (s[j] === '=' && s[j + 1] === '>') {
                    return { before: s.slice(0, open), inner: s.slice(open + 1, t.i), after: s.slice(t.i + 1) };
                }
                open = -1;
            }
        }
    }
    return null;
}

// True iff s starts with '(' and its matching ')' closes at depth 0 with only
// whitespace after — i.e. s is exactly a parameter list, no return type. Reuses
// the shared `scan` tokenizer so string/'=>' skip discipline is inherited.
export function isBareParamList(s) {
    if (!s.startsWith('(')) return false;
    let depth = 0;
    for (const t of scan(s)) {
        if (t.type !== 'char') continue;
        if ('([<{'.includes(t.c)) depth++;
        else if (')]>}'.includes(t.c) && --depth === 0) {
            return s.slice(t.i + 1).trim() === '';
        }
    }
    return false;
}

// Raw //T payload -> a JSDoc tag. TypeScript understands full function
// signatures inside @type, so no @param/@returns generation is needed in v1.
// The one exception is a class, whose {T} payload becomes @template.
export function toJsDocType(ety, kind) {
    // Step 0: a raw */ in the payload would terminate the injected
    // /** … */ mid-line and dump the rest into the virtual doc as code.
    // Neutralize it — the type is still wrong, so TS reports an error that
    // the handlers remap onto the // T: comment the user can actually edit.
    ety = ety.replaceAll('*/', '* /');

    // Step 1: class-level generic params -> @template (NOT @type). A
    // standalone {T} is classified as an OBJECT by convertGenerics (no
    // preceding identifier, no trailing paren), so routing a class through
    // the normal path would emit /** @type {{T}} */.
    if (kind === 'class') {
        const m = ety.trim().match(/^\{(.+)\}$/);          // "{T}" or "{T, U}"
        if (m) return `/** @template ${m[1].trim()} */`;   // "@template T" / "@template T, U"
        // A class with no generics carries no // T: annotation, so a non-{...}
        // payload here is malformed; fall through to @type rather than crash.
        // Milestone 4 must surface this case as a diagnostic on the // T:
        // comment instead of relying on what TS makes of the fallback.
    }

    // Step 2: {} -> <> for generics only (object types preserved)
    let angleFixed = convertGenerics(ety);

    // Step 3: only attempt parameter naming for a genuine top-level function
    // signature. Strip a leading generic param list <...>, then require the
    // remainder to start with '(' or 'new ('. Anything else (union, tuple,
    // object, plain type) is wrapped in @type verbatim — extractParamList
    // would mangle an inner '('. The strip skips strings and '=>' so a
    // constraint like <T extends () => void> doesn't miscount.
    let s = angleFixed.trim();
    if (s.startsWith('<')) {
        let depth = 0, end = s.length;
        for (const t of scan(s)) {
            if (t.type !== 'char') continue;
            if (t.c === '<') depth++;
            else if (t.c === '>' && --depth === 0) { end = t.i + 1; break; }
        }
        s = s.slice(end).trim();
    }

    // Void-return shorthand (functions only): a bare parameter list with no
    // declared return type implies `=> void` (spec: "(string)" === "(string) =>
    // void"). Gate on kind — a VARIABLE annotated `(string)` keeps its
    // parenthesized-type meaning, so this must not fire there. Append to both
    // `angleFixed` (extractParamList consumes it) and `s` (keeps the
    // startsWith('(') path alive below).
    if (kind === 'function' && isBareParamList(s)) {
        angleFixed += ' => void';
        s += ' => void';
    }

    if (!s.startsWith('(') && !s.startsWith('new (')) {
        return `/** @type {${angleFixed}} */`;
    }

    // Step 4: name top-level parameters (depth-aware extraction + split).
    const pl = extractParamList(angleFixed);
    if (!pl) return `/** @type {${angleFixed}} */`;

    const named = splitTopLevel(pl.inner).map((p, i) => {
        // If the parameter already carries a top-level name (`name: Type`),
        // pass it through unchanged. Only a ':' at bracket-depth 0 counts as
        // a name separator, so the ':' inside an object type or a nested
        // function type does not trigger; strings and '=>' are skipped.
        let depth = 0, hasName = false;
        for (const t of scan(p)) {
            if (t.type !== 'char') continue;
            if ('<({['.includes(t.c)) depth++;
            else if (')}]>'.includes(t.c)) depth--;
            else if (t.c === ':' && depth === 0) { hasName = true; break; }
        }
        if (hasName) return p; // already named, e.g. "role?: Role"

        const optional = p.endsWith('?');
        const type = optional ? p.slice(0, -1).trim() : p;
        return `p${i}${optional ? '?' : ''}: ${type}`;
    }).join(', ');

    return `/** @type {${pl.before}(${named})${pl.after}} */`;
}

// Assemble per-parameter annotations (kind 'param'/'return', all owned by one
// function) into a single multi-line @param/@returns JSDoc block — an injection
// unit. Each line carries the commentRange of the // T: it came from, so a bad
// param type underlines THAT param's comment. Param types and the return type
// run through convertGenerics (so Box{T} etc. still work); names pass verbatim.
export function buildParamUnit(group, descLines = []) {
    const neutralize = s => s.replaceAll('*/', '* /'); // never terminate the block early
    const params = group.filter(a => a.kind === 'param').sort((a, b) => a.etyStartOffset - b.etyStartOffset);
    const ret = group.find(a => a.kind === 'return');

    const lines = [{ text: '/**', commentRange: (params[0] ?? ret).commentRange }];
    for (const d of descLines) lines.push(d); // already-formatted ` * …` JSDoc lines
    for (const p of params) {
        const ty = neutralize(convertGenerics(p.ety));
        const doc = p.doc ? ` ${neutralize(p.doc)}` : '';
        lines.push({ text: ` * @param {${ty}} ${p.name}${doc}`, commentRange: p.commentRange });
    }
    if (ret) {
        lines.push({ text: ` * @returns {${neutralize(convertGenerics(ret.ety))}}`, commentRange: ret.commentRange });
    }
    lines.push({ text: ' */', commentRange: (ret ?? params[params.length - 1]).commentRange });

    return { originalLine: group[0].originalLine, lines };
}

// Split one callback parameter into { pname, ptype, optional }. A top-level
// `name: Type` keeps its name (a trailing `?` marks it optional); a positional
// `Type` (or `Type?`) gets a synthetic `pN` — @callback's @param tags require
// a name. Scans skip strings; depth tracks brackets so a ':' inside an object
// or nested function type is not mistaken for the name separator.
function splitParamNameType(p, i) {
    let depth = 0, colon = -1;
    for (const t of scan(p)) {
        if (t.type !== 'char') continue;
        if ('<({['.includes(t.c)) depth++;
        else if (')}]>'.includes(t.c)) depth--;
        else if (t.c === ':' && depth === 0) { colon = t.i; break; }
    }
    if (colon !== -1) {
        let pname = p.slice(0, colon).trim();
        const optional = pname.endsWith('?');
        if (optional) pname = pname.slice(0, -1).trim();
        return { pname, ptype: p.slice(colon + 1).trim(), optional };
    }
    const trimmed = p.trim();
    const optional = trimmed.endsWith('?');
    return { pname: `p${i}`, ptype: optional ? trimmed.slice(0, -1).trim() : trimmed, optional };
}

// Decompose a callback's function-type body into a JSDoc @callback block.
// Order is load-bearing: any descriptor lines (`// T: #`) come first, then the
// @template tags, which MUST precede @callback (TS 6.0.3 emits error 8039
// otherwise — proven by the Milestone de-risk probe). A bare param list with no
// `=>` implies `=> void` (the same shorthand toJsDocType uses). Generics in
// param/return types run through convertGenerics (Box{T} → Box<T>).
export function buildCallbackBlock(name, body, descLines = []) {
    const neutralize = s => s.replaceAll('*/', '* /'); // never terminate the block early
    let s = neutralize(convertGenerics(body)).trim();

    // Strip a leading <...> generic param list into @template tags.
    const templates = [];
    if (s.startsWith('<')) {
        let depth = 0, end = s.length;
        for (const t of scan(s)) {
            if (t.type !== 'char') continue;
            if (t.c === '<') depth++;
            else if (t.c === '>' && --depth === 0) { end = t.i + 1; break; }
        }
        for (const tp of splitTopLevel(s.slice(1, end - 1))) templates.push(tp.trim());
        s = s.slice(end).trim();
    }

    // Void-return shorthand: `(string)` means `(string) => void`.
    if (isBareParamList(s)) s += ' => void';

    const lines = ['/**'];
    for (const d of descLines) lines.push(` * ${neutralize(d)}`);
    for (const tp of templates) lines.push(` * @template ${tp}`);
    lines.push(` * @callback ${name}`);

    const pl = extractParamList(s);
    if (pl) {
        splitTopLevel(pl.inner).forEach((p, i) => {
            const { pname, ptype, optional } = splitParamNameType(p, i);
            lines.push(` * @param {${ptype}} ${optional ? `[${pname}]` : pname}`);
        });
        lines.push(` * @returns {${pl.after.replace(/^\s*=>\s*/, '').trim() || 'void'}}`);
    } else {
        // No recognizable `(params) =>` shape (malformed body) — emit a bare
        // @callback so TS reports an error remapped onto the // T: comment.
        lines.push(' * @returns {void}');
    }
    lines.push(' */');
    lines.push(`export const ${name} = {};`);
    return lines;
}

// Split a property/segment at its first TOP-LEVEL " - " — the per-property
// description separator (mirroring the param ` - ` convention). The shared
// scanner skips strings, generics, and nested brackets, so a dash inside a type
// or a string literal is never mistaken for the separator. Returns
// { head, desc }, with desc '' when there is no top-level " - ".
function splitTopLevelDash(s) {
    let depth = 0;
    for (const t of scan(s)) {
        if (t.type !== 'char') continue;
        if ('([<{'.includes(t.c)) depth++;
        else if (')]>}'.includes(t.c)) depth--;
        else if (t.c === '-' && depth === 0 && s[t.i - 1] === ' ' && s[t.i + 1] === ' ') {
            return { head: s.slice(0, t.i).trim(), desc: s.slice(t.i + 1).trim() };
        }
    }
    return { head: s.trim(), desc: '' };
}

// Parse one object-type member `[readonly] name[?]: type [ - description]` into
// its parts. Returns null for anything that is not a clean named property —
// index signatures (`[k: string]: V`), call signatures, or malformed members —
// so the caller can fall back to inline-object emission. (readonly is parsed off
// but cannot be expressed as @property, so it is dropped in the expanded form;
// per the spec, readonly and per-property descriptions are mutually exclusive.)
function parseObjectProp(member) {
    const { head, desc } = splitTopLevelDash(member);
    let h = head.startsWith('readonly ') ? head.slice('readonly '.length).trim() : head;
    if (h.startsWith('[')) return null; // index signature — not an @property
    let depth = 0, colon = -1;
    for (const t of scan(h)) {
        if (t.type !== 'char') continue;
        if ('([<{'.includes(t.c)) depth++;
        else if (')]>}'.includes(t.c)) depth--;
        else if (t.c === ':' && depth === 0) { colon = t.i; break; }
    }
    if (colon === -1) return null;
    let name = h.slice(0, colon).trim();
    const optional = name.endsWith('?');
    if (optional) name = name.slice(0, -1).trim();
    if (!name) return null;
    return { name, type: h.slice(colon + 1).trim(), optional, desc };
}

// If `body` is an object type whose members carry at least one per-property
// description, parse it into members for @property expansion. Returns null when
// the body is not an object type, has no descriptions (inline-object is then
// strictly better — it preserves readonly and nesting), or contains a member
// that cannot be expressed as @property. Operates on the RAW body (before
// convertGenerics) so a description's free text never reaches the {}-scanner.
function objectPropsWithDescriptions(body) {
    const s = body.trim();
    if (!s.startsWith('{') || !s.endsWith('}')) return null;
    const inner = s.slice(1, -1).trim();
    if (!inner) return null;
    const props = [];
    for (const member of splitTopLevel(inner)) {
        const p = parseObjectProp(member);
        if (!p) return null;
        props.push(p);
    }
    return props.some(p => p.desc) ? props : null;
}

// Build the hoisted JSDoc block for a typedef: descriptor lines (from `// T: #`)
// first, then either an inline-object @typedef (the default — preserves
// readonly and nesting) or, when the body is an object type carrying
// per-property descriptions, an @typedef {Object} + @property expansion (the
// only form that can hold per-property text). Always closed by the synthetic
// `export const Name = {}` that makes the typedef importable across files.
export function buildTypedefBlock(name, body, descLines = []) {
    const neutralize = s => s.replaceAll('*/', '* /'); // never terminate the block early
    const lines = ['/**'];
    for (const d of descLines) lines.push(` * ${neutralize(d)}`);

    const props = objectPropsWithDescriptions(body);
    if (props) {
        lines.push(` * @typedef {Object} ${name}`);
        for (const p of props) {
            const named = p.optional ? `[${p.name}]` : p.name;
            const desc = p.desc ? ` - ${neutralize(p.desc)}` : '';
            lines.push(` * @property {${neutralize(convertGenerics(p.type))}} ${named}${desc}`);
        }
    } else {
        lines.push(` * @typedef {${neutralize(convertGenerics(body))}} ${name}`);
    }
    lines.push(' */');
    lines.push(`export const ${name} = {};`);
    return lines;
}

// Resolve the set of ORIGINAL line numbers suppressed by `// T: ignore`
// directives. Single-line forms (`ignore`/`i`) mark their own line; block
// forms (`ignore-start`/`ignore-end`) mark the inclusive range between a start
// and the next end. Directives are processed in source order so pairing is
// well defined regardless of how the parser ordered them.
function computeIgnoredLines(directives, totalOriginalLines) {
    const set = new Set();
    let blockStart = null; // line of the currently open ignore-start, or null
    for (const a of [...directives].sort((x, y) => x.originalLine - y.originalLine)) {
        if (a.ety === 'ignore-start') {
            // Keep the OUTERMOST open start: a nested start is a no-op since the
            // outer range, once closed, already covers it.
            if (blockStart === null) blockStart = a.originalLine;
        } else if (a.ety === 'ignore-end') {
            if (blockStart !== null) {
                for (let l = blockStart; l <= a.originalLine; l++) set.add(l);
                blockStart = null;
            }
            // else: stray ignore-end with no open block — no-op.
        } else {
            // `ignore` / `i`: suppress this one line.
            set.add(a.originalLine);
        }
    }
    // Unclosed ignore-start suppresses through the end of the file.
    if (blockStart !== null) {
        for (let l = blockStart; l < totalOriginalLines; l++) set.add(l);
    }
    return set;
}

// Build the virtual document (strictly additive overlay) and the line maps.
// Insertions are always FULL lines — JSDoc above annotated nodes, hoisted
// imports at the top — so character offsets within any code line are
// identical between original and virtual, and the entire source map is two
// line-number maps. Injected lines carry the owning // T: comment span so
// diagnostics originating there can be remapped onto editable text.
export function transformDocument(source, annotations) {
    const lines = source.split('\n');
    const totalOriginalLines = lines.length;

    // No line field crosses the napi boundary; derive originalLine here from
    // the byte offset, and precompute the // T: comment span while the
    // original-source LineIndex is in scope.
    const origIndex = new LineIndex(source);
    const withLines = annotations.map(a => ({
        ...a,
        originalLine: origIndex.getLineAndChar(a.nodeStartOffset).line,
        commentRange: {
            start: origIndex.getLineAndChar(a.etyStartOffset),
            end:   origIndex.getLineAndChar(a.etyEndOffset),
        },
    }));

    // `// T: ignore` directives inject nothing — they only record which lines
    // pushDiagnostics should drop diagnostics on. Two forms share kind 'ignore':
    //   - single line: `// T: ignore` / `// T:i` suppress their own line;
    //   - block: `// T: ignore-start` … `// T: ignore-end` suppress every line
    //     in the inclusive range. An unclosed start runs to end of file; a
    //     stray end with no open start is a no-op; a nested start while a block
    //     is already open is ignored (the outer range already covers it).
    // Collect those lines, then exclude the directives from both streams.
    const ignoredLines = computeIgnoredLines(
        withLines.filter(a => a.kind === 'ignore'),
        totalOriginalLines,
    );
    // `// T: typedef` and `// T: callback` are standalone declarations, not
    // node-bound types — each is hoisted as its own synthetic block (below), so
    // keep them out of the import and type streams (their bodies are not
    // `import ...` payloads). `ignore` and `desc` inject nothing on their own
    // line, so they are kept out of both streams too.
    const isDecl = a => a.kind === 'typedef' || a.kind === 'callback';
    const isInert = a => a.kind === 'ignore' || a.kind === 'desc';
    const importAnnotations   = withLines.filter(a => !isInert(a) && !isDecl(a) && a.ety.startsWith('import '));
    const typeAnnotations     = withLines.filter(a => !isInert(a) && !isDecl(a) && !a.ety.startsWith('import '));
    const typedefAnnotations  = withLines.filter(a => a.kind === 'typedef').sort((a, b) => a.originalLine - b.originalLine);
    const callbackAnnotations = withLines.filter(a => a.kind === 'callback').sort((a, b) => a.originalLine - b.originalLine);

    // `// T: #` descriptors come in two flavors the parser already distinguishes:
    //   - NODE-LESS (nodeStartOffset === etyStartOffset): a module-scope `#` after
    //     a typedef/callback. Keyed by line; a decl's description is the run of
    //     contiguous `#` lines right below it (the spec places `#` under the decl).
    //   - NODE-BOUND (nodeStartOffset < etyStartOffset): a `#` inside a
    //     function/class/method body, bound to that node. Grouped by the node's
    //     start so it merges with the node's @type/@param block (or stands alone
    //     as a description-only block). An orphan `#` renders nothing and survives
    //     as a verbatim comment line.
    const descAnns = withLines.filter(a => a.kind === 'desc');
    const descByLine = new Map(
        descAnns.filter(a => a.nodeStartOffset === a.etyStartOffset).map(a => [a.originalLine, a.ety]),
    );
    const descLinesFor = decl => {
        const out = [];
        for (let l = decl.originalLine + 1; descByLine.has(l); l++) out.push(descByLine.get(l));
        return out;
    };
    const descByNode = new Map(); // nodeStartOffset -> [{ text, commentRange, originalLine }]
    for (const a of descAnns.filter(a => a.nodeStartOffset !== a.etyStartOffset)
        .sort((x, y) => x.etyStartOffset - y.etyStartOffset)) {
        if (!descByNode.has(a.nodeStartOffset)) descByNode.set(a.nodeStartOffset, []);
        descByNode.get(a.nodeStartOffset).push({ text: a.ety, commentRange: a.commentRange, originalLine: a.originalLine });
    }

    const virtualLines = [];
    const vToO = new Map();     // virtualLine -> originalLine
    const oToV = new Map();     // originalLine -> virtualLine
    const lineKind = new Map(); // virtualLine -> { kind: 'code'|'jsdoc'|'import', commentRange? }
    let vLine = 0;
    let oLine = 0;

    // Shebang guard: '#!' is only valid on the very first line. Flush it
    // BEFORE hoisting imports — otherwise the hoist pushes the shebang
    // mid-file and TS reports a phantom syntax error.
    if (lines[0]?.startsWith('#!')) {
        vToO.set(vLine, 0);
        oToV.set(0, vLine);
        lineKind.set(vLine, { kind: 'code' });
        virtualLines.push(lines[0]);
        vLine++; oLine = 1;
    }

    // Hoist imports AND map each hoisted line back to its real source line,
    // so a module-resolution error lands on the right original line.
    for (const imp of importAnnotations) {
        virtualLines.push(`import ${imp.ety.slice(7)};`);
        vToO.set(vLine, imp.originalLine);
        lineKind.set(vLine, { kind: 'import', commentRange: imp.commentRange });
        // oToV deliberately NOT set: the real // T: import comment line still
        // exists in place and gets its oToV entry during the flush below, so
        // oToV keeps pointing at the actual source line, not the hoisted copy.
        vLine++;
    }

    // Hoist typedefs to module scope (after imports, so a typedef can reference
    // an imported base type). Each becomes an inline-object @typedef block plus
    // a synthetic `export const Name = {}` — the export binding is REQUIRED for
    // cross-file resolution (de-risk #1: a bare @typedef leaves the file "not a
    // module"). Like imports, every synthetic line maps vToO -> the // T:
    // typedef comment and sets no oToV (the real comment keeps its own oToV in
    // the flush). Hoisting to the top means a typedef written inside a function
    // body still emits a LEGAL top-level export.
    for (const td of typedefAnnotations) {
        for (const text of buildTypedefBlock(td.name, td.ety, descLinesFor(td))) {
            virtualLines.push(text);
            vToO.set(vLine, td.originalLine);
            lineKind.set(vLine, { kind: 'typedef', commentRange: td.commentRange });
            vLine++;
        }
    }

    // Hoist callbacks after typedefs (a callback's param/return types may
    // reference a typedef or imported type). Same line-mapping discipline: each
    // synthetic line maps vToO -> the // T: callback comment, sets no oToV, and
    // a body-decomposition error remaps onto the comment via commentRange.
    for (const cb of callbackAnnotations) {
        for (const text of buildCallbackBlock(cb.name, cb.ety, descLinesFor(cb))) {
            virtualLines.push(text);
            vToO.set(vLine, cb.originalLine);
            lineKind.set(vLine, { kind: 'callback', commentRange: cb.commentRange });
            vLine++;
        }
    }

    // Turn annotations into injection UNITS: { originalLine, lines:[{text,
    // commentRange}] }. A regular annotation is one unit (its toJsDocType
    // output). Per-parameter annotations (kind 'param'/'return') sharing an
    // owning function are grouped into ONE @param/@returns block.
    const regular     = typeAnnotations.filter(a => a.kind !== 'param' && a.kind !== 'return');
    const paramReturn = typeAnnotations.filter(a => a.kind === 'param' || a.kind === 'return');

    // A node-bound `// T: #` descriptor becomes the leading description line(s)
    // of its node's JSDoc. Track which nodes had their descriptor consumed so a
    // node carrying ONLY a description still gets a block (below).
    const neutralize = s => s.replaceAll('*/', '* /');
    const descLines = node => (descByNode.get(node) ?? [])
        .map(d => ({ text: ` * ${neutralize(d.text)}`, commentRange: d.commentRange }));
    const consumedDescNodes = new Set();

    const units = regular.map(ann => {
        const ds = descLines(ann.nodeStartOffset);
        // No description → the existing single-line @type/@template projection.
        if (ds.length === 0) {
            return {
                originalLine: ann.originalLine,
                lines: toJsDocType(ann.ety, ann.kind).split('\n')
                    .map(text => ({ text, commentRange: ann.commentRange })),
            };
        }
        // Description present → fold the single-line JSDoc body into a block with
        // the description line(s) first (`/** … */` → `/**\n * desc\n * body\n */`).
        consumedDescNodes.add(ann.nodeStartOffset);
        const single = toJsDocType(ann.ety, ann.kind);
        const body = single.replace(/^\/\*\*\s*/, '').replace(/\s*\*\/$/, '');
        return {
            originalLine: ann.originalLine,
            lines: [
                { text: '/**', commentRange: ann.commentRange },
                ...ds,
                { text: ` * ${body}`, commentRange: ann.commentRange },
                { text: ' */', commentRange: ann.commentRange },
            ],
        };
    });

    // Precedence: a block-style annotation on a function wins over per-param
    // ones on the same node — drop the param group to avoid double injection.
    const regularNodes = new Set(regular.map(a => a.nodeStartOffset));
    const groups = new Map(); // nodeStartOffset -> param/return annotations
    for (const a of paramReturn) {
        if (regularNodes.has(a.nodeStartOffset)) continue;
        if (!groups.has(a.nodeStartOffset)) groups.set(a.nodeStartOffset, []);
        groups.get(a.nodeStartOffset).push(a);
    }
    for (const [node, group] of groups) {
        const ds = descLines(node);
        if (ds.length) consumedDescNodes.add(node);
        units.push(buildParamUnit(group, ds));
    }

    // A node whose ONLY annotation is a descriptor (e.g. `class C { // T: # … }`)
    // gets a description-only JSDoc block injected above it.
    for (const [node, ds] of descByNode) {
        if (consumedDescNodes.has(node)) continue;
        units.push({
            originalLine: ds[0].originalLine,
            lines: [
                { text: '/**', commentRange: ds[0].commentRange },
                ...ds.map(d => ({ text: ` * ${neutralize(d.text)}`, commentRange: d.commentRange })),
                { text: ' */', commentRange: ds[0].commentRange },
            ],
        });
    }

    units.sort((a, b) => a.originalLine - b.originalLine);

    for (const unit of units) {
        // Flush original lines up to (not including) the unit's line.
        while (oLine < unit.originalLine) {
            vToO.set(vLine, oLine);
            oToV.set(oLine, vLine);
            lineKind.set(vLine, { kind: 'code' });
            virtualLines.push(lines[oLine]);
            vLine++; oLine++;
        }

        // Insert the JSDoc above the annotated line.
        for (const { text, commentRange } of unit.lines) {
            // Map inserted JSDoc lines back to the unit's original line. Do NOT
            // set oToV here — the annotated line itself is mapped in the next
            // while-iteration or the final flush, so oToV ends up pointing at
            // the virtual line AFTER the JSDoc block, where the code actually
            // lives. This delayed mapping is intentional; adding oToV here would
            // off-by-one every hover. Trust the math.
            vToO.set(vLine, unit.originalLine);
            lineKind.set(vLine, { kind: 'jsdoc', commentRange });
            virtualLines.push(text);
            vLine++;
        }
    }

    // Flush remaining original lines.
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
        ignoredLines,
    };
}

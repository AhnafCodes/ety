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
    const angleFixed = convertGenerics(ety);

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

    const importAnnotations = withLines.filter(a => a.ety.startsWith('import '));
    const typeAnnotations   = withLines.filter(a => !a.ety.startsWith('import '));

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

    const sorted = [...typeAnnotations].sort((a, b) => a.originalLine - b.originalLine);

    for (const ann of sorted) {
        // Flush original lines up to (not including) the annotation's line.
        while (oLine < ann.originalLine) {
            vToO.set(vLine, oLine);
            oToV.set(oLine, vLine);
            lineKind.set(vLine, { kind: 'code' });
            virtualLines.push(lines[oLine]);
            vLine++; oLine++;
        }

        // Insert JSDoc above the annotated line.
        const jsdoc = toJsDocType(ann.ety, ann.kind);
        for (const jl of jsdoc.split('\n')) {
            // Map inserted JSDoc lines back to the annotation's original line.
            // Do NOT set oToV here — the annotated line itself is mapped in
            // the next while-iteration or the final flush, so oToV ends up
            // pointing at the virtual line AFTER the JSDoc block, where the
            // code actually lives. This delayed mapping is intentional;
            // adding oToV here would off-by-one every hover. Trust the math.
            vToO.set(vLine, ann.originalLine);
            lineKind.set(vLine, { kind: 'jsdoc', commentRange: ann.commentRange });
            virtualLines.push(jl);
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
    };
}

// Phase 3 handlers (ety-lsp-spec.md) as pure functions over injected state
// and deps — main.js owns the only connection wiring. Deviation from the
// spec's module-level globals, recorded there as a suggested edit.
//
// All state maps are keyed by FILESYSTEM PATH, not URI: these keys double as
// TypeScript file names, and module resolution calls fileExists/readFile on
// them against the real disk — 'file:///dir/types.js' never exists there.
// The original URI is kept inside the lineMaps entry for publishing.
import ts from 'typescript';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import { fileURLToPath } from 'node:url';
import { LineIndex, transformDocument } from './transform.js';
import { tsCategoryToSeverity } from './tsHost.js';

export const DEBOUNCE_MS = 200;

// The closed set this milestone offers — the JavaScript primitives. The instant
// an inferred type falls outside it, completion stays silent: that boundary is
// what keeps this a sliver and out of the deferred general-completion problem
// (implementation-plan.md, Milestone 9). `null`, `bigint`, and `symbol` round
// out the primitive set alongside the original four.
const BASE_TYPES = new Set(['string', 'number', 'boolean', 'undefined', 'null', 'bigint', 'symbol']);

// The second closed set (Milestone 11): built-in container/wrapper constructors,
// keyed by the inferred type's symbol name, mapped to a fixed ety-syntax
// skeleton. Curated, not general — anything off this table (and off BASE_TYPES)
// stays silent. Array is handled separately, since an array LITERAL ([]) and a
// `new Array()` share the same inferred type but want different skeletons.
const CONTAINER_TABLE = new Map([
    ['Map', 'Map{}'], ['Set', 'Set{}'],
    ['WeakMap', 'WeakMap{}'], ['WeakSet', 'WeakSet{}'],
    ['Promise', 'Promise{}'],
]);

// A skeleton completion offered as an LSP snippet: the label is the bare ety
// type (`Map{}`), the insertText drops the cursor inside the final bracket pair
// (`Map{$0}`) so the user types the args. Whole-token — the `$0` is a cursor
// hint, not an intra-line completion query, so the line-only invariant holds.
function skeletonItem(label) {
    return {
        label,
        kind: CompletionItemKind.Class,
        insertText: `${label.slice(0, -1)}$0${label.slice(-1)}`,
        insertTextFormat: InsertTextFormat.Snippet,
    };
}

// Map an inferred initializer type to the completion ety offers, or null when it
// falls outside both curated sets. Pure over (type, initializer node, checker):
//   primitive            -> the bare keyword (Milestone 9)
//   array literal `[]`   -> []        |  other array (new Array()) -> Array{}
//   empty object `{}`    -> {}        |  named container by symbol -> <Name>{}
export function inferEtyCompletion(type, initializer, checker) {
    const str = checker.typeToString(type);
    if (BASE_TYPES.has(str)) return { label: str, kind: CompletionItemKind.Keyword };
    if (checker.isArrayType(type)) {
        return skeletonItem(ts.isArrayLiteralExpression(initializer) ? '[]' : 'Array{}');
    }
    if (str === '{}' && ts.isObjectLiteralExpression(initializer)) return skeletonItem('{}');
    const name = type.getSymbol()?.getName();
    if (name && CONTAINER_TABLE.has(name)) return skeletonItem(CONTAINER_TABLE.get(name));
    return null;
}

export function uriToPath(uri) {
    if (uri.startsWith('file://')) return fileURLToPath(uri);
    // Unsaved buffers have no disk path: their URI is `untitled:Untitled-1`.
    // Passing that to the TS language service as a file name throws "Could not
    // find source file" — the colon breaks path normalization, and the missing
    // extension leaves the ScriptKind unknown. Synthesize a stable, sanitized
    // .jsx name instead: .jsx is a superset of .js, so it classifies plain JS
    // and JSX alike and still honors // T: JSDoc. The original URI is what we
    // publish diagnostics against (kept in lineMaps.uri); this is only the key.
    if (uri.startsWith('untitled:')) return uri.replace(/[^a-zA-Z0-9._-]/g, '_') + '.jsx';
    return uri;
}

export function createState() {
    return {
        virtualDocs: new Map(), // path -> virtual source string
        lineMaps: new Map(),    // path -> { vToO, oToV, lineKind, lineIndex, uri }
        versions: new Map(),    // path -> document version (TS cache invalidation)
        diagTimers: new Map(),  // path -> debounce timer for diagnostics
    };
}

// Parse + transform synchronously (cheap; hover always has fresh maps), then
// debounce the expensive TS check. A parse_ety throw (malformed addon input,
// future Rust panic surfaced as a JS error) must NOT wipe document state:
// keep the previous virtual doc and maps so hover keeps answering from the
// last good parse. Stale-but-working beats dead.
export function processDocument(state, deps, document) {
    const path = uriToPath(document.uri);
    try {
        const source = document.getText();
        const { virtualSource, vToO, oToV, lineKind } = transformDocument(source, deps.parse_ety(source));
        state.virtualDocs.set(path, virtualSource);
        state.lineMaps.set(path, {
            vToO, oToV, lineKind,
            lineIndex: new LineIndex(virtualSource),
            uri: document.uri,
        });
        // document.version is LSP-maintained (didOpen: 1, then increments) —
        // distinct per content, which is all getScriptVersion needs.
        state.versions.set(path, document.version ?? (state.versions.get(path) ?? 0) + 1);
    } catch (err) {
        deps.connection.console.error(`ety: keeping last good state for ${document.uri}: ${err.stack ?? err}`);
        return; // no publish either — diagnostics would describe the stale doc
    }
    clearTimeout(state.diagTimers.get(path));
    state.diagTimers.set(path, setTimeout(() => pushDiagnostics(state, deps, path), DEBOUNCE_MS));
}

// TS reports d.start/d.length as ABSOLUTE offsets in the VIRTUAL document.
// Code line: remap the line number, pass the character through (columns are
// identical by the additive-overlay invariant). Injected line (JSDoc or
// hoisted import): the virtual column is meaningless on the original line,
// so underline the owning // T: comment span instead.
export function pushDiagnostics(state, deps, path) {
    const entry = state.lineMaps.get(path);
    if (!entry) return; // closed, or debounce fired before first processDocument
    const { vToO, lineIndex, lineKind, uri } = entry;

    // Syntactic diagnostics catch the user's plain JS syntax errors;
    // getSemanticDiagnostics alone silently drops parse errors (pinned in
    // tshost.test.js).
    const located = [];
    for (const d of [
        ...deps.tsService.getSyntacticDiagnostics(path),
        ...deps.tsService.getSemanticDiagnostics(path),
    ]) {
        if (d.start === undefined) {
            // Project-level diagnostics (broken lib, bad compiler option)
            // carry no file location to squiggle. Don't drop them silently —
            // a misconfigured environment would be undebuggable; warn into
            // the client's output panel instead.
            deps.connection.console.warn(
                `ety: project-level diagnostic for ${uri}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`,
            );
            continue;
        }
        located.push(d);
    }

    const diagnostics = located
        .map(d => {
            const len = d.length ?? 0;
            const vStart = lineIndex.getLineAndChar(d.start);
            const vEnd = lineIndex.getLineAndChar(d.start + len);

            const k = lineKind.get(vStart.line) ?? { kind: 'code' };
            let range;
            if (k.kind === 'code') {
                range = {
                    start: { line: vToO.get(vStart.line) ?? vStart.line, character: vStart.character },
                    end:   { line: vToO.get(vEnd.line)   ?? vEnd.line,   character: vEnd.character },
                };
            } else {
                range = k.commentRange;
            }

            return {
                range,
                message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
                severity: tsCategoryToSeverity(d.category),
            };
        });

    deps.connection.sendDiagnostics({ uri, version: state.versions.get(path), diagnostics });
}

// Hover positions arrive in ORIGINAL coordinates; getQuickInfoAtPosition
// takes and returns absolute VIRTUAL offsets. Hovering the // T: text needs
// no special handling: the comment line exists verbatim in the virtual doc,
// so the query lands in comment trivia and TS returns undefined.
export function onHover(state, deps, { textDocument, position }) {
    const path = uriToPath(textDocument.uri);
    const entry = state.lineMaps.get(path);
    if (!entry) return null; // not yet processed, or closed (race guard)
    const { oToV, vToO, lineIndex } = entry;

    const virtualLine = oToV.get(position.line) ?? position.line;
    const virtualOffset = lineIndex.getOffset(virtualLine, position.character);

    const info = deps.tsService.getQuickInfoAtPosition(path, virtualOffset);
    if (!info) return null;

    const vStart = lineIndex.getLineAndChar(info.textSpan.start);
    const vEnd = lineIndex.getLineAndChar(info.textSpan.start + info.textSpan.length);

    return {
        contents: ts.displayPartsToString(info.displayParts),
        range: {
            start: { line: vToO.get(vStart.line) ?? vStart.line, character: vStart.character },
            end:   { line: vToO.get(vEnd.line)   ?? vEnd.line,   character: vEnd.character },
        },
    };
}

// Completion requests arrive in ORIGINAL coordinates. We offer exactly one kind
// of suggestion: when the cursor sits inside a `// T:` payload and the governed
// binding's inferred type is a primitive, suggest that primitive.
//
// The empty `// T:` the user is mid-typing renders `/** @type {} */`, which
// degrades the BINDING to `any` in the virtual doc (measured). So we never read
// the binding's type — we read the INITIALIZER expression's type, which the
// empty annotation does not touch, and widen its literal (0 -> number). Anything
// outside BASE_TYPES yields nothing: this is deliberately a sliver, not general
// completion (implementation-plan.md, Milestone 9).
export function onCompletion(state, deps, { textDocument, position }) {
    const path = uriToPath(textDocument.uri);
    const entry = state.lineMaps.get(path);
    if (!entry) return []; // not yet processed, or closed (race guard)
    const { oToV, lineKind, lineIndex } = entry;

    // Position guard: the cursor must sit inside the editable `// T:` span. The
    // injected jsdoc/import line for this original line carries that span as
    // commentRange (original coordinates), so a cursor on the code — or on any
    // other line — is excluded.
    const inPayload = [...lineKind.values()].some(k =>
        k.commentRange
        && k.commentRange.start.line === position.line
        && position.character >= k.commentRange.start.character
        && position.character <= k.commentRange.end.character);
    if (!inPayload) return [];

    const virtualLine = oToV.get(position.line);
    if (virtualLine === undefined) return [];

    // Stubbed services in unit tests don't expose getProgram; only the real TS
    // host can answer inference, which is exactly what this feature needs.
    const program = deps.tsService.getProgram?.();
    const sourceFile = program?.getSourceFile(path);
    if (!sourceFile) return [];
    const checker = program.getTypeChecker();

    // The binding governed by this annotation lives on the cursor's virtual code
    // line. Find that VariableDeclaration and read its initializer's widened
    // type — the empty `@type {}` poisons the binding, never the initializer.
    const lineStart = lineIndex.getOffset(virtualLine, 0);
    const nextStart = lineIndex.lineStarts[virtualLine + 1];
    const lineEnd = nextStart ?? Number.MAX_SAFE_INTEGER;

    let item = null;
    // Return true to short-circuit: ts.forEachChild only stops descending when
    // the callback returns a truthy value, so propagate it up the recursion to
    // halt the moment the governed binding is found.
    const visit = node => {
        if (ts.isVariableDeclaration(node) && node.initializer) {
            const nameStart = node.name.getStart(sourceFile);
            if (nameStart >= lineStart && nameStart < lineEnd) {
                const type = checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(node.initializer));
                item = inferEtyCompletion(type, node.initializer, checker);
                return true;
            }
        }
        return ts.forEachChild(node, visit);
    };
    visit(sourceFile);

    return item ? [item] : [];
}

// Prevent unbounded growth: drop all per-document state on close, cancel any
// pending debounce, and clear the document's squigglies in the editor.
export function onDidClose(state, deps, document) {
    const path = uriToPath(document.uri);
    clearTimeout(state.diagTimers.get(path));
    state.diagTimers.delete(path);
    state.virtualDocs.delete(path);
    state.lineMaps.delete(path);
    state.versions.delete(path);
    deps.connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
}

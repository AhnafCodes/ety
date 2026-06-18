// Milestone 9 (inference-driven base-type completion → Gate 7). RED FIRST:
// `onCompletion` does not exist yet, so importing it makes this suite fail —
// that is the intended starting state.
//
// These tests run the REAL pipeline (parse → transform → TS host), not a stub,
// because the entire risk of this feature lives in genuine inference. Measured:
// an empty `// T:` payload renders `/** @type {} */`, which degrades the binding
// to `any` in the live virtual document — exactly when completion is requested.
// A stub that "returns number" would pass a naive live-doc implementation and
// prove nothing. The headline test below only passes if inference is read from
// a CLEAN projection (empty annotation stripped), which is the design constraint
// this milestone exists to force (implementation-plan.md, Milestone 9).
import { describe, it, expect, vi } from 'vitest';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import { createState, processDocument, onCompletion } from '../src/handlers.js';
import { createTsService } from '../src/tsHost.js';
import { parse_ety } from '../src/parser.js';

const PATH = '/synthetic/doc.js';

// Build real per-document state for `source`, then return a function that asks
// for completions at a character on line 0 (original coordinates).
function realSetup(source) {
    const state = createState();
    const deps = {
        connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn(), warn: vi.fn() } },
        parse_ety,
    };
    deps.tsService = createTsService({ virtualDocs: state.virtualDocs, versions: state.versions });
    processDocument(state, deps, { uri: PATH, version: 1, getText: () => source });
    const itemsAt = character => onCompletion(state, deps, {
        textDocument: { uri: PATH },
        position: { line: 0, character },
    }) ?? [];
    const labelsAt = character => itemsAt(character).map(i => i.label);
    return { labelsAt, itemsAt, source };
}

// Cursor just past the colon of `// T:` — where the user would start typing the
// type. `indexOf('// T:') + '// T:'.length` keeps it robust to leading code.
const afterColon = source => source.indexOf('// T:') + '// T:'.length;

describe('onCompletion — inference-driven base-type suggestion (REAL TS)', () => {
    it('suggests the inferred primitive for an un-annotated // T: binding, despite the live doc inferring any', () => {
        // The headline de-risk test. `let i = 0; // T:` injects `/** @type {} */`,
        // so the LIVE virtual document infers `let i: any`. The suggestion must
        // still be `number` — proving inference came from a clean projection.
        const source = 'let i = 0; // T:\n';
        const { labelsAt } = realSetup(source);
        expect(labelsAt(afterColon(source))).toContain('number');
    });

    it('reads the primitive from genuine inference, not a hardcoded number', () => {
        const s = 'let s = "x"; // T:\n';
        const b = 'let b = true; // T:\n';
        expect(realSetup(s).labelsAt(afterColon(s))).toContain('string');
        expect(realSetup(b).labelsAt(afterColon(b))).toContain('boolean');
    });

    it('covers the full primitive set: null, bigint, symbol', () => {
        const cases = {
            null:   'let x = null; // T:\n',
            bigint: 'let x = 10n; // T:\n',
            symbol: 'let x = Symbol(); // T:\n',
        };
        for (const [type, src] of Object.entries(cases)) {
            expect(realSetup(src).labelsAt(afterColon(src))).toContain(type);
        }
    });

    it('excludes non-primitive inferred types — the sliver stays a sliver', () => {
        // `{ a: number }` is outside the closed primitive set, so nothing is
        // offered. This is the guard against creeping back into the deferred
        // general-completion problem.
        const source = 'let o = { a: 1 }; // T:\n';
        const labels = realSetup(source).labelsAt(afterColon(source));
        expect(labels).not.toContain('number');
        expect(labels).toHaveLength(0);
    });

    it('does not fire outside the // T: payload (cursor on the code)', () => {
        // Completion requested on `i` in `let i`, not inside the comment, must
        // not surface a base-type item.
        const source = 'let i = 0; // T:\n';
        expect(realSetup(source).labelsAt(4)).toHaveLength(0); // char 4 = 'i'
    });
});

describe('onCompletion — container & built-in skeletons (Milestone 11, REAL TS)', () => {
    // Each row: source initializer -> the ety-syntax skeleton offered, and the
    // snippet insertText whose $0 lands the cursor where type args go.
    const cases = [
        ['let user = {};',          '{}',         '{$0}'],
        ['let matrix = [];',        '[]',         '[$0]'],
        ['let a = new Array();',    'Array{}',    'Array{$0}'],
        ['let m = new Map();',      'Map{}',      'Map{$0}'],
        ['let s = new Set();',      'Set{}',      'Set{$0}'],
        ['let w = new WeakMap();',  'WeakMap{}',  'WeakMap{$0}'],
        ['const res = fetch();',    'Promise{}',  'Promise{$0}'],
    ];
    for (const [code, label, insert] of cases) {
        it(`offers ${label} for ${JSON.stringify(code)}`, () => {
            const source = `${code} // T:\n`;
            const items = realSetup(source).itemsAt(afterColon(source));
            expect(items).toHaveLength(1);
            expect(items[0].label).toBe(label);
            expect(items[0].insertText).toBe(insert);
            expect(items[0].insertTextFormat).toBe(InsertTextFormat.Snippet);
        });
    }

    it('boundary: a user-class instance offers nothing (not in the curated table)', () => {
        const source = 'class Foo {} let x = new Foo(); // T:\n';
        expect(realSetup(source).labelsAt(afterColon(source))).toHaveLength(0);
    });

    it('boundary: a POPULATED object literal still offers nothing (only empty {} maps)', () => {
        const source = 'let o = { a: 1 }; // T:\n';
        expect(realSetup(source).labelsAt(afterColon(source))).toHaveLength(0);
    });
});

// The literal/constructor cases above prove the curated sets work, but the real
// daily driver is inference flowing through a FUNCTION or METHOD return type —
// `fetch()` -> Promise<Response>, `[].map()` -> T[], `JSON.stringify()` -> string.
// The initializer here is a CallExpression, never a literal or `new`, so these
// also pin the array-literal vs. array-result split (`[]` only fires for an
// actual ArrayLiteralExpression; a call that returns an array gets `Array{}`).
describe('onCompletion — inference through function & method return types (REAL TS)', () => {
    // Calls whose return type lands inside BASE_TYPES -> bare keyword.
    const primitiveCalls = [
        ['let s = JSON.stringify({ a: 1 });', 'string'],
        ['let n = parseInt("42", 10);',       'number'],
        ['let n = Math.max(1, 2);',           'number'],
        ['let t = Date.now();',               'number'],
        ['let c = "abc".charAt(0);',          'string'],
        ['let p = "42".padStart(3, "0");',    'string'],
        ['let b = Array.isArray([]);',        'boolean'],
    ];
    for (const [code, type] of primitiveCalls) {
        it(`infers ${type} from ${JSON.stringify(code)}`, () => {
            const source = `${code} // T:\n`;
            const items = realSetup(source).itemsAt(afterColon(source));
            expect(items).toHaveLength(1);
            expect(items[0].label).toBe(type);
            expect(items[0].kind).toBe(CompletionItemKind.Keyword);
        });
    }

    // Calls returning an array (T[]) collapse to the Array{} skeleton — distinct
    // from the `[]` an array LITERAL initializer earns, because the initializer
    // node is a call, not an ArrayLiteralExpression.
    const arrayCalls = [
        'let xs = [1, 2, 3].map(x => x * 2);',
        'let ks = Object.keys({ a: 1 });',
        'let es = Object.entries({ a: 1 });',
        'let ys = Array.from("ab");',
        'let parts = "a,b,c".split(",");',
    ];
    for (const code of arrayCalls) {
        it(`offers Array{} for ${JSON.stringify(code)}`, () => {
            const source = `${code} // T:\n`;
            const items = realSetup(source).itemsAt(afterColon(source));
            expect(items).toHaveLength(1);
            expect(items[0].label).toBe('Array{}');
            expect(items[0].insertText).toBe('Array{$0}');
            expect(items[0].insertTextFormat).toBe(InsertTextFormat.Snippet);
        });
    }

    // Calls returning a Promise resolve to the curated Promise{} skeleton by the
    // inferred type's symbol name, regardless of how the promise was produced.
    const promiseCalls = [
        'const r = fetch("/api");',
        'const p = Promise.resolve(1);',
        'const all = Promise.all([fetch("/a")]);',
    ];
    for (const code of promiseCalls) {
        it(`offers Promise{} for ${JSON.stringify(code)}`, () => {
            const source = `${code} // T:\n`;
            const items = realSetup(source).itemsAt(afterColon(source));
            expect(items).toHaveLength(1);
            expect(items[0].label).toBe('Promise{}');
            expect(items[0].insertText).toBe('Promise{$0}');
        });
    }

    it('boundary: JSON.parse() infers any, which is in neither set — stays silent', () => {
        const source = 'let parsed = JSON.parse("{}"); // T:\n';
        expect(realSetup(source).labelsAt(afterColon(source))).toHaveLength(0);
    });

    it('boundary: new Date() infers Date, a built-in off the curated table — stays silent', () => {
        const source = 'let d = new Date(); // T:\n';
        expect(realSetup(source).labelsAt(afterColon(source))).toHaveLength(0);
    });
});

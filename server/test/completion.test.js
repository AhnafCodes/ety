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
    const labelsAt = character => {
        const items = onCompletion(state, deps, {
            textDocument: { uri: PATH },
            position: { line: 0, character },
        }) ?? [];
        return items.map(i => i.label);
    };
    return { labelsAt, source };
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

// onCodeAction — the auto-annotate quick fix ("Insert // T: <type>" on an
// un-annotated let/const/var declaration). Mirrors completion.test.js's
// `realSetup` pattern: the REAL pipeline (parse -> transform -> TS host), not
// a stub, because the whole point is genuine inference reused from
// inferEtyCompletion — a stub proves nothing about whether the quick fix
// actually lands on the right line with the right text.
import { describe, it, expect, vi } from 'vitest';
import { CodeActionKind } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createState, processDocument, onCodeAction } from '../src/handlers.js';
import { createTsService } from '../src/tsHost.js';
import { parse_ety } from '../src/parser.js';

const PATH = '/synthetic/doc.js';
const URI = `file://${PATH}`;

// Build real per-document state for `source`, then return a function that asks
// for code actions over [startLine, endLine] (original coordinates, inclusive).
function realSetup(source) {
    const state = createState();
    const doc = TextDocument.create(URI, 'javascript', 1, source);
    const deps = {
        connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn(), warn: vi.fn() } },
        parse_ety,
        documents: { get: () => doc },
    };
    deps.tsService = createTsService({ virtualDocs: state.virtualDocs, versions: state.versions });
    processDocument(state, deps, doc);
    const actionsFor = (startLine, endLine = startLine) => onCodeAction(state, deps, {
        textDocument: { uri: URI },
        range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 } },
    });
    return { state, actionsFor };
}

describe('onCodeAction — auto-annotate quick fix (REAL TS)', () => {
    it('offers "Insert // T: number" at the end of an un-annotated declaration', () => {
        const source = 'let i = 0;\n';
        const actions = realSetup(source).actionsFor(0);
        expect(actions).toHaveLength(1);
        const [action] = actions;
        expect(action.title).toBe('Insert // T: number');
        expect(action.kind).toBe(CodeActionKind.QuickFix);
        expect(action.edit.changes[URI]).toEqual([
            { range: { start: { line: 0, character: 10 }, end: { line: 0, character: 10 } }, newText: ' // T: number' },
        ]);
    });

    it('reads the primitive from genuine inference, not a hardcoded number', () => {
        expect(realSetup('let s = "x";\n').actionsFor(0)[0].title).toBe('Insert // T: string');
        expect(realSetup('let b = true;\n').actionsFor(0)[0].title).toBe('Insert // T: boolean');
    });

    it('offers a bare container skeleton, not the completion $0-snippet form', () => {
        const actions = realSetup('let m = new Map();\n').actionsFor(0);
        expect(actions).toHaveLength(1);
        expect(actions[0].title).toBe('Insert // T: Map{}');
        expect(actions[0].edit.changes[URI][0].newText).toBe(' // T: Map{}');
    });

    it('excludes non-primitive, non-curated inferred types — the sliver stays a sliver', () => {
        expect(realSetup('let d = new Date();\n').actionsFor(0)).toHaveLength(0);
        expect(realSetup('let o = { a: 1 };\n').actionsFor(0)).toHaveLength(0);
    });

    it('offers nothing on an already-annotated line', () => {
        expect(realSetup('let i = 0; // T: number\n').actionsFor(0)).toHaveLength(0);
    });

    it('offers nothing on a line with an unrelated trailing comment (would land inside it)', () => {
        expect(realSetup('let i = 0; // note\n').actionsFor(0)).toHaveLength(0);
    });

    it('offers nothing on a line suppressed by // T: ignore-start .. ignore-end', () => {
        const source = '// T: ignore-start\nlet k = 2;\n// T: ignore-end\n';
        expect(realSetup(source).actionsFor(1)).toHaveLength(0);
    });

    it('offers nothing on a multi-declarator line (ambiguous which declarator)', () => {
        expect(realSetup('let x = 1, y = 2;\n').actionsFor(0)).toHaveLength(0);
    });

    it('offers nothing for a for-loop variable (not a VariableStatement)', () => {
        expect(realSetup('for (let i = 0; i < 10; i++) {}\n').actionsFor(0)).toHaveLength(0);
    });

    it('offers nothing when state.autoAnnotate is false', () => {
        const source = 'let i = 0;\n';
        const { state, actionsFor } = realSetup(source);
        state.autoAnnotate = false;
        expect(actionsFor(0)).toHaveLength(0);
    });
});

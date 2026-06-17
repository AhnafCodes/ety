// Milestone 4 (LSP handlers → Gate 3b): pure handler functions over
// synthetic state. The TS service is a stub here — TS behavior itself is
// pinned by tshost.test.js; these tests pin the REMAPPING and lifecycle.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    uriToPath, createState, processDocument, pushDiagnostics, onHover, onDidClose,
} from '../src/handlers.js';
import { LineIndex } from '../src/transform.js';
import { parse_ety } from '../src/parser.js';
import { createTsService } from '../src/tsHost.js';

describe('uriToPath', () => {
    it('converts file:// URIs to filesystem paths (TS module resolution needs real paths)', () => {
        expect(uriToPath('file:///Users/me/proj/main.js')).toBe('/Users/me/proj/main.js');
    });

    it('decodes percent-encoding (spaces in workspace paths)', () => {
        expect(uriToPath('file:///Users/me/my%20proj/main.js')).toBe('/Users/me/my proj/main.js');
    });

    it('passes plain paths and unknown schemes through unchanged', () => {
        expect(uriToPath('/already/a/path.js')).toBe('/already/a/path.js');
    });

    it('maps untitled buffers to a sanitized .jsx name (TS rejects the raw colon URI)', () => {
        // A bare `untitled:Untitled-1` makes the language service throw
        // "Could not find source file"; .jsx classifies JS and JSX alike.
        expect(uriToPath('untitled:Untitled-1')).toBe('untitled_Untitled-1.jsx');
    });

    // ── JetBrains client (Milestone 7) ──────────────────────────────────────
    // JetBrains has no `untitled:` scheme. Its closest analog to a VS Code
    // unsaved buffer is a Scratch file — but that is a REAL file on disk (under
    // the IDE config dir), so it arrives as a normal file:// URI with a real
    // extension and flows through the file:// branch unchanged. No synthetic
    // name is needed; this row pins that cross-editor difference so nobody
    // "adds untitled handling" for JetBrains where none is required.
    it('maps a JetBrains scratch file:// URI to its real disk path (no synthesis needed)', () => {
        // Note the percent-encoded space in "Application Support" — fileURLToPath
        // decodes it, same as any workspace path with spaces.
        const uri = 'file:///Users/me/Library/Application%20Support/JetBrains/'
            + 'IntelliJIdea2025.3/scratches/scratch_1.js';
        expect(uriToPath(uri)).toBe(
            '/Users/me/Library/Application Support/JetBrains/IntelliJIdea2025.3/scratches/scratch_1.js'
        );
    });
});

// Hand-built synthetic state for one document:
//   original:  let x = 'oops'; // T: number          (line 0)
//   virtual:   /** @type {number} */                 (line 0, injected)
//              let x = 'oops'; // T: number          (line 1)
const VIRTUAL = "/** @type {number} */\nlet x = 'oops'; // T: number\n";
const COMMENT_RANGE = {
    start: { line: 0, character: 16 },
    end: { line: 0, character: 28 },
};
const PATH = '/synthetic/doc.js';
const URI = 'file:///synthetic/doc.js';

function syntheticState() {
    const state = createState();
    state.virtualDocs.set(PATH, VIRTUAL);
    state.versions.set(PATH, 7);
    state.lineMaps.set(PATH, {
        vToO: new Map([[0, 0], [1, 0]]),
        oToV: new Map([[0, 1]]),
        lineKind: new Map([
            [0, { kind: 'jsdoc', commentRange: COMMENT_RANGE }],
            [1, { kind: 'code' }],
        ]),
        lineIndex: new LineIndex(VIRTUAL),
        uri: URI,
    });
    return state;
}

const stubTs = diags => ({
    getSyntacticDiagnostics: () => [],
    getSemanticDiagnostics: () => diags,
    getQuickInfoAtPosition: () => undefined,
});

const mockDeps = diags => ({
    tsService: stubTs(diags),
    connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn(), warn: vi.fn() } },
});

describe('pushDiagnostics', () => {
    it('code-line error: line remapped to the original, character passed through', () => {
        // 'x' sits on virtual line 1, character 4 → absolute offset 22 + 4.
        const deps = mockDeps([{ start: 26, length: 1, messageText: 'nope', category: 1 }]);
        pushDiagnostics(syntheticState(), deps, PATH);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
        const { diagnostics } = deps.connection.sendDiagnostics.mock.calls[0][0];
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].range).toEqual({
            start: { line: 0, character: 4 },
            end: { line: 0, character: 5 },
        });
        expect(diagnostics[0].message).toBe('nope');
    });

    it('injected-line error: range equals the owning // T: commentRange', () => {
        // Offset 11 sits inside the injected JSDoc on virtual line 0 — its
        // virtual column is meaningless on the original line, so the squiggle
        // must land on the annotation text the user can actually edit.
        const deps = mockDeps([{ start: 11, length: 6, messageText: 'bad type', category: 1 }]);
        pushDiagnostics(syntheticState(), deps, PATH);
        const { diagnostics } = deps.connection.sendDiagnostics.mock.calls[0][0];
        expect(diagnostics[0].range).toBe(COMMENT_RANGE);
    });

    it('missing state is a no-op (debounce fired after close — race guard)', () => {
        const deps = mockDeps([]);
        pushDiagnostics(createState(), deps, PATH);
        expect(deps.connection.sendDiagnostics).not.toHaveBeenCalled();
    });

    it('publish payload carries the document version', () => {
        const deps = mockDeps([]);
        pushDiagnostics(syntheticState(), deps, PATH);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0]).toMatchObject({
            uri: URI,
            version: 7,
            diagnostics: [],
        });
    });

    it('undefined d.length yields a zero-width range with no NaN', () => {
        const deps = mockDeps([{ start: 26, length: undefined, messageText: 'm', category: 1 }]);
        pushDiagnostics(syntheticState(), deps, PATH);
        const { range } = deps.connection.sendDiagnostics.mock.calls[0][0].diagnostics[0];
        expect(range.start).toEqual({ line: 0, character: 4 });
        expect(range.end).toEqual({ line: 0, character: 4 });
    });

    it('span-less project-level diagnostics are not published but ARE logged to the output panel', () => {
        // No start offset = no file location to squiggle (broken lib, bad
        // compiler option). Dropping silently would make a misconfigured
        // environment undebuggable — console.warn is the escape hatch.
        const deps = mockDeps([{ start: undefined, length: 0, messageText: 'Cannot find global type', category: 1 }]);
        pushDiagnostics(syntheticState(), deps, PATH);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0].diagnostics).toEqual([]);
        expect(deps.connection.console.warn).toHaveBeenCalledTimes(1);
        expect(deps.connection.console.warn.mock.calls[0][0]).toContain('Cannot find global type');
        expect(deps.connection.console.warn.mock.calls[0][0]).toContain(URI);
    });

    it('severity comes from the TS category (Suggestion → Hint)', () => {
        const deps = mockDeps([{ start: 26, length: 1, messageText: 'm', category: 2 }]);
        pushDiagnostics(syntheticState(), deps, PATH);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0].diagnostics[0].severity).toBe(4);
    });
});

describe('onHover (mapping, stubbed quick info)', () => {
    it('translates the original position to a virtual offset and the returned span back to original lines', () => {
        const state = syntheticState();
        const deps = mockDeps([]);
        // Quick info for 'x': virtual offset 26, span of length 1.
        deps.tsService.getQuickInfoAtPosition = vi.fn(() => ({
            textSpan: { start: 26, length: 1 },
            displayParts: [{ text: 'let ' }, { text: 'x' }, { text: ': number' }],
        }));
        const hover = onHover(state, deps, {
            textDocument: { uri: URI },
            position: { line: 0, character: 4 },
        });
        // Original line 0 → virtual line 1 (below the JSDoc) → offset 22 + 4.
        expect(deps.tsService.getQuickInfoAtPosition).toHaveBeenCalledWith(PATH, 26);
        expect(hover).toEqual({
            contents: 'let x: number',
            range: {
                start: { line: 0, character: 4 },
                end: { line: 0, character: 5 },
            },
        });
    });

    it('returns null when TS has no quick info', () => {
        expect(onHover(syntheticState(), mockDeps([]), {
            textDocument: { uri: URI },
            position: { line: 0, character: 0 },
        })).toBeNull();
    });

    it('returns null on missing state (not yet processed, or closed — race guard)', () => {
        expect(onHover(createState(), mockDeps([]), {
            textDocument: { uri: URI },
            position: { line: 0, character: 4 },
        })).toBeNull();
    });
});

describe('onHover (REAL TS service — the architecture claims)', () => {
    // The verbatim-comment-line no-op depends on TS returning undefined inside
    // comment trivia; a stub would prove nothing, so this uses the real
    // pipeline end to end.
    const SOURCE = 'let count = 0; // T: number\n';
    const realSetup = () => {
        const state = createState();
        const deps = {
            connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn() } },
            parse_ety,
        };
        deps.tsService = createTsService({ virtualDocs: state.virtualDocs, versions: state.versions });
        processDocument(state, deps, { uri: PATH, version: 1, getText: () => SOURCE });
        return { state, deps };
    };

    it('hovering the token shows its annotated type, ranged on the original line', () => {
        const { state, deps } = realSetup();
        const hover = onHover(state, deps, {
            textDocument: { uri: PATH },
            position: { line: 0, character: 4 }, // on 'count'
        });
        expect(hover.contents).toContain('number');
        expect(hover.range).toEqual({
            start: { line: 0, character: 4 },
            end: { line: 0, character: 9 },
        });
    });

    it('hovering the // T: text itself is a graceful null — no special handling needed', () => {
        const { state, deps } = realSetup();
        expect(onHover(state, deps, {
            textDocument: { uri: PATH },
            position: { line: 0, character: 20 }, // inside '// T: number'
        })).toBeNull();
    });
});

describe('processDocument lifecycle (fake timers)', () => {
    afterEach(() => vi.useRealTimers());

    const lifecycleDeps = () => ({
        tsService: stubTs([]),
        connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn() } },
        parse_ety: () => [],
    });
    const doc = (version, text = 'let a = 1;\n') => ({ uri: URI, version, getText: () => text });

    it('three rapid changes within the debounce window publish exactly once', () => {
        vi.useFakeTimers();
        const state = createState();
        const deps = lifecycleDeps();
        processDocument(state, deps, doc(1));
        processDocument(state, deps, doc(2));
        processDocument(state, deps, doc(3));
        expect(deps.connection.sendDiagnostics).not.toHaveBeenCalled();
        vi.advanceTimersByTime(200);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
        // Hover state was nonetheless fresh after every call (synchronous).
        expect(state.versions.get(PATH)).toBe(3);
    });

    it('onDidClose cancels the pending timer, clears all four maps, and clears squigglies', () => {
        vi.useFakeTimers();
        const state = createState();
        const deps = lifecycleDeps();
        processDocument(state, deps, doc(1));
        onDidClose(state, deps, { uri: URI });
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledWith({ uri: URI, diagnostics: [] });
        for (const map of [state.virtualDocs, state.lineMaps, state.versions, state.diagTimers]) {
            expect(map.size).toBe(0);
        }
        vi.advanceTimersByTime(200);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1); // timer was cancelled
    });

    it('a throwing parse_ety keeps the LAST GOOD state, logs, and schedules no publish', () => {
        vi.useFakeTimers();
        const state = createState();
        const deps = lifecycleDeps();
        processDocument(state, deps, doc(1));
        vi.advanceTimersByTime(200); // flush the good doc's publish
        const goodEntry = state.lineMaps.get(PATH);
        const goodVirtual = state.virtualDocs.get(PATH);

        deps.parse_ety = () => { throw new Error('addon exploded'); };
        processDocument(state, deps, doc(2, 'let b = 2;\n'));
        // Stale-but-working beats dead: hover keeps answering from the last
        // good parse, so nothing may be wiped or replaced.
        expect(state.lineMaps.get(PATH)).toBe(goodEntry);
        expect(state.virtualDocs.get(PATH)).toBe(goodVirtual);
        expect(state.versions.get(PATH)).toBe(1);
        expect(deps.connection.console.error).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(200);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1); // no second publish
    });
});

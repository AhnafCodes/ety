// Milestone 4, the wiring proof: parse → transform → store → debounce → push
// as ONE motion, without an editor. Real Rust parser, real transformer, real
// TS service over the shared state maps; only the connection and the clock
// are fake. The unit tests prove the parts — this proves the composition.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileChangeType } from 'vscode-languageserver';
import { parse_ety } from '../src/parser.js';
import { createTsService } from '../src/tsHost.js';
import {
    createState, processDocument, onDidChangeWatchedFiles, DEBOUNCE_MS,
} from '../src/handlers.js';

const PATH = '/virtual/orchestrated.js';

const BROKEN = 'let count = 0; // T: number\ncount = "oops";\n';
const FIXED  = 'let count = 0; // T: number\ncount = 5;\n';

describe('onDidChangeContent orchestration', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('didOpen with a type error → one publish on the correct ORIGINAL line; the fixing didChange → empty publish', () => {
        const state = createState();
        const deps = {
            connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn() } },
            parse_ety,
        };
        deps.tsService = createTsService({ virtualDocs: state.virtualDocs, versions: state.versions });

        // didOpen (TextDocuments surfaces it as onDidChangeContent, version 1)
        processDocument(state, deps, { uri: PATH, version: 1, getText: () => BROKEN });
        expect(deps.connection.sendDiagnostics).not.toHaveBeenCalled(); // debounced
        vi.advanceTimersByTime(DEBOUNCE_MS);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);

        const publish = deps.connection.sendDiagnostics.mock.calls[0][0];
        expect(publish.uri).toBe(PATH);
        expect(publish.version).toBe(1);
        expect(publish.diagnostics).toHaveLength(1);
        // `count = "oops"` sits on ORIGINAL line 1 (virtual line 2, below the
        // injected JSDoc) — the squiggle must land on the original.
        expect(publish.diagnostics[0].range).toEqual({
            start: { line: 1, character: 0 },
            end: { line: 1, character: 5 },
        });
        expect(publish.diagnostics[0].severity).toBe(1);
        expect(publish.diagnostics[0].message).toMatch(/not assignable to type 'number'/);

        // didChange that fixes the error
        processDocument(state, deps, { uri: PATH, version: 2, getText: () => FIXED });
        vi.advanceTimersByTime(DEBOUNCE_MS);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(2);
        expect(deps.connection.sendDiagnostics.mock.calls[1][0]).toMatchObject({
            uri: PATH,
            version: 2,
            diagnostics: [],
        });
    });

    it('an `// T: ignore-start`/`// T: ignore-end` block suppresses a real TS error inside it, but not one outside', () => {
        // End-to-end proof for the block directive: two genuine type errors,
        // one bracketed by the block (must be dropped) and one after the block
        // (must survive). Real parser + transformer + TS service + the
        // ignoredLines suppression filter, all driven through processDocument.
        const source = [
            'let count = 0; // T: number', // 0
            '// T: ignore-start',          // 1
            'count = "suppressed";',       // 2 — type error INSIDE the block
            '// T: ignore-end',            // 3
            'count = "surfaced";',         // 4 — type error AFTER the block
        ].join('\n') + '\n';

        const state = createState();
        const deps = {
            connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn() } },
            parse_ety,
        };
        deps.tsService = createTsService({ virtualDocs: state.virtualDocs, versions: state.versions });

        processDocument(state, deps, { uri: PATH, version: 1, getText: () => source });
        vi.advanceTimersByTime(DEBOUNCE_MS);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);

        const { diagnostics } = deps.connection.sendDiagnostics.mock.calls[0][0];
        // Only the error on original line 4 survives; the one on line 2 is
        // dropped because lines 1–3 are suppressed by the block.
        expect(diagnostics).toHaveLength(1);
        expect(diagnostics[0].range).toEqual({
            start: { line: 4, character: 0 },
            end: { line: 4, character: 5 },
        });
        expect(diagnostics[0].message).toMatch(/not assignable to type 'number'/);
    });
});

describe('Milestone 15 / Gate 13: transform-on-read for closed, imported files (real disk, real pipeline)', () => {
    let root;
    beforeEach(() => {
        vi.useFakeTimers();
        root = mkdtempSync(join(tmpdir(), 'ety-shadow-'));
    });
    afterEach(() => {
        vi.useRealTimers();
        rmSync(root, { recursive: true, force: true });
    });

    const makeDeps = state => {
        const deps = {
            connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn(), warn: vi.fn() } },
            parse_ety,
        };
        deps.tsService = createTsService({
            virtualDocs: state.virtualDocs,
            versions: state.versions,
            diskVersions: state.diskVersions,
            shadowDocs: state.shadowDocs,
            hasInvalidatedResolutions: () => state.resolutionsStale,
        });
        return deps;
    };

    it("opening ONLY main.js resolves types.js's generic class without ever opening it", () => {
        const MAIN = join(root, 'main.js');
        const TYPES = join(root, 'types.js');
        writeFileSync(MAIN, "// T: import { Box } from './types.js'\nlet b = null; // T: Box{number} | null\n");
        writeFileSync(TYPES, 'export class Box {\n// T: {T}\n    value; // T: T\n}\n');

        const state = createState();
        const deps = makeDeps(state);
        processDocument(state, deps, { uri: MAIN, version: 1, getText: () => readFileSync(MAIN, 'utf8') });

        expect(state.shadowDocs.has(TYPES)).toBe(true);  // the import walk reached it
        expect(state.virtualDocs.has(TYPES)).toBe(false); // still never opened

        vi.advanceTimersByTime(DEBOUNCE_MS);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0].diagnostics).toEqual([]);
    });

    it('a genuine error inside the shadow-transformed closed file never gets its own sendDiagnostics call', () => {
        const MAIN = join(root, 'main.js');
        const TYPES = join(root, 'types.js');
        writeFileSync(MAIN, "// T: import { Box } from './types.js'\nlet b = null; // T: Box{number} | null\n");
        // types.js carries its OWN genuine, unrelated type error.
        writeFileSync(TYPES, 'export class Box {\n// T: {T}\n    value; // T: T\n}\nlet bad = 1; // T: string\n');

        const state = createState();
        const deps = makeDeps(state);
        processDocument(state, deps, { uri: MAIN, version: 1, getText: () => readFileSync(MAIN, 'utf8') });
        vi.advanceTimersByTime(DEBOUNCE_MS);

        // Exactly one publish — for MAIN, and clean — even though TYPES has a
        // real error of its own: a shadow doc informs how MAIN type-checks; it
        // never gets diagnostics pushed for its own (never-opened) URI.
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0].uri).toBe(MAIN);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0].diagnostics).toEqual([]);
    });

    it('a watched change to an already-considered closed file is picked up within the SAME cycle, no re-edit of main.js needed', () => {
        const MAIN = join(root, 'main.js');
        const TYPES = join(root, 'types.js');
        writeFileSync(MAIN, "// T: import { Box } from './types.js'\nlet b = null; // T: Box{number} | null\n");
        // No // T: annotations at all yet — zero annotations means no shadow
        // is created (scope test, reused here): raw disk fallback applies,
        // reproducing the pre-Milestone-15 "not generic" failure on purpose.
        writeFileSync(TYPES, 'export class Box {\n    value;\n}\n');

        const state = createState();
        const deps = makeDeps(state);
        processDocument(state, deps, { uri: MAIN, version: 1, getText: () => readFileSync(MAIN, 'utf8') });
        expect(state.shadowDocs.has(TYPES)).toBe(false);
        vi.advanceTimersByTime(DEBOUNCE_MS);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0].diagnostics.length).toBeGreaterThan(0);

        // types.js gains a // T: {T} generic annotation on disk, STILL closed;
        // only a watcher event fires — main.js itself is never touched again.
        writeFileSync(TYPES, 'export class Box {\n// T: {T}\n    value; // T: T\n}\n');
        onDidChangeWatchedFiles(state, deps, { changes: [{ uri: TYPES, type: FileChangeType.Changed }] });
        expect(state.shadowDocs.has(TYPES)).toBe(true); // re-walked synchronously, same handler call

        vi.advanceTimersByTime(DEBOUNCE_MS);
        const last = deps.connection.sendDiagnostics.mock.calls.at(-1)[0];
        expect(last.diagnostics).toEqual([]);
    });

    it('an open buffer for the closed file always wins over its own shadow copy', () => {
        const MAIN = join(root, 'main.js');
        const TYPES = join(root, 'types.js');
        writeFileSync(MAIN, "// T: import { Box } from './types.js'\nlet b = null; // T: Box{number} | null\n");
        writeFileSync(TYPES, 'export class Box {\n// T: {T}\n    value; // T: T\n}\n');

        const state = createState();
        const deps = makeDeps(state);
        processDocument(state, deps, { uri: MAIN, version: 1, getText: () => readFileSync(MAIN, 'utf8') });
        expect(state.shadowDocs.has(TYPES)).toBe(true);

        // The user now opens types.js directly with a live, UNSAVED edit that
        // introduces its own deliberate error — the live buffer must win over
        // the shadow's disk-backed copy.
        const liveTypes = 'export class Box {\n// T: {T}\n    value; // T: T\n}\nlet mismatch = 1; // T: string\n';
        processDocument(state, deps, { uri: TYPES, version: 1, getText: () => liveTypes });
        vi.advanceTimersByTime(DEBOUNCE_MS);

        const typesPublish = deps.connection.sendDiagnostics.mock.calls.find(c => c[0].uri === TYPES)[0];
        expect(typesPublish.diagnostics.length).toBeGreaterThan(0); // the LIVE buffer's own error surfaces
    });
});

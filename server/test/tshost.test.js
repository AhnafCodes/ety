// Milestone 3 (TS engine → Gate 3a). These tests mostly CHARACTERIZE the
// pinned TypeScript version's behavior over hand-built virtual documents —
// if one breaks on a TS bump, the pinned assumption changed, not our code.
// The de-risk method fixture runs first (implementation-plan.md, M3 test #1).
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse_ety } from '../src/parser.js';
import { transformDocument } from '../src/transform.js';
import { createTsService, tsCategoryToSeverity, resolveModuleName } from '../src/tsHost.js';
import { collectShadowDocs } from '../src/shadowDocs.js';

const FILE = '/virtual/fixture.js';
const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/engine');

function serviceFor(virtualSource, file = FILE) {
    const virtualDocs = new Map([[file, virtualSource]]);
    const versions = new Map([[file, 1]]);
    return { service: createTsService({ virtualDocs, versions }), virtualDocs, versions };
}

// Hand-built EXACTLY as transformDocument emits it for the spec's Box class —
// hand-built so a failure here indicts TypeScript's method support alone,
// not the transformer (whose output shape Gate 2 already pins).
const methodVirtualDoc = body => [
    '/** @template T */',
    'class Box {',
    '// T: {T}',
    '/** @type {T} */',
    '    value; // T: T',
    '/** @type {(item: T) => T} */',
    '    set(item) {',
    '// T: (item: T) => T',
    `        ${body}`,
    '    }',
    '}',
    '',
].join('\n');

describe('THE method fixture (de-risk item #1): injected @type on class methods', () => {
    it('a correct method body yields zero diagnostics (@template T resolves in method position)', () => {
        const { service } = serviceFor(methodVirtualDoc('this.value = item; return item;'));
        expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
    });

    it('RESOLVED GREEN (TS 6.0.3): @type on a class method applies — deliberate error in the body is caught', () => {
        // Gate 3a decision, recorded in writing: TypeScript honors an injected
        // /** @type {(item: T) => T} */ above a class method, so NO
        // @param/@returns contingency branch is needed. If TS ignored @type
        // on methods, `return 42` from an untyped JS method would be legal
        // and this list would be empty.
        const source = methodVirtualDoc('return 42;');
        const { service } = serviceFor(source);
        const diags = service.getSemanticDiagnostics(FILE);
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe(2322); // Type 'number' is not assignable to type 'T'.
        // TS anchors a return-type mismatch on the `return` keyword itself
        // (not the returned expression) — and inside the body, not the JSDoc.
        expect(source.slice(diags[0].start, diags[0].start + diags[0].length)).toBe('return');
    });
});

describe('default lib loads through the host', () => {
    it('lib types resolve (getScriptSnapshot must fall back to disk for non-virtual files)', () => {
        // The language service reads EVERY program file — lib.es2022.d.ts
        // included — via getScriptSnapshot, never via the host's readFile
        // (that one only serves module resolution). A host that answers
        // undefined for non-virtual files silently drops the standard lib and
        // Array/Number members stop existing.
        const { service } = serviceFor('const n = [1, 2].length;\nn.toFixed(2);\n');
        expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
    });
});

describe('function declaration fixture: @type with type params applies positionally', () => {
    const FUNC_CLEAN = [
        '/** @type {<T>(items: T[], fallback: T) => T} */',
        'function first(items, fallback) {',
        '    return items.length ? items[0] : fallback;',
        '}',
        'const n = first([1, 2], 3);',
        'n.toFixed(2);',
        '',
    ].join('\n');

    it('correct generic call-site yields zero diagnostics', () => {
        const { service } = serviceFor(FUNC_CLEAN);
        expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
    });

    it('type params bind to declared params POSITIONALLY: misuse at the call-site is caught', () => {
        const source = FUNC_CLEAN.replace('first([1, 2], 3)', "first([1, 2], 'x')");
        const { service } = serviceFor(source);
        const diags = service.getSemanticDiagnostics(FILE);
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe(2345); // Argument of type 'string' is not assignable…
        // T was inferred as number from the FIRST argument, proving the
        // signature's params mapped onto (items, fallback) in order.
        expect(source.slice(diags[0].start, diags[0].start + diags[0].length)).toBe("'x'");
    });
});

describe('version trap: getScriptVersion is the ONLY cache invalidation', () => {
    const BAD  = '/** @type {number} */\nlet x = "oops";\n';
    const GOOD = '/** @type {number} */\nlet x = 1;\n';

    it('mutating the virtual doc without bumping the version returns STALE diagnostics', () => {
        // This documents the trap (implementation-plan.md M3 test #3): the
        // assertion is that the stale result IS returned, so anyone wiring
        // processDocument without the version bump breaks this test's twin
        // below, and anyone "fixing" TS's caching breaks this one.
        const { service, virtualDocs } = serviceFor(BAD);
        expect(service.getSemanticDiagnostics(FILE)).toHaveLength(1);
        virtualDocs.set(FILE, GOOD);
        expect(service.getSemanticDiagnostics(FILE)).toHaveLength(1); // stale!
    });

    it('bumping the version invalidates the cache and returns fresh diagnostics', () => {
        const { service, virtualDocs, versions } = serviceFor(BAD);
        expect(service.getSemanticDiagnostics(FILE)).toHaveLength(1);
        virtualDocs.set(FILE, GOOD);
        versions.set(FILE, 2);
        expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
    });
});

describe('syntactic + semantic merge', () => {
    const SYNTAX_ERROR = 'let x = ;\n';

    it('a syntax error surfaces via getSyntacticDiagnostics', () => {
        const { service } = serviceFor(SYNTAX_ERROR);
        const diags = service.getSyntacticDiagnostics(FILE);
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe(1109); // Expression expected.
    });

    it('getSemanticDiagnostics alone silently drops the parse error (why pushDiagnostics merges both)', () => {
        const { service } = serviceFor(SYNTAX_ERROR);
        expect(service.getSemanticDiagnostics(FILE)).toEqual([]);
    });
});

describe('severity mapping', () => {
    it('maps each TS DiagnosticCategory to the corresponding LSP severity', () => {
        // DiagnosticSeverity: Error=1, Warning=2, Information=3, Hint=4
        expect(tsCategoryToSeverity(ts.DiagnosticCategory.Error)).toBe(1);
        expect(tsCategoryToSeverity(ts.DiagnosticCategory.Warning)).toBe(2);
        expect(tsCategoryToSeverity(ts.DiagnosticCategory.Message)).toBe(3);
        expect(tsCategoryToSeverity(ts.DiagnosticCategory.Suggestion)).toBe(4);
        expect(tsCategoryToSeverity(undefined)).toBe(1); // unknown → Error
    });

    it('a REAL suggestion-category diagnostic from TS maps to Hint', () => {
        // require() in an ESM-target project draws TS 80001 ("File is a
        // CommonJS module…"), the only readily available Suggestion-category
        // diagnostic — used here so the mapping is exercised against a
        // genuine TS-produced category, not a hand-rolled enum value.
        const { service } = serviceFor('const fs = require("fs");\nfs.readFileSync("x");\n');
        const suggestions = service.getSuggestionDiagnostics(FILE);
        expect(suggestions.length).toBeGreaterThan(0);
        expect(suggestions[0].code).toBe(80001);
        expect(suggestions[0].category).toBe(ts.DiagnosticCategory.Suggestion);
        expect(tsCategoryToSeverity(suggestions[0].category)).toBe(4); // Hint
    });
});

describe('cross-file types (disk-backed fixtures, REAL parse → transform pipeline)', () => {
    const MAIN  = join(ENGINE_DIR, 'main.js');
    const TYPES = join(ENGINE_DIR, 'types.js');
    const virt = p => {
        const source = readFileSync(p, 'utf8');
        return transformDocument(source, parse_ety(source)).virtualSource;
    };
    const allDiags = (service, file) => [
        ...service.getSyntacticDiagnostics(file),
        ...service.getSemanticDiagnostics(file),
    ];

    it('both docs open: // T: import between them resolves, generic Box{number} type-checks clean', () => {
        const virtualDocs = new Map([[MAIN, virt(MAIN)], [TYPES, virt(TYPES)]]);
        const versions = new Map([[MAIN, 1], [TYPES, 1]]);
        const service = createTsService({ virtualDocs, versions });
        expect(allDiags(service, MAIN)).toEqual([]);
        expect(allDiags(service, TYPES)).toEqual([]);
    });

    it('unaided raw fallback: importing doc alone, no shadow doc supplied — closed types.js is served raw, its generics vanish', () => {
        // createTsService in isolation does not conjure a shadow doc on its
        // own — something (handlers.js's processDocument, in production) has
        // to populate `shadowDocs` first. With NEITHER virtualDocs NOR
        // shadowDocs holding an entry for types.js, getScriptSnapshot falls
        // all the way to raw disk bytes: an untransformed `class Box` with no
        // @template, so Box<number> draws TS2315. The error lands on the
        // INJECTED JSDoc line (Milestone 4 remaps such diagnostics onto the
        // // T: comment). This is the primitive createTsService still needs
        // to fall back on; it is NOT the v1 limitation anymore — see the next
        // test for what Milestone 15 actually changes.
        const mainVirtual = virt(MAIN);
        const virtualDocs = new Map([[MAIN, mainVirtual]]);
        const versions = new Map([[MAIN, 1]]);
        const service = createTsService({ virtualDocs, versions });
        const diags = allDiags(service, MAIN);
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe(2315); // Type 'Box' is not generic.
        expect(mainVirtual.slice(diags[0].start, diags[0].start + diags[0].length)).toBe('Box<number>');
    });

    it('Milestone 15 / Gate 13: with a shadow doc populated for types.js, the SAME closed-import scenario now type-checks clean', () => {
        // This is the flip of the v1 limitation above, at the exact same
        // fixture and assertion shape: types.js is STILL never added to
        // virtualDocs (still closed, never opened) — but collectShadowDocs
        // (the mechanism processDocument runs on every open document, in
        // production) has walked main.js's own // T: import and transformed
        // types.js on read. Box<number> now resolves its @template and
        // type-checks with ZERO diagnostics, matching the "both open" case.
        const mainSource = readFileSync(MAIN, 'utf8');
        const mainAnnotations = parse_ety(mainSource);
        const shadowDocs = collectShadowDocs({
            containingFile: MAIN,
            importAnnotations: mainAnnotations.filter(a => a.kind === 'import'),
            isKnown: () => false,
            readFile: p => readFileSync(p, 'utf8'),
            parseEty: parse_ety,
            transformDocument,
            resolveModuleName,
        });
        expect(shadowDocs.has(TYPES)).toBe(true); // sanity: the walk actually reached it

        const virtualDocs = new Map([[MAIN, transformDocument(mainSource, mainAnnotations).virtualSource]]);
        const versions = new Map([[MAIN, 1]]);
        const service = createTsService({ virtualDocs, versions, shadowDocs });
        expect(allDiags(service, MAIN)).toEqual([]);
    });
});

describe('Milestone 15 / Gate 13, de-risk #1: standalone resolveModuleName matches the live LanguageService', () => {
    it('resolves ./types.js from main.js to the same absolute path the live service resolves with both open', () => {
        // A mismatch here would mean the shadow-doc walk (Milestone 15) could
        // decide to transform a DIFFERENT file than the one TypeScript itself
        // ends up reading for the same // T: import — silently wrong types.
        const MAIN = join(ENGINE_DIR, 'main.js');
        const TYPES = join(ENGINE_DIR, 'types.js');
        expect(resolveModuleName('./types.js', MAIN)).toBe(TYPES);
    });

    it('returns null for a specifier TypeScript itself cannot resolve', () => {
        const MAIN = join(ENGINE_DIR, 'main.js');
        expect(resolveModuleName('./does-not-exist.js', MAIN)).toBeNull();
    });
});

describe('workspaceRoot: getCurrentDirectory must follow the workspace, not the server process cwd', () => {
    // In the editor, process.cwd() is wherever the extension host spawned the
    // server — not the user's project root. TS walks UP from
    // getCurrentDirectory to find node_modules/@types, so global type
    // packages only resolve if the host reports the workspace root.
    it('a global @types package in the workspace resolves with workspaceRoot, draws TS2304 without it', () => {
        const root = mkdtempSync(join(tmpdir(), 'ety-ws-'));
        try {
            mkdirSync(join(root, 'node_modules/@types/ety-globals'), { recursive: true });
            writeFileSync(
                join(root, 'node_modules/@types/ety-globals/index.d.ts'),
                'declare const ETY_TEST_GLOBAL: number;\n',
            );
            const src = 'ETY_TEST_GLOBAL.toFixed(2);\n';
            const mk = workspaceRoot => createTsService({
                virtualDocs: new Map([[FILE, src]]),
                versions: new Map([[FILE, 1]]),
                workspaceRoot,
            });
            expect(mk(root).getSemanticDiagnostics(FILE)).toEqual([]);
            // Default (process.cwd() = the server dir, no such package):
            expect(mk(undefined).getSemanticDiagnostics(FILE).map(d => d.code)).toContain(2304);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// Milestone 14: closed-file invalidation. A dependency read through the disk
// fallback (never opened, so never in virtualDocs) is cached at version
// "<lsp>.<epoch>". These characterize the two levers onDidChangeWatchedFiles
// pulls: the per-file disk epoch for content changes, and
// hasInvalidatedResolutions for create/delete flipping a resolution RESULT.
describe('closed-file invalidation (disk epoch + resolution staleness)', () => {
    const MAIN = [
        "import { VALUE } from './dep.js';",
        '/** @type {number} */',
        'let x = VALUE;',
        '',
    ].join('\n');
    const dirs = [];
    afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

    function diskFixture({ withDep = true, hasInvalidatedResolutions } = {}) {
        const dir = mkdtempSync(join(tmpdir(), 'ety-disk-'));
        dirs.push(dir);
        const depPath = join(dir, 'dep.js');
        if (withDep) writeFileSync(depPath, 'export const VALUE = 1;\n');
        const mainPath = join(dir, 'main.js');
        const diskVersions = new Map();
        const service = createTsService({
            virtualDocs: new Map([[mainPath, MAIN]]),
            versions: new Map([[mainPath, 1]]),
            diskVersions,
            hasInvalidatedResolutions,
            workspaceRoot: dir,
        });
        return { mainPath, depPath, service, diskVersions };
    }

    it('a rewritten closed dependency is STALE until its disk epoch bumps (the trap this milestone fixes)', () => {
        const { mainPath, depPath, service, diskVersions } = diskFixture();
        expect(service.getSemanticDiagnostics(mainPath)).toEqual([]);
        writeFileSync(depPath, "export const VALUE = 'oops';\n");
        // No epoch bump: program is up to date, disk never re-read.
        expect(service.getSemanticDiagnostics(mainPath)).toEqual([]);
        diskVersions.set(depPath, 1);
        expect(service.getSemanticDiagnostics(mainPath).map(d => d.code)).toContain(2322);
    });

    it('a CREATED file needs hasInvalidatedResolutions — no version bump can revive a failed import', () => {
        let stale = false;
        const { mainPath, depPath, service } = diskFixture({
            withDep: false,
            hasInvalidatedResolutions: () => stale,
        });
        // 2307 Cannot find module './dep.js'
        expect(service.getSemanticDiagnostics(mainPath).map(d => d.code)).toContain(2307);
        writeFileSync(depPath, 'export const VALUE = 1;\n');
        // The failed resolution is cached with the program; creation alone
        // changes no version, so the error persists…
        expect(service.getSemanticDiagnostics(mainPath).map(d => d.code)).toContain(2307);
        // …until the resolution invalidation is armed.
        stale = true;
        expect(service.getSemanticDiagnostics(mainPath)).toEqual([]);
    });
});

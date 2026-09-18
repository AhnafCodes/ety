// Milestone 15 / Gate 13 — transform-on-read for closed, imported files.
// Pure algorithmic tests against injected fakes (fast, no filesystem, no real
// parser/transformer) plus a real-dependency wiring check at the bottom.
import { describe, it, expect } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { collectShadowDocs, parseImportSpecifier } from '../src/shadowDocs.js';
import { parse_ety } from '../src/parser.js';
import { transformDocument } from '../src/transform.js';
import { resolveModuleName } from '../src/tsHost.js';

const ENGINE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/engine');

describe('parseImportSpecifier', () => {
    it('extracts a single-quoted specifier', () => {
        expect(parseImportSpecifier("import { User, Role } from './types'")).toBe('./types');
    });
    it('extracts a double-quoted specifier', () => {
        expect(parseImportSpecifier('import { User } from "./types"')).toBe('./types');
    });
    it('returns null when there is no from clause', () => {
        expect(parseImportSpecifier('import { User }')).toBeNull();
    });
});

// Fakes: `files` maps a path to the annotations that path's "source" carries;
// `readFile` returns an opaque token encoding the path, `parseEty` decodes it
// back — the token never needs to look like real JS, since these tests
// exercise the WALK, not the real parser (that's the wiring test at the end).
function makeFakes({ files, resolutions, known = new Set() }) {
    const readFile = path => (files.has(path) ? `SOURCE(${path})` : undefined);
    const parseEty = source => files.get(/^SOURCE\((.+)\)$/.exec(source)[1]);
    const transformDocument = source => ({ virtualSource: `TRANSFORMED(${source})` });
    const resolveModuleName = (specifier, containingFile) =>
        resolutions.get(`${specifier}::${containingFile}`) ?? null;
    const isKnown = path => known.has(path);
    return { readFile, parseEty, transformDocument, resolveModuleName, isKnown };
}

describe('collectShadowDocs: algorithmic behavior (injected fakes)', () => {
    const A = '/A.js', B = '/B.js', C = '/C.js', D = '/D.js';
    const importFrom = spec => ({ kind: 'import', ety: `import { X } from '${spec}'` });

    it('shadows a closed, resolved target that carries annotations', () => {
        const files = new Map([[B, [{ kind: 'typedef', ety: '{ id: string }', name: 'User' }]]]);
        const resolutions = new Map([[`./b::${A}`, B]]);
        const fakes = makeFakes({ files, resolutions });
        const result = collectShadowDocs({ containingFile: A, importAnnotations: [importFrom('./b')], ...fakes });
        expect(result.size).toBe(1);
        expect(result.get(B)).toBe(`TRANSFORMED(SOURCE(${B}))`);
    });

    it('does not shadow a resolved target with zero annotations (raw fallback already correct)', () => {
        const files = new Map([[B, []]]);
        const resolutions = new Map([[`./b::${A}`, B]]);
        const fakes = makeFakes({ files, resolutions });
        const result = collectShadowDocs({ containingFile: A, importAnnotations: [importFrom('./b')], ...fakes });
        expect(result.size).toBe(0);
    });

    it('skips a specifier TypeScript itself cannot resolve', () => {
        const fakes = makeFakes({ files: new Map(), resolutions: new Map() });
        const result = collectShadowDocs({ containingFile: A, importAnnotations: [importFrom('./missing')], ...fakes });
        expect(result.size).toBe(0);
    });

    it('skips a target that is already known (open, or already a fresh shadow) — never even reads it', () => {
        const files = new Map([[B, [{ kind: 'typedef', ety: '{}' }]]]);
        const resolutions = new Map([[`./b::${A}`, B]]);
        let readCalled = false;
        const fakes = makeFakes({ files, resolutions, known: new Set([B]) });
        const result = collectShadowDocs({
            containingFile: A,
            importAnnotations: [importFrom('./b')],
            ...fakes,
            readFile: p => { readCalled = true; return fakes.readFile(p); },
        });
        expect(result.size).toBe(0);
        expect(readCalled).toBe(false);
    });

    it('recurses into a shadowed file\'s own // T: import annotations (multi-hop)', () => {
        const files = new Map([
            [B, [importFrom('./c')]],
            [C, [{ kind: 'typedef', ety: '{ id: string }', name: 'Deep' }]],
        ]);
        const resolutions = new Map([[`./b::${A}`, B], [`./c::${B}`, C]]);
        const fakes = makeFakes({ files, resolutions });
        const result = collectShadowDocs({ containingFile: A, importAnnotations: [importFrom('./b')], ...fakes });
        expect([...result.keys()].sort()).toEqual([B, C].sort());
    });

    it('terminates on a circular import instead of recursing forever', () => {
        const files = new Map([[B, [importFrom('./a')]]]);
        const resolutions = new Map([[`./b::${A}`, B], [`./a::${B}`, A]]);
        const fakes = makeFakes({ files, resolutions });
        const result = collectShadowDocs({ containingFile: A, importAnnotations: [importFrom('./b')], ...fakes });
        expect([...result.keys()]).toEqual([B]); // A itself never re-entered
    });

    it('dedupes a diamond dependency: two importers sharing one closed target shadow it once', () => {
        const files = new Map([
            [B, [importFrom('./d')]],
            [C, [importFrom('./d')]],
            [D, [{ kind: 'typedef', ety: '{}', name: 'Shared' }]],
        ]);
        const resolutions = new Map([
            [`./b::${A}`, B], [`./c::${A}`, C],
            [`./d::${B}`, D], [`./d::${C}`, D],
        ]);
        const fakes = makeFakes({ files, resolutions });
        const result = collectShadowDocs({
            containingFile: A,
            importAnnotations: [importFrom('./b'), importFrom('./c')],
            ...fakes,
        });
        expect([...result.keys()].sort()).toEqual([B, C, D].sort());
    });

    it('is a no-op once the caller already considers the target known (idempotency / no re-thrash)', () => {
        const files = new Map([[B, [{ kind: 'typedef', ety: '{}' }]]]);
        const resolutions = new Map([[`./b::${A}`, B]]);
        const fakes = makeFakes({ files, resolutions, known: new Set([B]) });
        const result = collectShadowDocs({ containingFile: A, importAnnotations: [importFrom('./b')], ...fakes });
        expect(result.size).toBe(0);
    });
});

describe('collectShadowDocs: real parser/transformer/resolver wiring (fixtures/engine)', () => {
    it('shadows fixtures/engine/types.js from main.js\'s own // T: import, byte-identical to opening it directly', () => {
        const MAIN = join(ENGINE_DIR, 'main.js');
        const TYPES = join(ENGINE_DIR, 'types.js');
        const mainSource = readFileSync(MAIN, 'utf8');
        const mainAnnotations = parse_ety(mainSource);
        const importAnnotations = mainAnnotations.filter(a => a.kind === 'import');
        expect(importAnnotations).toHaveLength(1);

        const result = collectShadowDocs({
            containingFile: MAIN,
            importAnnotations,
            isKnown: () => false,
            readFile: p => readFileSync(p, 'utf8'),
            parseEty: parse_ety,
            transformDocument,
            resolveModuleName,
        });

        expect(result.size).toBe(1);
        const typesSource = readFileSync(TYPES, 'utf8');
        const expected = transformDocument(typesSource, parse_ety(typesSource)).virtualSource;
        expect(result.get(TYPES)).toBe(expected);
    });
});

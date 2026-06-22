// Callback declarations (`// T: callback Name = (params) => Return`). The
// function-type cousin of typedef: same node-less partition, but the body
// decomposes into a @callback block — @template(s) FIRST (TS 6.0.3 rejects
// @template after @callback: error 8039, confirmed by de-risk probe), then
// @callback, @param per parameter, @returns. A synthetic `export const Name`
// is hoisted to module scope (the binding is REQUIRED for cross-file import,
// same as typedef). Handler/TS host: unchanged.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { parse_ety } from '../src/parser.js';
import { transformDocument } from '../src/transform.js';
import { createTsService } from '../src/tsHost.js';

const transform = src => transformDocument(src, parse_ety(src));
const block = (virtualSource, name) => {
    // the hoisted block: from its '/**' up to its 'export const <name> = {};'
    const v = virtualSource.split('\n');
    const end = v.findIndex(l => l === `export const ${name} = {};`);
    let start = end;
    while (start > 0 && v[start] !== '/**') start--;
    return v.slice(start, end + 1);
};

describe('parser: callback emission (node-less, raw function-type body)', () => {
    it('emits one callback annotation bound to no node, body kept verbatim', () => {
        const [a] = parse_ety('// T: callback OnSuccess = (data: any) => void\n');
        expect(a).toMatchObject({ kind: 'callback', name: 'OnSuccess', ety: '(data: any) => void', doc: '', nodeStartOffset: 0 });
    });
    it('splits name = body on the first real = (the body keeps its => arrow)', () => {
        const [a] = parse_ety('// T: callback Mapper = {T, U}(item: T, index: number) => U\n');
        expect(a).toMatchObject({ name: 'Mapper', ety: '{T, U}(item: T, index: number) => U' });
    });
    it('keeps a per-param - inside the body verbatim, with an empty doc', () => {
        // ` - ` is a per-param description, not the callback's whole-declaration
        // descriptor (that is a `// T: #` line), so the body survives verbatim.
        const [a] = parse_ety('// T: callback OnChange = (value: string - the value) => void\n');
        expect(a).toMatchObject({ name: 'OnChange', ety: '(value: string - the value) => void', doc: '' });
    });
    it('reserved word needs a trailing space — bare `callback` is a normal payload', () => {
        const [a] = parse_ety('let x = 1; // T: callback\n');
        expect(a).toMatchObject({ kind: 'variable', ety: 'callback' });
    });
});

describe('transform: @callback block decomposition + hoisted export const', () => {
    it('named params → @callback/@param/@returns, hoisted with an export const', () => {
        const { virtualSource } = transform('// T: callback OnSuccess = (data: any) => void\n');
        expect(block(virtualSource, 'OnSuccess')).toEqual([
            '/**',
            ' * @callback OnSuccess',
            ' * @param {any} data',
            ' * @returns {void}',
            ' */',
            'export const OnSuccess = {};',
        ]);
    });

    it('generic: @template tags come BEFORE @callback (TS 8039 guard)', () => {
        const { virtualSource } = transform('// T: callback Mapper = {T, U}(item: T, index: number) => U\n');
        expect(block(virtualSource, 'Mapper')).toEqual([
            '/**',
            ' * @template T',
            ' * @template U',
            ' * @callback Mapper',
            ' * @param {T} item',
            ' * @param {number} index',
            ' * @returns {U}',
            ' */',
            'export const Mapper = {};',
        ]);
    });

    it('positional (unnamed) params get synthetic pN names', () => {
        const { virtualSource } = transform('// T: callback Cmp = (string, number) => boolean\n');
        expect(block(virtualSource, 'Cmp')).toEqual([
            '/**',
            ' * @callback Cmp',
            ' * @param {string} p0',
            ' * @param {number} p1',
            ' * @returns {boolean}',
            ' */',
            'export const Cmp = {};',
        ]);
    });

    it('optional params render as [name]', () => {
        const { virtualSource } = transform('// T: callback C = (name?: string, n: number) => void\n');
        const b = block(virtualSource, 'C');
        expect(b).toContain(' * @param {string} [name]');
        expect(b).toContain(' * @param {number} n');
    });

    it('void-return shorthand: a bare param list implies => void', () => {
        const { virtualSource } = transform('// T: callback C = (data: string)\n');
        expect(block(virtualSource, 'C')).toEqual([
            '/**',
            ' * @callback C',
            ' * @param {string} data',
            ' * @returns {void}',
            ' */',
            'export const C = {};',
        ]);
    });

    it('renders a following // T: # line above @template/@callback', () => {
        const { virtualSource } = transform('// T: callback OnChange = (value: string) => void\n// T: # Called on change\n');
        const b = block(virtualSource, 'OnChange');
        expect(b[0]).toBe('/**');
        expect(b[1]).toBe(' * Called on change');
        expect(b[2]).toBe(' * @callback OnChange');
    });

    it('keeps # descriptor before @template (TS 8039 order preserved)', () => {
        const { virtualSource } = transform('// T: callback Mapper = {T}(item: T) => T\n// T: # Maps a value\n');
        const b = block(virtualSource, 'Mapper');
        expect(b[1]).toBe(' * Maps a value');
        expect(b[2]).toBe(' * @template T');
        expect(b[3]).toBe(' * @callback Mapper');
    });

    it('converts {} generics inside param/return types (Box{T})', () => {
        const { virtualSource } = transform('// T: callback Make = {T}(seed: T) => Box{T}\n');
        const b = block(virtualSource, 'Make');
        expect(b).toContain(' * @param {T} seed');
        expect(b).toContain(' * @returns {Box<T>}');
    });

    it('a callback inside a function body still hoists its export to module scope', () => {
        const src = 'function f() {\n// T: callback Local = (x: number) => void\n    return 1;\n}\n';
        const v = transform(src).virtualSource.split('\n');
        const exp = v.findIndex(l => l === 'export const Local = {};');
        const fn = v.findIndex(l => l.startsWith('function f'));
        expect(exp).toBeGreaterThanOrEqual(0);
        expect(exp).toBeLessThan(fn);
    });
});

describe('end-to-end: a callback type checks function shape (real TS pipeline)', () => {
    const FILE = '/virtual/cb.js';
    const run = src => {
        const { virtualSource } = transform(src);
        const service = createTsService({ virtualDocs: new Map([[FILE, virtualSource]]), versions: new Map([[FILE, 1]]) });
        return [...service.getSyntacticDiagnostics(FILE), ...service.getSemanticDiagnostics(FILE)];
    };

    it('a conforming function yields zero diagnostics', () => {
        const src = [
            '// T: callback Comparator = (a: number, b: number) => number',
            'const cmp = (a, b) => a - b; // T: Comparator',
            '',
        ].join('\n');
        expect(run(src)).toEqual([]);
    });

    it('a wrong return type is caught (generic callback resolves its @template)', () => {
        const src = [
            '// T: callback Mapper = {T, U}(item: T, index: number) => U',
            'const bad = (item, index) => item; // T: Mapper{string, number}',
            '',
        ].join('\n');
        const diags = run(src);
        expect(diags.map(d => d.code)).toContain(2322); // string not assignable to number (U)
    });
});

describe('cross-file: the export const makes a callback importable', () => {
    it('a callback declared in one open doc resolves through // T: import in another', () => {
        const root = mkdtempSync(join(tmpdir(), 'ety-cb-'));
        try {
            const A = join(root, 'types.js'), B = join(root, 'use.js');
            const aSrc = '// T: callback OnChange = (value: string) => void\n';
            const bSrc = [
                "// T: import { OnChange } from './types'",
                'const h = (v) => v.toFixed(2); // T: OnChange', // v:string -> .toFixed errors IF resolved
                '',
            ].join('\n');
            writeFileSync(A, aSrc); writeFileSync(B, bSrc);
            const service = createTsService({
                virtualDocs: new Map([[A, transform(aSrc).virtualSource], [B, transform(bSrc).virtualSource]]),
                versions: new Map([[A, 1], [B, 1]]),
            });
            const codes = [...service.getSyntacticDiagnostics(B), ...service.getSemanticDiagnostics(B)].map(d => d.code);
            // resolved ⇒ a property-on-string error (2339/2551), and NO module errors
            expect(codes).not.toContain(2306);
            expect(codes).not.toContain(2307);
            expect(codes.some(c => c === 2339 || c === 2551)).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

// Milestone 14 (Standalone Type Definitions `// T: typedef` → Gate 12).
//
// Parser: `typedef` is one more arm of the node-less partition (`import`,
// `=>`, `ignore`). Transformer: it hoists an inline-object @typedef block +
// a synthetic `export const Name = {}` to module scope (de-risk #1 proved the
// export binding is REQUIRED for cross-file resolution; de-risk #2 proved the
// inline-object form type-checks and hovers like @typedef {Object}+@property).
// Handler/TS host: unchanged.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { parse_ety } from '../src/parser.js';
import { transformDocument } from '../src/transform.js';
import { createTsService } from '../src/tsHost.js';

const transform = src => transformDocument(src, parse_ety(src));
const codeLines = ({ virtualSource, lineKind }) =>
    virtualSource.split('\n').filter((_, v) => (lineKind.get(v) ?? { kind: 'code' }).kind === 'code');

describe('parser: typedef emission (node-less, own offsets)', () => {
    it('emits exactly one typedef annotation bound to no AST node', () => {
        const src = '// T: typedef User = { id: string, name: string, age: number }\n';
        const anns = parse_ety(src);
        expect(anns).toHaveLength(1);
        expect(anns[0]).toMatchObject({
            kind: 'typedef', name: 'User',
            ety: '{ id: string, name: string, age: number }', doc: '',
            nodeStartOffset: 0, etyStartOffset: 0,
        });
    });

    it('splits name = body on the first real = (not the => of a function-type body)', () => {
        const [a] = parse_ety('// T: typedef Fn = (x: number) => string\n');
        expect(a).toMatchObject({ kind: 'typedef', name: 'Fn', ety: '(x: number) => string' });
    });

    it('keeps a per-property - inside the body verbatim, with an empty doc', () => {
        // ` - ` is a per-property description, not the typedef's whole-declaration
        // descriptor (that is a `// T: #` line), so the body survives verbatim.
        const [a] = parse_ety('// T: typedef User = { id: string - unique id, name: string }\n');
        expect(a).toMatchObject({ name: 'User', ety: '{ id: string - unique id, name: string }', doc: '' });
    });

    it('malformed (no =) keeps the name and an empty body — never a crash', () => {
        const [a] = parse_ety('// T: typedef User\n');
        expect(a).toMatchObject({ kind: 'typedef', name: 'User', ety: '', doc: '' });
    });

    it('malformed (no name) keeps an empty name and the body', () => {
        const [a] = parse_ety('// T: typedef = number\n');
        expect(a).toMatchObject({ kind: 'typedef', name: '', ety: 'number' });
    });

    it('a // T: typedef inside a string literal is not a comment → no annotation', () => {
        expect(parse_ety('const s = "// T: typedef X = number";\n')).toEqual([]);
    });

    it('a // T: # line emits a node-less desc annotation (text after the #)', () => {
        const [a] = parse_ety('// T: # A registered user\n');
        expect(a).toMatchObject({ kind: 'desc', name: '', ety: 'A registered user', doc: '' });
    });
});

describe('transform: hoisted inline-object projection + synthetic export const', () => {
    const SRC = '// T: typedef User = { id: string, name: string, age: number }\n';

    it('projects to an inline-object @typedef block + export const, hoisted to the top', () => {
        const { virtualSource } = transform(SRC);
        const v = virtualSource.split('\n');
        expect(v[0]).toBe('/**');
        expect(v[1]).toBe(' * @typedef {{ id: string, name: string, age: number }} User');
        expect(v[2]).toBe(' */');
        expect(v[3]).toBe('export const User = {};');
        // original comment line survives verbatim below the hoist
        expect(v[4]).toBe('// T: typedef User = { id: string, name: string, age: number }');
    });

    it('verbatim superset: dropping synthetic lines reproduces the original exactly', () => {
        const t = transform(SRC);
        // every original line survives as a code line; synthetic lines drop out
        expect(codeLines(t).join('\n')).toBe(SRC);
    });

    it('synthetic lines map vToO→the typedef comment line, carry no oToV, and a commentRange', () => {
        const { vToO, oToV, lineKind } = transform(SRC);
        for (let v = 0; v <= 3; v++) {
            expect(vToO.get(v)).toBe(0);                 // back to the // T: typedef line
            expect(lineKind.get(v).kind).not.toBe('code');
            expect(lineKind.get(v).commentRange).toBeDefined();
        }
        expect(oToV.get(0)).toBe(4);                     // comment's own oToV is its verbatim copy, not the hoist
    });

    it('renders a following // T: # line as the JSDoc leading line, above @typedef', () => {
        const { virtualSource } = transform('// T: typedef User = { id: string }\n// T: # A registered user\n');
        const v = virtualSource.split('\n');
        expect(v[0]).toBe('/**');
        expect(v[1]).toBe(' * A registered user');
        expect(v[2]).toBe(' * @typedef {{ id: string }} User');
    });

    it('joins multiple contiguous // T: # lines as separate leading lines', () => {
        const { virtualSource } = transform('// T: typedef User = { id: string }\n// T: # line one\n// T: # line two\n');
        const v = virtualSource.split('\n');
        expect(v[1]).toBe(' * line one');
        expect(v[2]).toBe(' * line two');
        expect(v[3]).toBe(' * @typedef {{ id: string }} User');
    });

    it('expands an object body with per-property - descriptions into @property tags', () => {
        const { virtualSource } = transform('// T: typedef User = { id: string - unique id, name?: string - display name }\n');
        const v = virtualSource.split('\n');
        expect(v[0]).toBe('/**');
        expect(v[1]).toBe(' * @typedef {Object} User');
        expect(v[2]).toBe(' * @property {string} id - unique id');
        expect(v[3]).toBe(' * @property {string} [name] - display name');
        expect(v[4]).toBe(' */');
        expect(v[5]).toBe('export const User = {};');
    });

    it('combines a # descriptor with per-property @property expansion', () => {
        const { virtualSource } = transform('// T: typedef User = { id: string - unique id }\n// T: # A registered user\n');
        const v = virtualSource.split('\n');
        expect(v[1]).toBe(' * A registered user');
        expect(v[2]).toBe(' * @typedef {Object} User');
        expect(v[3]).toBe(' * @property {string} id - unique id');
    });

    it('runs @property types through convertGenerics (Map{K,V} → Map<K,V>)', () => {
        const { virtualSource } = transform('// T: typedef T = { m: Map{string, User} - the map }\n');
        expect(virtualSource).toContain(' * @property {Map<string, User>} m - the map');
    });

    it('keeps the inline-object form when an object body has no per-property descriptions', () => {
        const { virtualSource } = transform('// T: typedef User = { id: string, name: string }\n');
        expect(virtualSource).toContain(' * @typedef {{ id: string, name: string }} User');
        expect(virtualSource).not.toContain('@property');
    });

    it('runs the body through convertGenerics (Map{K,V} → Map<K,V>)', () => {
        const { virtualSource } = transform('// T: typedef Pair = Map{K, V}\n');
        expect(virtualSource).toContain(' * @typedef {Map<K, V>} Pair');
    });

    it('leaves string-literal unions untouched', () => {
        const { virtualSource } = transform("// T: typedef Status = 'pending' | 'active'\n");
        expect(virtualSource).toContain(" * @typedef {'pending' | 'active'} Status");
    });

    it('neutralizes a */ in the body so it cannot terminate the injected block early', () => {
        const { virtualSource } = transform('// T: typedef Bad = number */\n');
        expect(virtualSource).not.toContain('number */}');
        expect(virtualSource).toContain('number * /');
    });

    it('a typedef written inside a function body still hoists its export to module scope', () => {
        const src = 'function f() {\n// T: typedef Local = { x: number }\n    return 1;\n}\n';
        const { virtualSource } = transform(src);
        const v = virtualSource.split('\n');
        const exportLine = v.findIndex(l => l === 'export const Local = {};');
        const fnLine = v.findIndex(l => l.startsWith('function f'));
        expect(exportLine).toBeGreaterThanOrEqual(0);
        expect(exportLine).toBeLessThan(fnLine); // hoisted ABOVE the function, at module scope
    });
});

describe('end-to-end: the typedef participates in type-checking (real TS pipeline)', () => {
    const FILE = '/virtual/models.js';
    const serviceFor = src => {
        const { virtualSource } = transform(src);
        const service = createTsService({
            virtualDocs: new Map([[FILE, virtualSource]]),
            versions: new Map([[FILE, 1]]),
        });
        const diags = [...service.getSyntacticDiagnostics(FILE), ...service.getSemanticDiagnostics(FILE)];
        return { service, virtualSource, diags };
    };

    it('a well-typed use of a typedef yields zero diagnostics', () => {
        const src = [
            '// T: typedef User = { id: string, name: string }',
            'const u = { id: "1", name: "n" }; // T: User',
            '',
        ].join('\n');
        expect(serviceFor(src).diags).toEqual([]);
    });

    it('a mis-shaped value is caught, on the ORIGINAL code line not the typedef line', () => {
        const src = [
            '// T: typedef User = { id: string, name: string }',
            'const u = { id: 1, name: "n" }; // T: User',
            '',
        ].join('\n');
        const { diags, virtualSource } = serviceFor(src);
        expect(diags).toHaveLength(1);
        expect(diags[0].code).toBe(2322); // number not assignable to string
        // the error text sits on the user's value, in the body — not in the hoisted JSDoc
        const span = virtualSource.slice(diags[0].start, diags[0].start + diags[0].length);
        expect(span).toContain('id');
    });

    it('the @property-expanded form (per-property descriptions) still type-checks', () => {
        const ok = [
            '// T: typedef User = { id: string - unique id, name: string - display name }',
            'const u = { id: "1", name: "n" }; // T: User',
            '',
        ].join('\n');
        expect(serviceFor(ok).diags).toEqual([]);

        const bad = [
            '// T: typedef User = { id: string - unique id, name: string - display name }',
            'const u = { id: 1, name: "n" }; // T: User',
            '',
        ].join('\n');
        const { diags } = serviceFor(bad);
        expect(diags.map(d => d.code)).toEqual([2322]); // number not assignable to string
    });
});

describe('cross-file: the synthetic export const is what makes a typedef importable (de-risk #1)', () => {
    it('a typedef declared in one open doc resolves through // T: import in another', () => {
        const root = mkdtempSync(join(tmpdir(), 'ety-typedef-'));
        try {
            const A = join(root, 'models.js');
            const B = join(root, 'service.js');
            const aSrc = '// T: typedef User = { id: string }\n';
            const bSrc = [
                "// T: import { User } from './models'",
                'const bad = { id: 1 }; // T: User', // id:number — error only if User RESOLVED
                '',
            ].join('\n');
            writeFileSync(A, aSrc);
            writeFileSync(B, bSrc);
            const virtualDocs = new Map([[A, transform(aSrc).virtualSource], [B, transform(bSrc).virtualSource]]);
            const versions = new Map([[A, 1], [B, 1]]);
            const service = createTsService({ virtualDocs, versions });
            const diags = [...service.getSyntacticDiagnostics(B), ...service.getSemanticDiagnostics(B)];
            // Resolution succeeded ⇒ the {id:number} mismatch is the ONLY diagnostic
            // (no 2306 "not a module", no 2307 "cannot find module").
            expect(diags.map(d => d.code)).toEqual([2322]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

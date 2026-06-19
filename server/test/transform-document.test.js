// transformDocument invariants (Milestone 2 / Gate 2), fed by the REAL
// Milestone-1 parser — these tests exercise parse_ety + transformDocument
// together, exactly as processDocument will wire them in Milestone 4.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse_ety } from '../src/parser.js';
import { transformDocument } from '../src/transform.js';

const TRANSFORM_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/transform');

const transform = source => transformDocument(source, parse_ety(source));

// One import + five annotations across every kind (Gate 2: "5+ annotations").
const MAIN = [
    "// T: import { User, Role } from './types'",
    'let count = 0; // T: number',
    'const cache = new Map(); // T: Map{string, User}',
    '',
    'function createUser(name, role) {',
    '// T: (name: string, role?: Role) => User',
    '    return { name, role };',
    '}',
    '',
    'class Box {',
    '// T: {T}',
    '    value; // T: T',
    '}',
    '',
].join('\n');

describe('transformDocument invariants', () => {
    it('verbatim superset: dropping injected lines reproduces the original exactly', () => {
        const { virtualSource, lineKind } = transform(MAIN);
        const kept = virtualSource
            .split('\n')
            .filter((_, v) => (lineKind.get(v) ?? { kind: 'code' }).kind === 'code');
        expect(kept.join('\n')).toBe(MAIN);
    });

    it('oToV maps every original line to its virtual code line, with characters unchanged', () => {
        const { virtualSource, vToO, oToV } = transform(MAIN);
        const vLines = virtualSource.split('\n');
        const oLines = MAIN.split('\n');
        for (let o = 0; o < oLines.length; o++) {
            const v = oToV.get(o);
            expect(v, `original line ${o} has an oToV entry`).toBeDefined();
            // vToO restricted to code lines is the inverse of oToV…
            expect(vToO.get(v)).toBe(o);
            // …and the line content is byte-identical (column positions hold).
            expect(vLines[v]).toBe(oLines[o]);
        }
    });

    it('vToO is many-to-one overall (JSDoc lines also map to their annotated line)', () => {
        const { vToO, oToV } = transform(MAIN);
        expect(vToO.size).toBeGreaterThan(oToV.size);
    });

    it('delayed mapping trap: the annotated line maps to the line AFTER its JSDoc block', () => {
        // Written as an explicit test so no one "fixes" the off-by-one into
        // existence: oToV of an annotated line must skip the injected JSDoc.
        const { virtualSource, vToO, oToV, lineKind } = transform(MAIN);
        const vLines = virtualSource.split('\n');
        const vCount = oToV.get(1); // 'let count = 0; // T: number'
        expect(vLines[vCount]).toBe('let count = 0; // T: number');
        expect(vLines[vCount - 1]).toBe('/** @type {number} */');
        expect(vToO.get(vCount - 1)).toBe(1); // JSDoc maps back to the annotated line
        expect(lineKind.get(vCount - 1)).toMatchObject({ kind: 'jsdoc' });
    });

    it('jsdoc lineKind carries the original // T: comment span for diagnostics remapping', () => {
        const { oToV, lineKind } = transform(MAIN);
        const jsdocLine = oToV.get(1) - 1;
        const commentStart = MAIN.split('\n')[1].indexOf('//');
        expect(lineKind.get(jsdocLine).commentRange).toEqual({
            start: { line: 1, character: commentStart },
            end: { line: 1, character: MAIN.split('\n')[1].length },
        });
    });

    it('hoisted import: vToO points at the real source line, oToV does NOT point at the hoisted copy', () => {
        const { virtualSource, vToO, oToV, lineKind } = transform(MAIN);
        const vLines = virtualSource.split('\n');
        // Virtual line 0 is the hoisted import…
        expect(vLines[0]).toBe("import { User, Role } from './types';");
        expect(lineKind.get(0)).toMatchObject({ kind: 'import' });
        // …mapping back to the comment's real source line (0)…
        expect(vToO.get(0)).toBe(0);
        // …while oToV(0) points at the flushed copy of the comment line itself.
        expect(oToV.get(0)).toBe(1);
        expect(vLines[1]).toBe("// T: import { User, Role } from './types'");
        // The import's commentRange covers the whole comment on line 0.
        expect(lineKind.get(0).commentRange).toEqual({
            start: { line: 0, character: 0 },
            end: { line: 0, character: vLines[1].length },
        });
    });

    it('shebang stays virtual line 0; hoisted imports follow it', () => {
        const source = "#!/usr/bin/env node\n// T: import { User } from './types'\nlet u = null; // T: User | null\n";
        const { virtualSource, vToO, lineKind } = transform(source);
        const vLines = virtualSource.split('\n');
        expect(vLines[0]).toBe('#!/usr/bin/env node');
        expect(lineKind.get(0)).toEqual({ kind: 'code' });
        expect(vToO.get(0)).toBe(0);
        expect(vLines[1]).toBe("import { User } from './types';");
        expect(lineKind.get(1)).toMatchObject({ kind: 'import' });
    });

    it('`// T: ignore` injects nothing and records its line in ignoredLines', () => {
        const source = 'let count = 0; // T: number\nbadCall("oops"); // T: ignore\n';
        const { virtualSource, ignoredLines, lineKind } = transform(source);
        // The directive line is collected (line 1) but the type annotation is not.
        expect([...ignoredLines]).toEqual([1]);
        // It is purely additive-free: no JSDoc is injected for the directive,
        // only for the real `// T: number` on line 0.
        const jsdoc = [...lineKind.values()].filter(k => k.kind === 'jsdoc');
        expect(jsdoc).toHaveLength(1);
        expect(virtualSource).toBe('/** @type {number} */\n' + source);
    });

    it('the `// T:i` shorthand is also collected as an ignore line', () => {
        const { ignoredLines } = transform('badCall(); // T:i\n');
        expect([...ignoredLines]).toEqual([0]);
    });

    it('a source with no annotations passes through untouched', () => {
        const source = 'const plain = 1;\nfunction f() { return 2; }\n';
        const { virtualSource, vToO, oToV } = transform(source);
        expect(virtualSource).toBe(source);
        const n = source.split('\n').length;
        expect(vToO.size).toBe(n);
        expect(oToV.size).toBe(n);
    });
});

describe('transformDocument golden snapshots', () => {
    const inputs = readdirSync(TRANSFORM_DIR).filter(f => f.endsWith('.input.js'));
    expect(inputs.length).toBeGreaterThan(0);

    for (const f of inputs) {
        it(f.replace('.input.js', ''), () => {
            const source = readFileSync(join(TRANSFORM_DIR, f), 'utf8');
            const golden = readFileSync(join(TRANSFORM_DIR, f.replace('.input.js', '.golden.js')), 'utf8');
            expect(transform(source).virtualSource).toBe(golden);
        });
    }
});

// Milestone 6: hardening + regression wall (implementation-plan.md). Not a
// Gate — the moat that keeps the Gates honest. Adversarial inputs, policy
// assertions (CRLF, pins), and the performance budget.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parse_ety } from '../src/parser.js';
import {
    LineIndex, convertGenerics, splitTopLevel, extractParamList, toJsDocType, transformDocument,
} from '../src/transform.js';
import { createTsService } from '../src/tsHost.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('unicode identifiers', () => {
    it('a unicode type name immediately before { reads as a generic, same as ASCII', () => {
        expect(convertGenerics('Бокс{string}')).toBe('Бокс<string>');
        expect(convertGenerics('日本語{User}')).toBe('日本語<User>');
    });

    it('the space-before-{ object rule still wins for unicode names', () => {
        expect(convertGenerics('Бокс {string}')).toBe('Бокс {string}');
    });
});

describe('*/ in a payload must not terminate the injected JSDoc early', () => {
    // A raw */ inside /** @type {…} */ closes the comment mid-line and dumps
    // the rest of the payload into the virtual doc as code. Policy: neutralize
    // to '* /' — the type is still wrong, so TS reports an error that the
    // handlers remap onto the // T: comment the user can actually edit.
    it('neutralizes */ so the comment closes exactly once, at the end', () => {
        const out = toJsDocType('Foo */ bar', 'variable');
        expect(out.indexOf('*/')).toBe(out.length - 2);
    });

    it('class @template payloads are covered too', () => {
        const out = toJsDocType('{T*/}', 'class');
        expect(out.indexOf('*/')).toBe(out.length - 2);
    });

    it('end to end: the virtual doc stays line-stable under a hostile payload', () => {
        const source = 'let x = 1; // T: Foo */ bar\n';
        const { virtualSource } = transformDocument(source, parse_ety(source));
        expect(virtualSource.split('\n')).toHaveLength(source.split('\n').length + 1);
        expect(virtualSource.indexOf('*/')).toBe(virtualSource.indexOf('\n') - 2);
    });
});

describe('adversarial: brackets inside string literals', () => {
    it('splitTopLevel ignores commas and openers inside strings', () => {
        expect(splitTopLevel("'a,(b', c")).toEqual(["'a,(b'", 'c']);
    });

    it("extractParamList ignores a ')' inside a string literal type", () => {
        expect(extractParamList("(x: ')') => number"))
            .toEqual({ before: '', inner: "x: ')'", after: ' => number' });
    });

    it('convertGenerics copies template literals verbatim, converts outside them', () => {
        expect(convertGenerics('`a{b}` | Map{string}')).toBe('`a{b}` | Map<string>');
    });
});

describe('performance budget', () => {
    it('10k-line file: parse + transform under 50ms steady-state', () => {
        const lines = [];
        for (let i = 0; i < 10_000; i++) {
            lines.push(i % 10 === 0
                ? `let v${i} = ${i}; // T: number`
                : `function f${i}(a${i}) { return a${i} + ${i}; }`);
        }
        const source = lines.join('\n') + '\n';
        // Warm-up: addon load and JIT happen once per server process, not per
        // keystroke — the budget guards the steady-state edit loop.
        transformDocument(source, parse_ety(source));

        const t0 = performance.now();
        const annotations = parse_ety(source);
        const { vToO } = transformDocument(source, annotations);
        const elapsed = performance.now() - t0;

        expect(annotations).toHaveLength(1000);
        expect(vToO.size).toBeGreaterThan(10_000);
        expect(elapsed).toBeLessThan(50);
    });
});

describe('CRLF policy: no normalization anywhere, \\n is the sole terminator', () => {
    it('a CRLF twin of a transform fixture produces IDENTICAL line maps', () => {
        const lf = readFileSync(join(ROOT, 'fixtures/transform/basic-function.input.js'), 'utf8');
        const crlf = lf.replaceAll('\n', '\r\n');
        const a = transformDocument(lf, parse_ety(lf));
        const b = transformDocument(crlf, parse_ety(crlf));
        expect([...b.vToO]).toEqual([...a.vToO]);
        expect([...b.oToV]).toEqual([...a.oToV]);
        // Same per-line classification; the \r rides at end of code lines.
        expect([...b.lineKind].map(([v, k]) => [v, k.kind]))
            .toEqual([...a.lineKind].map(([v, k]) => [v, k.kind]));
    });

    it('CRLF and LF twins produce identical diagnostic positions', () => {
        const SRC_LF = 'let count = 0; // T: number\ncount = "oops";\n';
        const positions = src => {
            const F = '/virtual/crlf-twin.js';
            const { virtualSource } = transformDocument(src, parse_ety(src));
            const service = createTsService({
                virtualDocs: new Map([[F, virtualSource]]),
                versions: new Map([[F, 1]]),
            });
            const li = new LineIndex(virtualSource);
            return service.getSemanticDiagnostics(F).map(d => li.getLineAndChar(d.start));
        };
        const lf = positions(SRC_LF);
        expect(lf).toHaveLength(1); // the deliberate error, nothing else
        expect(positions(SRC_LF.replaceAll('\n', '\r\n'))).toEqual(lf);
    });

    it('mixed line endings in one file still map line-for-line', () => {
        const src = 'let a = 1; // T: number\r\nlet b = 2; // T: string\na = "x";\r\n';
        const { oToV, lineKind } = transformDocument(src, parse_ety(src));
        expect(oToV.get(0)).toBe(1); // below a's JSDoc
        expect(oToV.get(1)).toBe(3); // below b's JSDoc
        expect(oToV.get(2)).toBe(4);
        expect(lineKind.get(0).kind).toBe('jsdoc');
        expect(lineKind.get(2).kind).toBe('jsdoc');
    });
});

describe('pins are recorded and loud', () => {
    // Gate 3a behavior (@type on methods, return-keyword anchoring, 80001,
    // types:['*']) is version-sensitive: a dependency bump must fail HERE
    // first, then get re-verified against tshost.test.js deliberately.
    it('TypeScript is pinned exactly', () => {
        expect(ts.version).toBe('6.0.3');
        const pkg = JSON.parse(readFileSync(join(ROOT, 'server/package.json'), 'utf8'));
        expect(pkg.dependencies?.typescript ?? pkg.devDependencies?.typescript).toBe('6.0.3');
    });

    it('Oxc is pinned exactly in Cargo.toml', () => {
        const cargo = readFileSync(join(ROOT, 'crates/ety-parser/Cargo.toml'), 'utf8');
        expect(cargo).toMatch(/oxc_parser\s*=\s*\{?\s*version\s*=\s*"=0\.135\.0"|oxc_parser\s*=\s*"=0\.135\.0"/);
    });
});

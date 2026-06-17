// Characterizes the README's "Signature Style" annotations end to end:
// parse_ety -> transformDocument -> the REAL TypeScript service. Each WORKING
// style is proven live by appending a deliberately-wrong call and asserting TS
// rejects it — an ignored annotation would let the bad call pass silently (and
// is exactly what the per-parameter GAP below demonstrates). The two GAP cases
// pin styles the README documents but the server does NOT yet support, in the
// repo's "V1 LIMITATION as a test" discipline (see tshost.test.js). The plan to
// turn them green is locals/signature-style-gaps-plan.md.
import { describe, it, expect } from 'vitest';
import { parse_ety } from '../src/parser.js';
import { transformDocument } from '../src/transform.js';
import { createTsService } from '../src/tsHost.js';

const FILE = '/virtual/fixture.js';

// Full pipeline: source -> annotations -> virtual doc -> merged TS diagnostics.
// Syntactic first, then semantic — the order pushDiagnostics merges them.
function diagnose(source) {
    const { virtualSource } = transformDocument(source, parse_ety(source));
    const service = createTsService({
        virtualDocs: new Map([[FILE, virtualSource]]),
        versions: new Map([[FILE, 1]]),
    });
    return [
        ...service.getSyntacticDiagnostics(FILE),
        ...service.getSemanticDiagnostics(FILE),
    ];
}
const codes = source => diagnose(source).map(d => d.code);

describe('Signature styles that WORK (annotation is live: deliberate misuse is caught)', () => {
    it('positional — (number, number) => number names params positionally', () => {
        const ok = 'function add(a, b) {\n// T: (number, number) => number\n    return a + b;\n}\nconst r = add(1, 2);\nr.toFixed(2);\n';
        expect(codes(ok)).toEqual([]);

        const bad = 'function add(a, b) {\n// T: (number, number) => number\n    return a + b;\n}\nadd("x", "y");\n';
        expect(codes(bad)).toEqual([2345]); // Argument 'string' not assignable to 'number'.
    });

    it('named — (a: number, b: number) => number passes the names through unchanged', () => {
        const bad = 'function add(a, b) {\n// T: (a: number, b: number) => number\n    return a + b;\n}\nadd("x", "y");\n';
        expect(codes(bad)).toEqual([2345]);
    });

    it('void return, explicit — (string) => void', () => {
        const bad = 'function logMessage(msg) {\n// T: (string) => void\n    console.log(msg);\n}\nlogMessage(123);\n';
        expect(codes(bad)).toEqual([2345]); // Argument 'number' not assignable to 'string'.
    });

    it('void return, shorthand — "(string)" implies "=> void" (functions only)', () => {
        const bad = 'function logMessage(msg) {\n// T: (string)\n    console.log(msg);\n}\nlogMessage(123);\n';
        expect(codes(bad)).toEqual([2345]); // number not assignable to string -> shorthand applied

        const ok = 'function logMessage(msg) {\n// T: (string)\n    console.log(msg);\n}\nlogMessage("ok");\n';
        expect(codes(ok)).toEqual([]);
    });

    it('description AFTER the // T: line is ignored; the annotation still applies', () => {
        const bad = 'function add(a, b) {\n// T: (number, number) => number\n// Adds two numbers together\n    return a + b;\n}\nadd("x", "y");\n';
        expect(codes(bad)).toEqual([2345]);
    });

    it('description BEFORE the // T: line is ignored; the annotation still applies', () => {
        const bad = 'function add(a, b) {\n// Adds two numbers together\n// T: (number, number) => number\n    return a + b;\n}\nadd("x", "y");\n';
        expect(codes(bad)).toEqual([2345]);
    });

    it('per-parameter — trailing // T: on each param and a // T: => R return', () => {
        // Each param carries its own type (with an optional `- description`), and
        // the return type is a bare `=> R`. The parser assembles a @param/@returns
        // JSDoc block above the function; the misuse below must be caught.
        const bad = 'function add(\n    a,  // T: number - First operand\n    b   // T: number - Second operand\n) {\n    return a + b;  // T: => number\n}\nadd("x", "y");\n';
        expect(codes(bad)).toEqual([2345]); // string arg vs number param

        const ok = 'function add(\n    a,  // T: number - First operand\n    b   // T: number - Second operand\n) {\n    return a + b;  // T: => number\n}\nconst r = add(1, 2);\nr.toFixed(2);\n';
        expect(codes(ok)).toEqual([]);
    });

    it('per-parameter — a wrong RETURN type is caught against the body', () => {
        // @returns {string} but the body returns a number -> mismatch.
        const src = 'function add(\n    a,  // T: number\n    b   // T: number\n) {\n    return a + b;  // T: => string\n}\n';
        expect(codes(src)).toContain(2322); // number not assignable to string
    });

    it('per-parameter — works on a class METHOD', () => {
        const bad = 'class C {\n  add(\n    a,  // T: number\n    b   // T: number\n  ) {\n    return a + b;  // T: => number\n  }\n}\nnew C().add("x", 1);\n';
        expect(codes(bad)).toEqual([2345]);
    });

    it('per-parameter — works on a block-body ARROW', () => {
        const bad = 'const add = (\n    a,  // T: number\n    b   // T: number\n) => {\n    return a + b;  // T: => number\n};\nadd("x", 1);\n';
        expect(codes(bad)).toEqual([2345]);
    });

    it('per-parameter — params bind on a CONCISE arrow (return is inferred)', () => {
        // A concise arrow has no block body, so a trailing `// T: => R` does not
        // bind; the param annotations still apply and the return is inferred.
        const bad = 'const inc = (\n    n  // T: number\n) => n + 1;\ninc("x");\n';
        expect(codes(bad)).toEqual([2345]);
    });
});

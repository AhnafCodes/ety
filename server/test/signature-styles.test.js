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
});

describe('GAP: styles the README documents but the server does NOT yet support', () => {
    // Plan to turn this green: locals/signature-style-gaps-plan.md (Gap 2)
    it('per-parameter — trailing // T: on params and return yields NO annotations', () => {
        const src = 'function add(\n    a,  // T: number - First operand\n    b   // T: number - Second operand\n) {\n    return a + b;  // T: => number\n}\nadd("x", "y");\n';
        // The visitor binds // T: only to functions/variables/properties/classes
        // — never to a function PARAMETER or a RETURN statement. So none of these
        // comments attach: zero annotations, zero type-checking, bad call silent.
        expect(parse_ety(src)).toEqual([]);
        expect(codes(src)).toEqual([]);
    });
});

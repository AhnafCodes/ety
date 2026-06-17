// Parser contract suite (implementation-plan.md, Methodology Rule 3).
//
// These fixtures are the shared contract between the Rust parser and the Node
// transformer: source in, expected EtyAnnotation[] out (napi-rs camelCase as
// seen from JS). Milestone 0 runs them against the stub parser; Milestone 1
// swaps in the compiled napi-rs addon behind this same suite — green means
// the swap is invisible (Gate 1).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse_ety } from '../src/parser.js';

const CONTRACT_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/contract');

const fixtures = readdirSync(CONTRACT_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => JSON.parse(readFileSync(join(CONTRACT_DIR, f), 'utf8')));

describe('parse_ety contract', () => {
    for (const fixture of fixtures) {
        it(fixture.name, () => {
            expect(parse_ety(fixture.source)).toEqual(fixture.expected);
        });
    }

    it('exposes napi-rs camelCased fields, not Rust snake_case', () => {
        const [annotation] = parse_ety('let count = 0; // T: number\n');
        expect(Object.keys(annotation).sort()).toEqual([
            'doc',
            'ety',
            'etyEndOffset',
            'etyStartOffset',
            'kind',
            'name',
            'nodeStartOffset',
        ]);
    });
});

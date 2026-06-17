// toJsDocType unit tests (Milestone 2) — the seed harness the plan calls for:
// positional naming, optional `?`, named-param passthrough, tuple/union
// guard, class {T} -> @template. TypeScript requires a parameter NAME at
// every level of a function type — `(T) => boolean` reads as a param NAMED T
// of type any — hence the synthetic `pN:` naming for positional signatures.
import { describe, it, expect } from 'vitest';
import { toJsDocType } from '../src/transform.js';

describe('toJsDocType', () => {
    const table = [
        // --- function signatures: positional params get synthetic names ---
        ['(string) => User', 'function',
            '/** @type {(p0: string) => User} */'],
        ['(string, string, Role?) => User', 'function',
            '/** @type {(p0: string, p1: string, p2?: Role) => User} */'],
        // --- generic prefix list survives in `before` ---
        ['{T}(T[]) => T[]', 'function',
            '/** @type {<T>(p0: T[]) => T[]} */'],
        ['{T}(string, RequestInit?) => Promise{T}', 'function',
            '/** @type {<T>(p0: string, p1?: RequestInit) => Promise<T>} */'],
        // --- named params pass through unchanged (recommended convention) ---
        ['(name: string, role?: Role) => User', 'function',
            '/** @type {(name: string, role?: Role) => User} */'],
        ['(items: T[], pred: (x: T) => boolean) => T[]', 'function',
            '/** @type {(items: T[], pred: (x: T) => boolean) => T[]} */'],
        // --- nested function type: top-level naming only (documented limit) ---
        ['{U}((T) => U) => Box{U}', 'function',
            '/** @type {<U>(p0: (T) => U) => Box<U>} */'],
        // --- non-signatures are wrapped verbatim (function-type guard) ---
        ['number', 'variable',
            '/** @type {number} */'],
        ['Map{string, User}', 'variable',
            '/** @type {Map<string, User>} */'],
        ['{ id: string, name: string }', 'variable',
            '/** @type {{ id: string, name: string }} */'],
        ['[(string) => void, number]', 'variable',
            '/** @type {[(string) => void, number]} */'],
        ['((string) => void) | null', 'variable',
            '/** @type {((string) => void) | null} */'],
        // --- class generic params -> @template, never @type ---
        ['{T}', 'class',
            '/** @template T */'],
        ['{T, U}', 'class',
            '/** @template T, U */'],
        // --- object type on a param at depth 0 has a ':' that must not
        //     count as a name separator at depth > 0 ---
        ['({id: string}) => void', 'function',
            '/** @type {(p0: {id: string}) => void} */'],
        // --- void-return shorthand: a bare param list implies `=> void`,
        //     functions ONLY (README "Void return (shorthand)") ---
        ['(string)', 'function',
            '/** @type {(p0: string) => void} */'],
        ['()', 'function',
            '/** @type {() => void} */'],
        ['{T}(T[])', 'function',
            '/** @type {<T>(p0: T[]) => void} */'],
        // a VARIABLE keeps `(string)` as a parenthesized type — shorthand must
        // not fire off-kind (the gate that makes the change non-regressive)
        ['(string)', 'variable',
            '/** @type {(string)} */'],
    ];

    for (const [ety, kind, expected] of table) {
        it(`${kind}: ${JSON.stringify(ety)}`, () => {
            expect(toJsDocType(ety, kind)).toBe(expected);
        });
    }

    it('malformed class payload falls through to @type rather than crashing', () => {
        // A class with no generics carries no // T: annotation, so a
        // non-{...} payload here is user error; degrade, don't throw.
        expect(toJsDocType('number', 'class')).toBe('/** @type {number} */');
    });

    it('standalone {T} on a NON-class kind stays an object type', () => {
        // Guards the class-branch ordering: convertGenerics classifies a
        // standalone {T} as an object (no preceding identifier, no trailing
        // paren), so only the class branch may turn it into @template.
        expect(toJsDocType('{T}', 'variable')).toBe('/** @type {{T}} */');
    });
});

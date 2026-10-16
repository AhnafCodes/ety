// convertGenerics / splitTopLevel / extractParamList unit tests (Milestone 2).
// One table row per disambiguation case from the spec's Annotation Syntax
// section, plus the two regression cases the plan calls out by name:
// the #9 space rule and the all-bracket-kinds constraint case.
import { describe, it, expect } from 'vitest';
import { convertGenerics, splitTopLevel, extractParamList, hasTrailingLineComment } from '../src/transform.js';

describe('convertGenerics — the {} disambiguation rule', () => {
    const table = [
        // [input, expected, why]
        ['Map{string, User}', 'Map<string, User>', 'postfix args: { immediately after identifier'],
        ['Box{T}', 'Box<T>', 'postfix args'],
        ['{id: string}', '{id: string}', 'standalone { is an object type'],
        ['{T}(T[]) => T[]', '<T>(T[]) => T[]', 'prefix list: } immediately followed by ('],
        ['Map {string}', 'Map {string}', '#9 regression: a SPACE before { makes it an object type'],
        ['Map{string, {id: string}}', 'Map<string, {id: string}>', 'nesting: stack matches closers to openers'],
        ["'{}'", "'{}'", 'string literals are copied verbatim'],
        ['Set{string}', 'Set<string>', 'postfix args'],
        ['Promise{T}', 'Promise<T>', 'postfix args'],
        ['(number) => {ok: boolean}', '(number) => {ok: boolean}', 'object type after => is preserved'],
        ['{U}((T) => U) => Box{U}', '<U>((T) => U) => Box<U>', 'prefix list and postfix args in one payload'],
        ['Map{string, User[]} | null', 'Map<string, User[]> | null', 'union around a generic'],
    ];

    for (const [input, expected, why] of table) {
        it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)} (${why})`, () => {
            expect(convertGenerics(input)).toBe(expected);
        });
    }
});

describe('splitTopLevel — top-level commas only', () => {
    it('splits a flat list', () => {
        expect(splitTopLevel('string, number')).toEqual(['string', 'number']);
    });

    it('does not split inside nested parens (callback param)', () => {
        expect(splitTopLevel('T[], (T) => boolean')).toEqual(['T[]', '(T) => boolean']);
    });

    it('does not split inside generics or objects', () => {
        expect(splitTopLevel('Map<K, V>, {a: string, b: number}')).toEqual([
            'Map<K, V>',
            '{a: string, b: number}',
        ]);
    });

    it('skips the => arrow so its > does not unbalance depth', () => {
        expect(splitTopLevel('(x: T) => U, V')).toEqual(['(x: T) => U', 'V']);
    });

    it('ignores commas inside string literals', () => {
        expect(splitTopLevel("'a,b', number")).toEqual(["'a,b'", 'number']);
    });

    it('returns empty array for empty input', () => {
        expect(splitTopLevel('')).toEqual([]);
    });
});

describe('extractParamList — the (...) group immediately followed by =>', () => {
    it('extracts a simple parameter list', () => {
        expect(extractParamList('(string) => User')).toEqual({
            before: '',
            inner: 'string',
            after: ' => User',
        });
    });

    it('keeps a generic prefix in `before`', () => {
        expect(extractParamList('<T>(T[]) => T[]')).toEqual({
            before: '<T>',
            inner: 'T[]',
            after: ' => T[]',
        });
    });

    it('returns null for a grouped type that is not followed by =>', () => {
        // "((string) => void)" is a grouped function TYPE, not a signature —
        // its outer group closes at end of string with no trailing =>.
        expect(extractParamList('((string) => void)')).toBeNull();
    });

    it('regression: tracks ALL bracket kinds — constraint containing a function type', () => {
        // <T extends () => void>(x: T) => T — tracking only '()' would mistake
        // the '()' inside the constraint for the parameter list.
        expect(extractParamList('<T extends () => void>(x: T) => T')).toEqual({
            before: '<T extends () => void>',
            inner: 'x: T',
            after: ' => T',
        });
    });

    it('returns null when the (...) sits inside a tuple', () => {
        // The group is never at top level, so there is no parameter list.
        expect(extractParamList('[(string) => void, number]')).toBeNull();
    });

    it('returns null for a plain type', () => {
        expect(extractParamList('number')).toBeNull();
    });
});

describe('hasTrailingLineComment — the auto-annotate quick fix guard', () => {
    it('detects a plain trailing comment', () => {
        expect(hasTrailingLineComment('let i = 0; // note')).toBe(true);
    });

    it('detects a // T: comment too (any comment counts, not just ety ones)', () => {
        expect(hasTrailingLineComment('let i = 0; // T: number')).toBe(true);
    });

    it('returns false for a line with no comment', () => {
        expect(hasTrailingLineComment('let i = 0;')).toBe(false);
    });

    it('ignores a // sequence inside a string literal', () => {
        expect(hasTrailingLineComment('let u = "http://example.com";')).toBe(false);
    });
});

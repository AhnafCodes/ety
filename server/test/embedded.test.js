// Milestone 13 (embedded `<script>` JS → Gate 11) — the pure pre-pass, unit
// tested without the parser or TS. Two things are proven here: the scanner finds
// exactly the JavaScript `<script>` bodies (and nothing else), and the projection
// is LINE- AND COLUMN-PARALLEL to the host — the invariant the whole milestone
// rests on, since it is what lets the unchanged pipeline map positions back.
import { describe, it, expect } from 'vitest';
import {
    detectScriptHost, uriExtension, normalizeHosts, hostScriptPath,
    findScriptRegions, extractScriptProjection, resolveScriptHosts,
} from '../src/embedded.js';

describe('resolveScriptHosts — normalize the ety.scriptHosts setting', () => {
    const table = [
        [undefined, ['html'], 'unset -> default'],
        [null, ['html'], 'null -> default'],
        ['html', ['html'], 'non-array -> default'],
        [[], ['html'], 'empty array -> default'],
        [['html', 'tpl'], ['html', 'tpl'], 'passthrough'],
        [['.HTML', 'Tpl ', 'tpl'], ['html', 'tpl'], 'dot-stripped, lowercased, trimmed, de-duped'],
        [['html', 42, null, 'jsp'], ['html', 'jsp'], 'non-strings dropped'],
    ];
    for (const [raw, expected, why] of table) {
        it(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)} (${why})`, () => {
            expect(resolveScriptHosts(raw)).toEqual(expected);
        });
    }
});

describe('detectScriptHost — extension match against configured hosts', () => {
    const table = [
        ['file:///x/page.html', ['html'], 'html', 'default host'],
        ['file:///x/page.HTML', ['html'], 'html', 'case-insensitive extension'],
        ['file:///x/view.tpl', ['html'], null, 'opt-in format not enabled'],
        ['file:///x/view.tpl', ['html', 'tpl'], 'tpl', 'opt-in format enabled'],
        ['file:///x/app.js', ['html'], null, '.js is never a host'],
        ['file:///x/app.jsx', ['html'], null, '.jsx is never a host'],
        ['untitled:Untitled-1', ['html'], null, 'unsaved buffer is not a host'],
        ['file:///x/page.html?v=2', ['html'], 'html', 'query string stripped'],
        ['file:///x/page.jsp', ['.jsp'], 'jsp', 'configured value may carry a leading dot'],
    ];
    for (const [uri, hosts, expected, why] of table) {
        it(`${uri} with ${JSON.stringify(hosts)} -> ${JSON.stringify(expected)} (${why})`, () => {
            expect(detectScriptHost(uri, hosts)).toBe(expected);
        });
    }

    it('uriExtension / normalizeHosts helpers', () => {
        expect(uriExtension('/a/b/c.HTML')).toBe('html');
        expect(uriExtension('/a/b/noext')).toBe('');
        expect([...normalizeHosts(['.HTML', 'Tpl'])]).toEqual(['html', 'tpl']);
    });

    it('hostScriptPath gives the host a JS extension (TS derives ScriptKind from it)', () => {
        expect(hostScriptPath('/x/page.html')).toBe('/x/page.html.jsx');
    });
});

describe('findScriptRegions — which <script> bodies are JavaScript', () => {
    const body = (src, regions) => regions.map(r => src.slice(r.start, r.end));

    it('a single plain <script> body', () => {
        const src = '<html><body>\n<script>\nlet x = 1;\n</script>\n</body></html>\n';
        const regions = findScriptRegions(src);
        expect(body(src, regions)).toEqual(['\nlet x = 1;\n']);
    });

    it('multiple <script> blocks each yield a region', () => {
        const src = '<script>let a=1;</script>\n<div></div>\n<script>let b=2;</script>';
        expect(body(src, findScriptRegions(src))).toEqual(['let a=1;', 'let b=2;']);
    });

    it('type="module" and text/javascript are included; charset params ignored', () => {
        const src =
            '<script type="module">let a=1;</script>' +
            '<script type="text/javascript; charset=utf-8">let b=2;</script>';
        expect(body(src, findScriptRegions(src))).toEqual(['let a=1;', 'let b=2;']);
    });

    it('non-JS types, src-only, and self-closing tags are excluded', () => {
        const src =
            '<script type="application/json">{"a":1}</script>' +
            '<script type="importmap">{}</script>' +
            '<script src="app.js"></script>' +
            '<script/>' +
            '<script>let real=1;</script>';
        expect(body(src, findScriptRegions(src))).toEqual(['let real=1;']);
    });

    it('case-insensitive over the tag name', () => {
        const src = '<SCRIPT>let x=1;</SCRIPT>';
        expect(body(src, findScriptRegions(src))).toEqual(['let x=1;']);
    });

    it('does not match <scripts> / <scripting> (name must end at the tag)', () => {
        const src = '<scripts>nope</scripts><script>yes=1;</script>';
        expect(body(src, findScriptRegions(src))).toEqual(['yes=1;']);
    });

    it('a > inside a quoted attribute does not end the open tag', () => {
        const src = '<script data-x="a>b" type="module">let x=1;</script>';
        expect(body(src, findScriptRegions(src))).toEqual(['let x=1;']);
    });

    it('HTML5 raw-text rule: </script> inside a JS string still closes the element', () => {
        const src = '<script>const s = "</script>";</script>';
        // The body ends at the FIRST </script — standards-correct, the documented
        // sharp edge — so the body is the JS up to that point, not the whole line.
        expect(body(src, findScriptRegions(src))).toEqual(['const s = "']);
    });
});

describe('extractScriptProjection — line- and column-parallel JS', () => {
    const HTML =
        '<!DOCTYPE html>\n' +     // line 0
        '<body>\n' +             // line 1
        '  <script>\n' +         // line 2
        '    let n = 0;\n' +     // line 3
        '    n = "x";\n' +       // line 4
        '  </script>\n' +        // line 5
        '</body>\n';             // line 6

    it('same line count, script lines byte-identical, everything else blanked', () => {
        const { jsSource } = extractScriptProjection(HTML, 'html');
        const hostLines = HTML.split('\n');
        const jsLines = jsSource.split('\n');

        expect(jsLines.length).toBe(hostLines.length);

        // Script BODY lines (3, 4) are copied verbatim — indentation included.
        expect(jsLines[3]).toBe('    let n = 0;');
        expect(jsLines[4]).toBe('    n = "x";');

        // Non-script lines are blanked to all-spaces of the SAME width (column
        // parity), so every original column still lands at the same column.
        for (const i of [0, 1, 2, 5, 6]) {
            expect(jsLines[i]).toBe(' '.repeat(hostLines[i].length));
        }
    });

    it('removing blanks reproduces only the script bodies (verbatim superset)', () => {
        const { jsSource } = extractScriptProjection(HTML, 'html');
        expect(jsSource.replace(/[ \t]/g, '').replace(/\n+/g, '\n').trim())
            .toBe('letn=0;\nn="x";');
    });

    it('the projection parses as valid JS for the unchanged parser (blank = whitespace)', () => {
        const { jsSource } = extractScriptProjection(HTML, 'html');
        // Blank lines are valid JS whitespace; this is what lets parse_ety run
        // over a host doc with zero changes.
        expect(() => new Function(jsSource)).not.toThrow();
    });

    it('CRLF host: projection keeps the same byte length and line structure', () => {
        const crlf = HTML.replace(/\n/g, '\r\n');
        const { jsSource } = extractScriptProjection(crlf, 'html');
        expect(jsSource.length).toBe(crlf.length);
        expect(jsSource.split('\r\n').length).toBe(crlf.split('\r\n').length);
    });
});

describe('extractScriptProjection — template-delimiter neutralization (opt-in formats)', () => {
    it('html does NOT neutralize ${…} (no delimiter set) — left verbatim', () => {
        const src = '<script>let n = `${x}`;</script>';
        const { jsSource } = extractScriptProjection(src, 'html');
        // Tag text blanks to same-width spaces; the body (incl. ${x}) is verbatim.
        expect(jsSource).toBe(' '.repeat(8) + 'let n = `${x}`;' + ' '.repeat(9));
        expect(jsSource).toContain('${x}');
    });

    it('tpl neutralizes an in-script ${…} to width-preserving inert JS', () => {
        const src = '<script>\nlet n = ${count};\n</script>';
        const { jsSource } = extractScriptProjection(src, 'tpl');
        const line = jsSource.split('\n')[1];
        expect(line).toHaveLength('let n = ${count};'.length); // width preserved
        expect(line).not.toContain('$');
        // `null` RHS — assignable to any `// T:` annotation under non-strict TS.
        expect(line).toMatch(/^let n = null\s+;$/);
        expect(() => new Function(jsSource)).not.toThrow();
    });

    it('jsp neutralizes <%= … %> scriptlets inside a script body', () => {
        const src = '<script>\nlet total = <%= order.total %>;\n</script>';
        const { jsSource } = extractScriptProjection(src, 'jsp');
        const line = jsSource.split('\n')[1];
        expect(line).toHaveLength('let total = <%= order.total %>;'.length);
        expect(line).not.toContain('<%');
        expect(() => new Function(jsSource)).not.toThrow();
    });
});

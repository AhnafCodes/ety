// Milestone 13 (embedded `<script>` JS → Gate 11) — THE de-risk proof. The unit
// tests prove the projection is line/column-parallel; this proves the thesis the
// milestone rests on: that parallelism lets the UNCHANGED pipeline (real parser,
// real transformer, real TS service) place a diagnostic on the correct ORIGINAL
// line AND column of a host document — no new coordinate system below the
// pre-pass. Modeled on orchestration.integration.test.js; only the clock and the
// connection are fake.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse_ety } from '../src/parser.js';
import { createTsService } from '../src/tsHost.js';
import { createState, processDocument, DEBOUNCE_MS } from '../src/handlers.js';

// `count = "oops"` is on host line 4, indented 4 spaces inside <script>.
const HTML_BROKEN =
    '<!DOCTYPE html>\n' +              // 0
    '<body>\n' +                      // 1
    '  <script>\n' +                  // 2
    '    let count = 0; // T: number\n' + // 3
    '    count = "oops";\n' +         // 4
    '  </script>\n' +                 // 5
    '</body>\n';                      // 6

const HTML_FIXED = HTML_BROKEN.replace('"oops"', '5');

function harness(state) {
    const deps = {
        connection: { sendDiagnostics: vi.fn(), console: { error: vi.fn(), warn: vi.fn() } },
        parse_ety,
    };
    deps.tsService = createTsService({ virtualDocs: state.virtualDocs, versions: state.versions });
    return deps;
}

describe('embedded <script> JS — host document pipeline', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('a type error inside an .html <script> squiggles the correct ORIGINAL host line + column', () => {
        const state = createState(); // default scriptHosts: ['html']
        const deps = harness(state);
        const uri = '/virtual/page.html';

        processDocument(state, deps, { uri, version: 1, getText: () => HTML_BROKEN });
        vi.advanceTimersByTime(DEBOUNCE_MS);

        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
        const publish = deps.connection.sendDiagnostics.mock.calls[0][0];
        expect(publish.uri).toBe(uri); // published against the .html, not the .jsx key
        expect(publish.diagnostics).toHaveLength(1);
        // Host line 4, character 4 — the indented `count`, NOT the <script> tag
        // line and NOT the `// T:` line. Column survives because the projection
        // copies the script line (indentation included) verbatim.
        expect(publish.diagnostics[0].range).toEqual({
            start: { line: 4, character: 4 },
            end: { line: 4, character: 9 },
        });
        expect(publish.diagnostics[0].message).toMatch(/not assignable to type 'number'/);

        // Fixing the error clears the squiggle.
        processDocument(state, deps, { uri, version: 2, getText: () => HTML_FIXED });
        vi.advanceTimersByTime(DEBOUNCE_MS);
        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(2);
        expect(deps.connection.sendDiagnostics.mock.calls[1][0]).toMatchObject({ uri, diagnostics: [] });
    });

    it('boundary: inline handlers and non-JS scripts are not analyzed (no diagnostics)', () => {
        const state = createState();
        const deps = harness(state);
        const uri = '/virtual/inert.html';
        const html =
            '<body onclick="count = nope">\n' +
            '<script type="application/json">{ "count": "oops" }</script>\n' +
            '</body>\n';

        processDocument(state, deps, { uri, version: 1, getText: () => html });
        vi.advanceTimersByTime(DEBOUNCE_MS);

        expect(deps.connection.sendDiagnostics).toHaveBeenCalledTimes(1);
        expect(deps.connection.sendDiagnostics.mock.calls[0][0].diagnostics).toEqual([]);
    });

    it('opt-in: a .tpl is analyzed once configured, and an in-script ${…} does not spurious-error', () => {
        const state = createState();
        state.scriptHosts = ['html', 'tpl']; // user opted the template format in
        const deps = harness(state);
        const uri = '/virtual/view.tpl';
        // Static JS error (line 3) is real; the ${userId} on line 2 must be
        // neutralized so it does NOT itself produce a diagnostic.
        const tpl =
            '<div>\n' +                              // 0
            '<script>\n' +                           // 1
            'let id = ${userId}; // T: string\n' +   // 2
            'id = 123;\n' +                          // 3
            '</script>\n' +                          // 4
            '</div>\n';                              // 5

        processDocument(state, deps, { uri, version: 1, getText: () => tpl });
        vi.advanceTimersByTime(DEBOUNCE_MS);

        const publish = deps.connection.sendDiagnostics.mock.calls[0][0];
        // Exactly one diagnostic — the real `id = 123` (number vs string) on
        // host line 3 — and nothing on the neutralized template line.
        expect(publish.diagnostics).toHaveLength(1);
        expect(publish.diagnostics[0].range.start.line).toBe(3);
        expect(publish.diagnostics[0].message).toMatch(/not assignable to type 'string'/);
    });
});

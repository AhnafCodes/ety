// Milestone 13 / Gate 11 — embedded <script> JS in a real editor. The server's
// pre-pass projects the host document to line/column-parallel JS; this proves
// the squiggle the user sees lands on the ORIGINAL .html line, through the VS
// Code client's host-glob document selector. The Gate-4 diagnostics check, now
// from a host document.
const assert = require('node:assert');
const vscode = require('vscode');
const { openFixture, until } = require('./helpers');

describe('embedded <script> diagnostics e2e', () => {
    it('publishes the type error at its original line/character inside embedded.html', async () => {
        const uri = await openFixture('embedded.html');
        const diags = await until(
            () => {
                const d = vscode.languages.getDiagnostics(uri);
                return d.length ? d : null;
            },
            'diagnostics on embedded.html',
        );
        assert.strictEqual(diags.length, 1);
        const d = diags[0];
        // `qty = "oops";` is on ORIGINAL host line 6 (inside <script>), NOT the
        // <script> tag line and NOT the `// T:` line. Column survives the
        // projection because the script line is copied verbatim.
        assert.strictEqual(d.range.start.line, 6);
        assert.strictEqual(d.range.start.character, 0);
        assert.strictEqual(d.range.end.line, 6);
        assert.strictEqual(d.range.end.character, 3);
        assert.match(d.message, /not assignable to type 'number'/);
        assert.strictEqual(d.severity, vscode.DiagnosticSeverity.Error);
    });
});

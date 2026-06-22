// Gate 4: a known type error in a real editor lands on the ORIGINAL line and
// character — the squiggle the user actually sees, after line remapping.
const assert = require('node:assert');
const { describe, it } = require('node:test');
const vscode = require('vscode');
const { openFixture, until } = require('./helpers');

describe('diagnostics e2e', () => {
    it('publishes the type error at the original position in type-error.js', async () => {
        const uri = await openFixture('type-error.js');
        const diags = await until(
            () => {
                const d = vscode.languages.getDiagnostics(uri);
                return d.length ? d : null;
            },
            'diagnostics on type-error.js',
        );
        assert.strictEqual(diags.length, 1);
        const d = diags[0];
        // `count = "oops";` — original line 1, the assignment target.
        assert.strictEqual(d.range.start.line, 1);
        assert.strictEqual(d.range.start.character, 0);
        assert.strictEqual(d.range.end.line, 1);
        assert.strictEqual(d.range.end.character, 5);
        assert.match(d.message, /not assignable to type 'number'/);
        assert.strictEqual(d.severity, vscode.DiagnosticSeverity.Error);
    });
});

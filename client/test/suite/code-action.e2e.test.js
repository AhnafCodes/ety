// Auto-annotate quick fix e2e — a lightbulb on an un-annotated `let i = 0;`
// whose accepted edit lands exactly `// T: number` at the end of that line.
// On by default (ety.autoAnnotate: true); the disabled path is covered at
// the handler level (server/test/code-action.test.js), not here.
const assert = require('node:assert');
const { describe, it } = require('node:test');
const vscode = require('vscode');
const { openFixture, until } = require('./helpers');

describe('auto-annotate quick fix e2e', () => {
    it('offers "Insert // T: number" and applies it to the original line', async () => {
        const uri = await openFixture('no-annotation.js');
        const range = new vscode.Range(0, 0, 0, 0);

        const actions = await until(
            async () => {
                try {
                    const result = await vscode.commands.executeCommand(
                        'vscode.executeCodeActionProvider', uri, range,
                    );
                    return (result && result.length) ? result : null;
                } catch (err) {
                    // vscode.executeCodeActionProvider can reject with a transient
                    // "Canceled" when VS Code supersedes an in-flight code-action
                    // computation (e.g. a debounced diagnostics push landing while
                    // the request is outstanding) — most likely on the very first
                    // LSP request after a cold extension-host boot. Retry past it
                    // like any other not-ready-yet state; a genuine failure still
                    // surfaces via the outer until() timeout.
                    if (err?.message === 'Canceled') return null;
                    throw err;
                }
            },
            'code actions on no-annotation.js',
        );

        const action = actions.find(a => a.title === 'Insert // T: number');
        assert.ok(action, `expected an "Insert // T: number" quick fix, got: ${actions.map(a => a.title)}`);

        const applied = await vscode.workspace.applyEdit(action.edit);
        assert.ok(applied, 'applying the quick fix edit should succeed');

        const doc = await vscode.workspace.openTextDocument(uri);
        assert.strictEqual(doc.lineAt(0).text, 'let i = 0; // T: number');
    });
});

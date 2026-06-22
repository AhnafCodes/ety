// Gate 4 selector test: the same assertions against a .jsx fixture containing
// REAL JSX — proves the javascriptreact documentSelector and jsx: Preserve
// work together (TS parses <div> as JSX, not as comparison operators).
const assert = require('node:assert');
const { describe, it } = require('node:test');
const vscode = require('vscode');
const { openFixture, until, hoverText } = require('./helpers');

describe('javascriptreact selector (.jsx)', () => {
    it('publishes the type error at the original position in component.jsx', async () => {
        const uri = await openFixture('component.jsx');
        const diags = await until(
            () => {
                const d = vscode.languages.getDiagnostics(uri);
                return d.length ? d : null;
            },
            'diagnostics on component.jsx',
        );
        // The deliberate error is the ONLY diagnostic — the JSX itself is
        // clean (local React object; IntrinsicElements implicit-any is
        // suppressed under strict: false).
        assert.strictEqual(diags.length, 1);
        const d = diags[0];
        // `label = 'oops';` — original line 3.
        assert.strictEqual(d.range.start.line, 3);
        assert.strictEqual(d.range.start.character, 0);
        assert.strictEqual(d.range.end.character, 5);
        assert.match(d.message, /not assignable to type 'number'/);
    });

    it('hover inside the JSX expression resolves the annotated type', async () => {
        const uri = await openFixture('component.jsx');
        // line 5: export const el = <div className="x">{label}</div>;
        const text = await until(
            async () => {
                const t = await hoverText(uri, new vscode.Position(5, 40));
                return t.includes('label') ? t : null;
            },
            'hover on label inside JSX',
        );
        assert.match(text, /label:\s*number/);
    });
});

// The Milestone-0 walking skeleton, un-pended for Gate 4: the full
// extension → client → forked server → napi parser → transformer → TS
// pipeline, observed from the editor's side.
const assert = require('node:assert');
const { describe, it } = require('node:test');
const vscode = require('vscode');
const { openFixture, until, hoverText } = require('./helpers');

describe('walking skeleton', () => {
    it('returns a hover response for fixtures/workspace/box.js', async () => {
        const uri = await openFixture('box.js');
        // 'value;' sits on line 3, characters 4-9, annotated `// T: T`.
        const text = await until(
            async () => {
                const t = await hoverText(uri, new vscode.Position(3, 6));
                return t.includes('value') ? t : null;
            },
            'hover on Box.value',
        );
        assert.match(text, /value\??:\s*T\b/); // (property) Box<T>.value: T
    });

    it('hover on `boxed` shows the RESOLVED generic type from its annotation', async () => {
        const uri = await openFixture('box.js');
        // line 15: const boxed = new Box(42); // T: Box{number}
        const text = await until(
            async () => {
                const t = await hoverText(uri, new vscode.Position(15, 8));
                return t.includes('boxed') ? t : null;
            },
            'hover on boxed',
        );
        assert.match(text, /Box<number>/);
    });
});

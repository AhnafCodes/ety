// Test entry loaded by @vscode/test-electron inside the extension host. Runs the
// suite on node:test via run({ isolation: 'none' }) so the files execute in THIS
// process: `require('vscode')` only resolves inside the extension host, so they
// must not be forked out of it (the default isolation).
const path = require('node:path');
const fs = require('node:fs');
const { run } = require('node:test');

async function runTests() {
    const files = fs
        .readdirSync(__dirname)
        .filter(n => n.endsWith('.e2e.test.js'))
        .sort()
        .map(n => path.resolve(__dirname, n));

    let passing = 0;
    let topLevelDone = 0;
    const failures = [];

    // run()'s result stream never ENDS in the extension host: isolation:'none'
    // keeps the run open until the event loop drains, but the language client and
    // its forked server hold handles open for the whole session. So we don't wait
    // for the stream to end — we stop once every top-level suite (one per file)
    // has reported test:complete, then break to abandon the hanging stream. Each
    // *.e2e.test.js file registers exactly one top-level describe(), so the
    // number of nesting-0 completions equals files.length.
    for await (const { type, data } of run({ files, isolation: 'none', timeout: 30_000 })) {
        if (type === 'test:pass' && data.nesting >= 1) {
            passing++;
            console.log(`  ✔ ${data.name}`);
        } else if (type === 'test:fail' && data.details?.type !== 'suite') {
            const err = data.details?.error;
            failures.push(data.name);
            console.error(`  ✖ ${data.name}\n      ${err?.message ?? err}`);
        }
        if (type === 'test:complete' && data.nesting === 0 && ++topLevelDone >= files.length) {
            break;
        }
    }

    console.log(`\n  ${passing} passing, ${failures.length} failing`);
    if (failures.length) {
        throw new Error(`${failures.length} e2e test(s) failed: ${failures.join(', ')}`);
    }
}

module.exports = { run: runTests };

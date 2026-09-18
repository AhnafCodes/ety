// @vscode/test-electron entry point: downloads VS Code, loads the extension
// in development mode, opens fixtures/workspace, and runs the node:test suite.
const path = require('node:path');
const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron');

// Pinned, not "stable": VS Code 1.138.0 renamed its macOS Electron binary
// (Contents/MacOS/Electron -> Contents/MacOS/Code), which @vscode/test-electron
// (even at 3.0.0, the current major) does not yet resolve — runTests spawns the
// old path and gets ENOENT. Following "stable" means the suite breaks the
// moment VS Code ships a release the installed test-electron doesn't know
// about, with no warning. 1.125.1 is confirmed working end-to-end (all 6 e2e
// tests) against this test-electron version; bump deliberately and re-verify
// e2e locally before moving it, rather than drifting automatically. Must
// satisfy package.json's engines.vscode range (^1.120.0).
const VSCODE_VERSION = '1.125.1';

// The VS Code download (~256 MB) is the flakiest part of CI: a transient
// ECONNRESET mid-stream escapes the library's own retry as an uncaught
// exception and kills the process. Pre-download it under our OWN retry loop
// with backoff, then hand the cached executable to runTests so it never
// downloads a second time. A warmed `.vscode-test` cache short-circuits this.
async function downloadWithRetry(attempts = 5) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await downloadAndUnzipVSCode(VSCODE_VERSION);
        } catch (err) {
            if (attempt >= attempts) throw err;
            const waitMs = 5000 * attempt; // linear backoff: 5s, 10s, 15s, 20s
            console.warn(
                `VS Code download failed (attempt ${attempt}/${attempts}): ` +
                `${err?.message ?? err}. Retrying in ${waitMs / 1000}s…`
            );
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }
    }
}

async function main() {
    try {
        const vscodeExecutablePath = await downloadWithRetry();
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath: path.resolve(__dirname, '..'),
            extensionTestsPath: path.resolve(__dirname, 'suite', 'index.js'),
            launchArgs: [
                path.resolve(__dirname, '..', '..', 'fixtures', 'workspace'),
                '--disable-extensions',
            ],
        });
    } catch (err) {
        console.error('e2e tests failed:', err);
        process.exit(1);
    }
}

main();

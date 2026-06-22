// @vscode/test-electron entry point: downloads VS Code, loads the extension
// in development mode, opens fixtures/workspace, and runs the mocha suite.
const path = require('node:path');
const { runTests, downloadAndUnzipVSCode } = require('@vscode/test-electron');

// The VS Code download (~256 MB) is the flakiest part of CI: a transient
// ECONNRESET mid-stream escapes the library's own retry as an uncaught
// exception and kills the process. Pre-download it under our OWN retry loop
// with backoff, then hand the cached executable to runTests so it never
// downloads a second time. A warmed `.vscode-test` cache short-circuits this.
async function downloadWithRetry(attempts = 5) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await downloadAndUnzipVSCode();
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

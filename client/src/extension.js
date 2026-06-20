// The extension has exactly one job: launch the server and wire the protocol.
// No type logic lives here (spec Phase 4). CommonJS because the VS Code
// extension host loads CJS entry points.
//
// Deviation from the spec's Phase 4 snippet, on purpose: inside the extension
// host `process.execPath` is the VS Code/Electron binary, not node, so the
// spec's `command: process.execPath` form would not spawn a node server. We
// use lsp-sample's `module` form instead — the client forks the module with
// node and IPC transport.
const vscode = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');
const { resolveServerModule } = require('./resolveServerModule');

let client;

// Milestone 13: the host extensions whose `<script>` blocks ety analyzes. Read
// the `ety.scriptHosts` setting (default ['html']) and match those files by a
// glob `pattern` — language ids like .tpl/.ftl aren't known to VS Code, so a
// language-based selector wouldn't catch them. Single-extension sets skip the
// `{…}` brace form (minimatch treats a comma-less brace literally).
function hostSelectors() {
    const hosts = vscode.workspace.getConfiguration('ety').get('scriptHosts', ['html']);
    const exts = [...new Set(hosts.map(h => String(h).toLowerCase().replace(/^\./, '').trim()).filter(Boolean))];
    if (exts.length === 0) return { exts, selectors: [] };
    const glob = exts.length === 1 ? exts[0] : `{${exts.join(',')}}`;
    return { exts, selectors: [{ scheme: 'file', pattern: `**/*.${glob}` }] };
}

function activate() {
    // Prefer the server bundled in the .vsix; fall back to the monorepo for F5.
    const serverModule = resolveServerModule(__dirname);
    const { exts, selectors: hostDocs } = hostSelectors();

    client = new LanguageClient(
        'ety',
        'ety Language Server',
        {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc },
        },
        {
            documentSelector: [
                { scheme: 'file', language: 'javascript' },
                { scheme: 'file', language: 'javascriptreact' }, // .jsx — {} generics exist to avoid JSX conflicts
                // Unsaved buffers (Cmd+N then "JavaScript") have the `untitled`
                // scheme, not `file`. Match them too so a fresh scratch buffer
                // squiggles without forcing a save first; the server keys them
                // by a synthetic .jsx path (see uriToPath).
                { scheme: 'untitled', language: 'javascript' },
                { scheme: 'untitled', language: 'javascriptreact' },
                // Host documents (.html + configured templates): // T: inside
                // their <script> blocks. The server keys these by a synthetic
                // .jsx path too and feeds TS a line/column-parallel projection.
                ...hostDocs,
            ],
            // Hand the same setting to the server so client selector and server
            // projection agree on which extensions are hosts.
            initializationOptions: { scriptHosts: exts },
        }
    );
    client.start();
}

function deactivate() {
    return client?.stop();
}

module.exports = { activate, deactivate };

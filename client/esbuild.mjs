// Bundles the extension for packaging (Milestone 8). Two outputs land in dist/:
//
//   dist/extension.js  — the VS Code extension-host entry (bundles
//                         vscode-languageclient; `vscode` itself is external,
//                         the host injects it).
//   dist/server.js     — the language server, forked as a child node process
//                         over IPC (bundles typescript, vscode-languageserver,
//                         and the server's own modules into one file).
//
// The napi parser addon can't be bundled, so we copy the loader + its
// platform .node binaries into dist/ety-parser/, where server/src/parser.js
// finds them at runtime.
import { build } from 'esbuild';
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url)); // client/
const repoRoot = path.resolve(root, '..'); // monorepo root
const outdir = path.join(root, 'dist');
const cratesDir = path.join(repoRoot, 'crates', 'ety-parser');

const shared = {
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18', // VS Code 1.90 ships Node 18
    external: ['vscode'], // provided by the extension host, never bundled
    logLevel: 'info',
    // ESM source uses `import.meta.url` (parser.js, to locate the napi loader),
    // which is empty under CJS output. Point it at the bundle's own file so
    // createRequire / path resolution work at runtime.
    banner: {
        js: "const import_meta_url = require('url').pathToFileURL(__filename).href;",
    },
    define: { 'import.meta.url': 'import_meta_url' },
};

await build({
    ...shared,
    entryPoints: [path.join(root, 'src', 'extension.js')],
    outfile: path.join(outdir, 'extension.js'),
});

await build({
    ...shared,
    entryPoints: [path.join(repoRoot, 'server', 'src', 'main.js')],
    outfile: path.join(outdir, 'server.js'),
});

// Ship the napi loader + platform binaries beside the server bundle so
// parser.js's `./ety-parser/index.js` candidate resolves inside the .vsix.
const destNative = path.join(outdir, 'ety-parser');
await mkdir(destNative, { recursive: true });
const binaries = [];
for (const f of await readdir(cratesDir)) {
    if (f === 'index.js' || f === 'index.d.ts' || f.endsWith('.node')) {
        await cp(path.join(cratesDir, f), path.join(destNative, f));
        if (f.endsWith('.node')) binaries.push(f);
    }
}

console.log(
    `Bundled extension + server. Native binaries shipped: ${
        binaries.length ? binaries.join(', ') : 'NONE — the parser will fail to load!'
    }`
);

// Real napi-rs addon (Milestone 1) — replaced the Milestone-0 contract stub
// behind the same contract tests; a green suite means the swap is invisible.
//
// Contract: parse_ety(source) -> EtyAnnotation[] with napi-rs camelCased
// fields (nodeStartOffset, etyStartOffset, etyEndOffset, kind, name, ety).
// Build the addon with `npm run build:parser` (napi build, release).
//
// The napi loader (.node binary picker) can't be bundled, so the server bundle
// externalizes it and finds it at runtime. Probe both layouts — same discipline
// as resolveServerModule on the client side:
//   - bundled .vsix: copied beside the server bundle (dist/ety-parser/)
//   - dev / unbundled: the crates/ workspace, two levels up from server/src/
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));

const candidates = [
    join(here, 'ety-parser', 'index.js'),
    join(here, '..', '..', 'crates', 'ety-parser', 'index.js'),
];
const loader = candidates.find(existsSync);
if (!loader) {
    throw new Error(
        `ety: native parser not found (looked in: ${candidates.join('; ')})`
    );
}

// Variable specifier: esbuild leaves this as a runtime require rather than
// trying to bundle the platform-specific .node binary.
const { parse_ety } = require(loader);

export { parse_ety };

// Locate the server entry point across the two layouts the extension ships in.
// Pure (existence predicate injectable) so it is unit-tested without packaging a
// real .vsix — see test/unit/resolveServerModule.test.js. CommonJS to match the
// extension host's module loader.
const fs = require('node:fs');
const path = require('node:path');

/**
 * @param {string} fromDir  the directory of extension.js (`__dirname`)
 * @param {{ exists?: (p: string) => boolean }} [opts]
 * @returns {string} absolute-ish path to server/src/main.js
 */
function resolveServerModule(fromDir, { exists = fs.existsSync } = {}) {
    // Production .vsix: server/ is bundled at the extension root, one level up
    // from src/ — this branch must win so an installed extension never reaches
    // for a monorepo that isn't there.
    const bundled = path.join(fromDir, '..', 'server', 'src', 'main.js');
    if (exists(bundled)) return bundled;

    // Dev / F5: the sibling server/ workspace, two levels up from src/.
    const dev = path.join(fromDir, '..', '..', 'server', 'src', 'main.js');
    if (exists(dev)) return dev;

    throw new Error(
        `ety: could not locate server/src/main.js (looked in: ${bundled}; ${dev})`
    );
}

module.exports = { resolveServerModule };

// Milestone 8 (packaging) red-first anchor. The extension must find the server
// in TWO layouts: bundled beside the extension (production .vsix) and the
// monorepo sibling (dev / F5). Extracting the lookup into a pure function lets
// us prove both without packaging an actual .vsix. Mirrors the JetBrains
// EtyLspServerDescriptor.serverEntryPoint fallback ladder — same discipline,
// both clients.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveServerModule } from '../../src/resolveServerModule.js';

const SRC = '/ext/src'; // stands in for __dirname of extension.js
// Packaged: server/ at the extension root, one level up from src/.
const BUNDLED = path.join(SRC, '..', 'server', 'src', 'main.js');
// Dev: the sibling server/ workspace, two levels up from src/.
const DEV = path.join(SRC, '..', '..', 'server', 'src', 'main.js');

// Inject a deterministic existence predicate so the test never touches disk.
const existsOnly = (...present) => p => present.includes(p);

describe('resolveServerModule', () => {
    it('prefers the bundled server beside the extension (production install)', () => {
        expect(resolveServerModule(SRC, { exists: existsOnly(BUNDLED) })).toBe(BUNDLED);
    });

    it('falls back to the monorepo server for dev / F5', () => {
        expect(resolveServerModule(SRC, { exists: existsOnly(DEV) })).toBe(DEV);
    });

    it('prefers bundled when both exist (production must not pick the dev tree)', () => {
        expect(resolveServerModule(SRC, { exists: existsOnly(BUNDLED, DEV) })).toBe(BUNDLED);
    });

    it('throws a clear error naming both locations when neither exists', () => {
        expect(() => resolveServerModule(SRC, { exists: existsOnly() }))
            .toThrow(/could not locate server[/\\]src[/\\]main\.js/);
    });
});

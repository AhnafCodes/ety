// Milestone 15 / Gate 13 — transform-on-read for closed, imported files.
// Pure, dependency-injected (no imports of parser.js/transform.js/tsHost.js
// here — the caller injects them), same discipline as transform.js, so this
// is unit-testable without touching real state or the filesystem.
//
// The trigger is proactive, not reactive to a TS diagnostic (recorded design
// decision, implementation-plan.md M15): an open file's own `// T: import`
// annotations are the complete, unambiguous set of "types this file needs
// from elsewhere" — ety's parser already extracts them before this module
// exists. Walking THAT list, resolving each specifier the way TypeScript
// itself would, and transforming any closed target that carries `// T:`
// content is the whole mechanism. It never touches a file nothing open
// imports, and never touches a file with zero annotations (raw disk fallback
// is already correct for those — transforming would be pure overhead).

// Extract the quoted module specifier from an import annotation's `ety` text
// (e.g. "import { User, Role } from './types'" -> "./types"). Returns null
// for malformed import text (should not happen — the parser only emits this
// shape — but a null here degrades to "nothing to resolve", never a throw).
export function parseImportSpecifier(ety) {
    const match = /from\s+['"]([^'"]+)['"]/.exec(ety);
    return match ? match[1] : null;
}

// Walk `importAnnotations` (the kind === 'import' subset of one file's
// parsed annotations), resolving and, where warranted, transforming each
// closed target — recursively, since a transformed target's OWN `// T:
// import` lines are walked the same way. Returns a flat Map<path,
// virtualSource> of every NEW entry discovered by this call; the caller
// merges it into its own shadow-doc store (this function never mutates
// anything it's handed).
//
//   containingFile    — absolute path of the file whose imports are walked
//   importAnnotations — that file's kind === 'import' EtyAnnotations
//   isKnown(path)     — true if `path` is already open or already a FRESH
//                       shadow entry at the call site (backed by the
//                       caller's virtualDocs/shadowDocs; injected so this
//                       function stays pure)
//   readFile(path)    — returns the file's source, or undefined (I/O error)
//   parseEty(source)  — the real parser (parse_ety), or a test double
//   transformDocument(source, annotations) — the real transformer, or a test double
//   resolveModuleName(specifier, containingFile) — the real resolver
//                       (tsHost.js), or a test double
//   visited           — Set<path> already visited in THIS collection pass —
//                       the cycle guard. Seeded with `containingFile` by
//                       default; recursive calls pass the SAME (mutated)
//                       Set down, so a diamond import (two files sharing one
//                       closed dependency) transforms it only once, and a
//                       circular import terminates instead of recursing
//                       forever.
export function collectShadowDocs({
    containingFile,
    importAnnotations,
    isKnown,
    readFile,
    parseEty,
    transformDocument,
    resolveModuleName,
    visited = new Set([containingFile]),
}) {
    const result = new Map();

    for (const annotation of importAnnotations) {
        const specifier = parseImportSpecifier(annotation.ety);
        if (!specifier) continue;

        const resolved = resolveModuleName(specifier, containingFile);
        if (!resolved) continue; // TS itself can't resolve it either — nothing to shadow
        if (visited.has(resolved)) continue; // cycle guard / diamond dedupe
        visited.add(resolved);
        if (isKnown(resolved)) continue; // already open, or already a fresh shadow

        const source = readFile(resolved);
        if (source === undefined) continue; // resolved but unreadable (race, permissions)

        const annotations = parseEty(source);
        if (annotations.length === 0) continue; // nothing to shadow; raw fallback is already correct

        const { virtualSource } = transformDocument(source, annotations);
        result.set(resolved, virtualSource);

        const nestedImports = annotations.filter(a => a.kind === 'import');
        if (nestedImports.length > 0) {
            const nested = collectShadowDocs({
                containingFile: resolved,
                importAnnotations: nestedImports,
                isKnown,
                readFile,
                parseEty,
                transformDocument,
                resolveModuleName,
                visited,
            });
            for (const [path, vs] of nested) result.set(path, vs);
        }
    }

    return result;
}

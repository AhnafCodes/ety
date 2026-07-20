// Phase 3: TypeScript Language Service host (ety-lsp-spec.md).
// TypeScript never sees the real file — it reads exclusively from virtualDocs
// via getScriptSnapshot. Factory form rather than the spec's module-level
// singletons so the Gate 3a tests and main.js inject their own maps.
import ts from 'typescript';
import { DiagnosticSeverity } from 'vscode-languageserver';

// TS diagnostics carry a category; map it to the corresponding LSP severity
// rather than forcing everything to Error (spec, Phase 3 Diagnostics).
export function tsCategoryToSeverity(category) {
    switch (category) {
        case ts.DiagnosticCategory.Error:      return DiagnosticSeverity.Error;
        case ts.DiagnosticCategory.Warning:    return DiagnosticSeverity.Warning;
        case ts.DiagnosticCategory.Suggestion: return DiagnosticSeverity.Hint;
        case ts.DiagnosticCategory.Message:    return DiagnosticSeverity.Information;
        default:                               return DiagnosticSeverity.Error;
    }
}

// workspaceRoot: the user's project root (from the LSP initialize params in
// Milestone 4). process.cwd() is only a fallback — in the editor it is
// wherever the extension host spawned the server, and TS walks up from
// getCurrentDirectory to find node_modules/@types.
export function createTsService({
    virtualDocs,
    versions,
    // Closed files read through the disk fallback below get a version too:
    // watcher events (workspace/didChangeWatchedFiles) bump an epoch per
    // path in diskVersions, which is the only way TS ever re-reads a file
    // that is not open in the editor (e.g. a regenerated .types.js).
    diskVersions = new Map(),
    // Returns true while a watched create/delete is pending: a new file can
    // satisfy a previously FAILED import, which no version bump can invalidate
    // (the file was never in the program). TS consults this per source file
    // during program-up-to-date checks and re-runs module resolution.
    hasInvalidatedResolutions,
    workspaceRoot = process.cwd(),
}) {
    const serviceHost = {
        getScriptFileNames: () => [...virtualDocs.keys()],
        getScriptVersion: f => `${versions.get(f) ?? 0}.${diskVersions.get(f) ?? 0}`,
        getScriptSnapshot: f => {
            const virtual = virtualDocs.get(f);
            if (virtual !== undefined) return ts.ScriptSnapshot.fromString(virtual);
            // Disk fallback — NOT just for unopened imports (the documented
            // v1 limitation): the language service loads EVERY program file
            // through getScriptSnapshot, including lib.es2022.d.ts itself.
            // Returning undefined here silently drops the standard lib.
            // No try/catch needed: ts.sys.readFile catches internally and
            // returns undefined on ANY I/O error, permissions included.
            const disk = ts.sys.readFile(f);
            return disk !== undefined ? ts.ScriptSnapshot.fromString(disk) : undefined;
        },
        getCompilationSettings: () => ({
            allowJs: true,
            checkJs: true,
            // strict is off by default so untyped JS isn't flooded with
            // noImplicitAny/strictNullChecks errors on code the user hasn't
            // annotated yet.
            strict: false,
            target: ts.ScriptTarget.ES2022,
            lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            // TS 6.0 breaking change: global node_modules/@types packages are
            // no longer included automatically — wildcard inclusion must be
            // opted into. Without this, @types/node etc. silently vanish.
            types: ['*'],
            // documentSelector includes javascriptreact; Preserve = type-check
            // JSX without transforming it.
            jsx: ts.JsxEmit.Preserve,
        }),
        getCurrentDirectory: () => workspaceRoot,
        getDefaultLibFileName: ts.getDefaultLibFilePath,
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        // Without these two, TS cannot ENUMERATE node_modules/@types — global
        // type packages silently stop resolving (fileExists alone only
        // answers point queries during module resolution).
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
    };
    if (hasInvalidatedResolutions) serviceHost.hasInvalidatedResolutions = hasInvalidatedResolutions;
    return ts.createLanguageService(serviceHost);
}

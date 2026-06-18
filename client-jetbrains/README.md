# ety — JetBrains client

A native IntelliJ Platform plugin that brings ety's `// T:` diagnostics and
hovers to JetBrains IDEs. It drives the **same** language server as the VS Code
client (`server/`), over LSP **stdio** — it contains no type logic of its own.

> Requires IntelliJ IDEA **2025.3+**. Since the 2025.3 unified distribution, the
> LSP API ships in the single binary every user installs (paid *and* free tier),
> so no third-party LSP bridge is needed.

## Layout

```
client-jetbrains/
├── build.gradle.kts        # IntelliJ Platform Gradle Plugin 2.x; bundles server/
├── settings.gradle.kts
├── gradle.properties
├── src/main/
│   ├── kotlin/dev/ety/
│   │   ├── EtyLspServerSupportProvider.kt   # entry point; starts the server for .js/.jsx
│   │   └── EtyLspServerDescriptor.kt         # spawns `node server/src/main.js --stdio`
│   └── resources/META-INF/plugin.xml         # depends: platform + lsp + ultimate
└── src/test/kotlin/dev/ety/
    └── EtyLspServerDescriptorTest.kt          # smoke test: file claim + launch command
```

This module is **outside** the npm workspace — it's a JVM/Gradle build and does
not run under `npm test`. The cross-editor contract it relies on (the server
booting over stdio) is guarded by `server/test/stdio-boot.test.js`, which *does*
run in `npm test`.


## Develop

Requires a JDK 21 and Node on PATH (or set `ETY_NODE=/path/to/node`).

```bash
cd client-jetbrains
./gradlew test        # descriptor smoke test (downloads the IntelliJ test fixtures)
./gradlew runIde      # launches a dev IDE with the plugin loaded
./gradlew buildPlugin # produces the installable plugin zip (bundles server + parser; see Packaging)
```

`./gradlew test` runs `EtyLspServerDescriptorTest` — it asserts the descriptor
claims `.js`/`.jsx` and launches `node <main.js> --stdio`. It does not spawn the
server (so Node need not be installed) and does not need a GUI. The first run
downloads the IntelliJ platform + test framework, so it can't run in a bare CI
container without that toolchain.

In the dev IDE, open a `.js`/`.jsx` file with a `// T:` annotation: a deliberate
type error squiggles the correct original line, and hovering an annotated symbol
shows its resolved type.

## Packaging — what `buildPlugin` bundles

The plugin contains no type logic; it spawns `node server/src/main.js --stdio`.
So `buildPlugin` must ship everything that Node process needs, because the
packaged plugin is detached from the monorepo's `node_modules`/`crates` tree that
`runIde` resolves against. Two Gradle tasks (`build.gradle.kts`) assemble it:

- **`bundleServer`** copies `server/src` plus the server's *production* dependency
  closure (`typescript` + the `vscode-languageserver*` libs) into
  `server/node_modules`. These deps are **hoisted to the monorepo-root
  `node_modules`** by npm workspaces, so they're copied from there — not from the
  near-empty `server/node_modules`. Keep the list in sync with
  `npm ls --workspace server --omit=dev --all`.
- **`bundleParser`** copies the native napi parser (`crates/ety-parser` loader +
  its prebuilt `*.node` binaries) in as a **sibling of `server/`**, because
  `server/src/parser.js` loads it by the relative path `../../crates/ety-parser`.

Both have build-time tripwires that **fail the build** (not the user's IDE) if a
dependency or the native binary is missing — e.g. you forgot `npm install` or
`npm run build:parser`.

### Cross-platform native binaries (the `.node` matrix)

The parser is a **napi-rs native addon**, so its `.node` file is specific to one
`{platform, arch}` (and libc on Linux). The napi loader (`crates/ety-parser/index.js`)
selects `ety-parser.<platform>-<arch>[-libc].node` at runtime by `process.platform`
/ `process.arch`. **`bundleParser` only ships the `.node` files that exist on the
build machine at package time** — it globs `*.node`, it does not cross-compile.

> ⚠️ A plugin built on, say, macOS x64 runs **only** on macOS x64. On any other
> host the loader finds no matching binary and the server throws
> *"Failed to load native binding"* at startup. The tripwire only guarantees *at
> least one* binary is present — it does **not** verify the set is complete.

To publish a plugin that runs on every user's machine, build each target's binary
into `crates/ety-parser/` **before** `buildPlugin` (typically a CI matrix), so all
the needed `*.node` files are present and get bundled together. The targets the
loader knows about:

| Platform | Arch | Binary file |
|----------|------|-------------|
| macOS    | x64 / arm64 (or universal) | `ety-parser.darwin-x64.node` / `ety-parser.darwin-arm64.node` (`ety-parser.darwin-universal.node`) |
| Linux (glibc) | x64 / arm64 | `ety-parser.linux-x64-gnu.node` / `ety-parser.linux-arm64-gnu.node` |
| Linux (musl)  | x64 / arm64 | `ety-parser.linux-x64-musl.node` / `ety-parser.linux-arm64-musl.node` |
| Windows  | x64 / arm64 | `ety-parser.win32-x64-msvc.node` / `ety-parser.win32-arm64-msvc.node` |

(The loader also branches on other Linux arches — arm, riscv64, s390x — and
FreeBSD/Android; build those only if you intend to support them.) Each binary is
produced by running `npm run build:parser` on that target. Pick the rows your
release supports; a desktop IDE plugin typically needs the macOS, Linux-gnu, and
Windows x64/arm64 cells.

## Status

Scaffold (Milestone 7 / Gate 5). Done: the `--stdio` boot contract (green in
`npm test`), the `uriToPath` row for JetBrains scratch URIs (green), and the
descriptor smoke test (authored; run via `./gradlew test` on a machine with the
toolchain). Remaining to close Gate 5: the manual visual check in a real unified
IntelliJ IDEA 2025.3 window — see [`GATE-5-CHECKLIST.md`](./GATE-5-CHECKLIST.md)
for the turnkey steps (launch, fixtures, expected squiggles/hovers).

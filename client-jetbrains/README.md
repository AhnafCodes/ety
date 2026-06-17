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
./gradlew buildPlugin # produces the installable plugin zip (bundles server/)
```

`./gradlew test` runs `EtyLspServerDescriptorTest` — it asserts the descriptor
claims `.js`/`.jsx` and launches `node <main.js> --stdio`. It does not spawn the
server (so Node need not be installed) and does not need a GUI. The first run
downloads the IntelliJ platform + test framework, so it can't run in a bare CI
container without that toolchain.

In the dev IDE, open a `.js`/`.jsx` file with a `// T:` annotation: a deliberate
type error squiggles the correct original line, and hovering an annotated symbol
shows its resolved type.

## Status

Scaffold (Milestone 7 / Gate 5). Done: the `--stdio` boot contract (green in
`npm test`), the `uriToPath` row for JetBrains scratch URIs (green), and the
descriptor smoke test (authored; run via `./gradlew test` on a machine with the
toolchain). Remaining to close Gate 5: the manual visual check in a real unified
IntelliJ IDEA 2025.3 window — see [`GATE-5-CHECKLIST.md`](./GATE-5-CHECKLIST.md)
for the turnkey steps (launch, fixtures, expected squiggles/hovers).

// ety JetBrains client — a native IntelliJ Platform plugin that drives the SAME
// server binary as the VS Code client, over stdio (see server/test/stdio-boot
// .test.js). No type logic lives here, exactly as client/ carries none; this
// module is plumbing only (implementation-plan.md, Milestone 7 / Gate 5).
//
// This module is intentionally OUTSIDE the npm workspace — it is a JVM/Gradle
// build, not Node. `cd client-jetbrains && ./gradlew runIde` launches a dev IDE
// with the plugin loaded; it does not participate in `npm test`.
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.intellij.platform.gradle.tasks.PrepareSandboxTask
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.4.0"
    // IntelliJ Platform Gradle Plugin 2.x.
    id("org.jetbrains.intellij.platform") version "2.16.0"
}

group = "dev.ety"
version = "0.0.1"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // The LSP API ships in the commercial binary, so we COMPILE against
        // IntelliJ IDEA Ultimate 2025.3. As of the 2025.3 unified distribution
        // that same binary is what free-tier users install, and the LSP API is
        // enabled for them too — so depending on Ultimate here no longer
        // restricts who can run the plugin (implementation-plan.md, M7 context).
        intellijIdeaUltimate("2025.3")

        // Platform test fixtures for the descriptor smoke test (BasePlatformTestCase).
        testFramework(TestFrameworkType.Platform)
    }

    // BasePlatformTestCase is JUnit 3/4 based.
    testImplementation("junit:junit:4.13.2")
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            // 2025.3 = the unified release that opened the LSP API to all tiers.
            sinceBuild = "253"
        }
    }
}

kotlin {
    // Build runs on JDK 25 (the installed JDK), but the plugin must load inside
    // IDEA 2025.3, which runs on JBR 21 — a Java 21 runtime cannot load Java 25
    // bytecode. So compile ON 25 yet TARGET 21. The IJ plugin's config verifier
    // also expects a 21 target for the 2025.3 platform.
    jvmToolchain(25)
}

// Pin the bytecode target to 21 at the task level. Setting it on the `kotlin {}`
// extension does not win over the toolchain's own 25 default, so the Kotlin and
// Java compile tasks must be told directly — otherwise Gradle rejects the build
// for inconsistent JVM targets (compileKotlin=25 vs compileJava=21).
tasks.withType<KotlinCompile>().configureEach {
    compilerOptions.jvmTarget = JvmTarget.JVM_21
}
tasks.withType<JavaCompile>().configureEach {
    options.release = 21
}

// ── Server bundling ──────────────────────────────────────────────────────────
// The plugin spawns `node <server>/src/main.js --stdio`, so the server/ tree —
// AND its production dependency closure (typescript@6.0.3 + the LSP libs) — must
// travel inside the plugin distribution. The relative ../../server path the VS
// Code client uses does not survive plugin packaging, and the deps cannot just
// be copied from server/node_modules: `server` is an npm WORKSPACE, so npm
// hoists its runtime deps up to the monorepo-root node_modules and leaves
// server/node_modules effectively empty. In dev (runIde) Node still resolves
// them by walking up to that root tree, but a packaged plugin is detached from
// it — hence the explicit copy of the hoisted closure below. Without it, an
// installed plugin starts `node main.js` and dies with "Cannot find module
// 'typescript'", no server, no diagnostics.
//
// Keep this list in sync with `npm ls --workspace server --omit=dev --all`. It
// is pinned by the repo lockfile, so the bundle ships exactly what `npm test`
// validated. The doLast tripwire fails the BUILD (not the user's IDE) if any
// entry is missing — e.g. deps not installed, or a new transitive dep appeared.
val serverRuntimeDeps = listOf(
    "typescript",
    "vscode-languageserver",
    "vscode-languageserver-protocol",
    "vscode-languageserver-types",
    "vscode-jsonrpc",
    "vscode-languageserver-textdocument",
)
val rootNodeModules = rootProject.projectDir.resolve("../node_modules")
val serverOutDir = layout.buildDirectory.dir("server")

val bundleServer = tasks.register<Copy>("bundleServer") {
    // Server source. node_modules is deliberately NOT globbed from server/ —
    // it's an empty hoisted-away husk; the real deps come from the root copy.
    from(rootProject.projectDir.resolve("../server")) {
        include("src/**", "package.json")
    }
    // The hoisted production closure → server/node_modules/<pkg>, the layout
    // Node expects beside main.js once the plugin is detached from the monorepo.
    serverRuntimeDeps.forEach { dep ->
        from(rootNodeModules.resolve(dep)) {
            into("node_modules/$dep")
        }
    }
    into(serverOutDir)

    // Captured as locals so the execution-time doLast closes over serializable
    // values, not script-object references (required by the configuration cache).
    val deps = serverRuntimeDeps
    val outDir = serverOutDir
    doLast {
        val nodeModules = outDir.get().asFile.resolve("node_modules")
        deps.forEach { dep ->
            val manifest = nodeModules.resolve("$dep/package.json")
            check(manifest.isFile) {
                "bundleServer: '$dep' is missing from the bundled server " +
                    "($manifest). Run `npm install` at the repo root and re-check " +
                    "the closure with `npm ls --workspace server --omit=dev --all`."
            }
        }
    }
}

// The server also loads the native napi parser by the RELATIVE path
// `../../crates/ety-parser/index.js` (server/src/parser.js). Resolved from the
// packaged server that is `<plugin>/server/src/`, so the parser must sit at
// `<plugin>/crates/ety-parser/` — a sibling of server/ — for the path to hold;
// like the node deps above, it lives outside the server tree and would not
// otherwise travel with the plugin. We ship the napi loader + its prebuilt
// `.node` binaries (Cargo sources, target/, and node_modules are not runtime
// inputs and are excluded). The `.node` files are platform-specific: only the
// architectures whose binaries have been built (via `npm run build:parser` on
// each target) end up in the zip — a cross-platform release needs that build
// matrix. The tripwire fails the build if NONE is present, so an unbuilt parser
// can't silently ship a plugin that throws "Failed to load native binding".
val parserOutDir = layout.buildDirectory.dir("crates/ety-parser")
val bundleParser = tasks.register<Copy>("bundleParser") {
    from(rootProject.projectDir.resolve("../crates/ety-parser")) {
        include("index.js", "package.json", "*.node")
    }
    into(parserOutDir)

    val outDir = parserOutDir
    doLast {
        val natives = outDir.get().asFile.listFiles { f -> f.extension == "node" }.orEmpty()
        check(natives.isNotEmpty()) {
            "bundleParser: no native parser binary (*.node) was bundled from " +
                "crates/ety-parser. Run `npm run build:parser` (per target platform) " +
                "before packaging — without it the server throws \"Failed to load " +
                "native binding\" at startup."
        }
    }
}

// Place the bundled server + parser INSIDE the plugin directory in the
// sandbox/zip, at `<pluginName>/server/...` and `<pluginName>/crates/ety-parser/`.
// EtyLspServerDescriptor resolves the entry point via
// PathManager.getPluginsPath()/ety-jetbrains/server/src/main.js, so the layout
// here must land at exactly that path (pluginName == "ety-jetbrains"); the
// parser's sibling location then satisfies the server's ../../crates path. Wiring
// the bundle tasks' output through `from` also establishes the task dependency,
// so the copies are no longer orphaned the way a bare dependsOn left them.
tasks.named<PrepareSandboxTask>("prepareSandbox") {
    from(bundleServer) {
        into(pluginName.map { "$it/server" })
    }
    from(bundleParser) {
        into(pluginName.map { "$it/crates/ety-parser" })
    }
}

// buildSearchableOptions launches a headless IDE to pre-index this plugin's
// settings for the IDE's search box. It is optional (the index is rebuilt at
// runtime if absent) and the headless JBR aborts with SIGABRT on x86_64 macOS,
// so disable it — the packaged plugin is unaffected. The two downstream tasks
// that jar up its output must be disabled too; otherwise prepareJarSearchable
// Options fails on a clean build looking for the directory the disabled task
// never produced.
listOf(
    "buildSearchableOptions",
    "prepareJarSearchableOptions",
    "jarSearchableOptions",
).forEach { name ->
    tasks.named(name) { enabled = false }
}

// The descriptor smoke test resolves the server entry point via the repo-
// relative ../server path (the dev fallback), so pin the JVM working directory
// to this module so that lookup is deterministic regardless of how Gradle is
// invoked. `node` need not be installed to run the test — createCommandLine only
// resolves a path/name, it does not spawn the process.
tasks.test {
    workingDir = projectDir
}

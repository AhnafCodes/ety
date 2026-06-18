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
// The plugin spawns `node <server>/src/main.js --stdio`, so the server/ tree
// (incl. node_modules and the pinned typescript@6.0.3) must travel inside the
// plugin distribution — the relative ../../server path the VS Code client uses
// does not survive plugin packaging. This copies it into the plugin sandbox/zip
// under `server/`; EtyLspServerDescriptor resolves that location at runtime,
// falling back to the repo-relative path for `runIde` during development.
val bundleServer = tasks.register<Copy>("bundleServer") {
    from(rootProject.projectDir.resolve("../server")) {
        include("src/**", "node_modules/**", "package.json")
    }
    into(layout.buildDirectory.dir("server"))
}

// Place the bundled server INSIDE the plugin directory in the sandbox/zip, at
// `<pluginName>/server/...`. EtyLspServerDescriptor resolves the entry point via
// PathManager.getPluginsPath()/ety-jetbrains/server/src/main.js, so the layout
// here must land at exactly that path (pluginName == "ety-jetbrains"). Wiring
// bundleServer's output through `from` also establishes the task dependency, so
// the copy is no longer orphaned the way a bare dependsOn left it.
tasks.named<PrepareSandboxTask>("prepareSandbox") {
    from(bundleServer) {
        into(pluginName.map { "$it/server" })
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

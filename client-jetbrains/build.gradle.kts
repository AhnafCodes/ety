// ety JetBrains client — a native IntelliJ Platform plugin that drives the SAME
// server binary as the VS Code client, over stdio (see server/test/stdio-boot
// .test.js). No type logic lives here, exactly as client/ carries none; this
// module is plumbing only (implementation-plan.md, Milestone 7 / Gate 5).
//
// This module is intentionally OUTSIDE the npm workspace — it is a JVM/Gradle
// build, not Node. `cd client-jetbrains && ./gradlew runIde` launches a dev IDE
// with the plugin loaded; it does not participate in `npm test`.
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.1.0"
    // IntelliJ Platform Gradle Plugin 2.x.
    id("org.jetbrains.intellij.platform") version "2.2.1"
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
    jvmToolchain(21)
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

tasks.named("prepareSandbox") {
    dependsOn(bundleServer)
}

// The descriptor smoke test resolves the server entry point via the repo-
// relative ../server path (the dev fallback), so pin the JVM working directory
// to this module so that lookup is deterministic regardless of how Gradle is
// invoked. `node` need not be installed to run the test — createCommandLine only
// resolves a path/name, it does not spawn the process.
tasks.test {
    workingDir = projectDir
}

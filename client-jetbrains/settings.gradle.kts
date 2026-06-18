// Standalone Gradle build for the ety JetBrains plugin. Kept separate from the
// npm monorepo on purpose — different toolchain (JVM/Gradle vs Node).
plugins {
    // Lets Gradle auto-provision the Java 21 toolchain the build pins
    // (kotlin { jvmToolchain(21) }) when no matching JDK is installed locally —
    // contributors only have whatever system JDK they happen to run Gradle with.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "ety-jetbrains"

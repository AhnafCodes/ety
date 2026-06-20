package dev.ety

import com.google.gson.JsonObject
import com.intellij.testFramework.LightVirtualFile
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Milestone 7 / Gate 5 — descriptor smoke test. Pins the two behaviors that
 * decide whether the JetBrains client drives the right server in the right way:
 * which files it claims, and that it launches `node <main.js> --stdio` (the
 * transport contract guarded on the Node side by server/test/stdio-boot.test.js).
 *
 * Deliberately minimal — no real server is spawned; the full integration is the
 * manual visual check in a 2025.3 IDE (Gate 5's spirit, same as Gate 3b). Needs
 * the IntelliJ platform test fixtures, so it runs under `./gradlew test`, not
 * `npm test`.
 */
class EtyLspServerDescriptorTest : BasePlatformTestCase() {

    private fun descriptor() = EtyLspServerDescriptor(project)

    fun `test claims js, jsx, and the default html host and nothing else`() {
        val d = descriptor()
        assertTrue("should claim .js", d.isSupportedFile(LightVirtualFile("a.js", "")))
        assertTrue("should claim .jsx", d.isSupportedFile(LightVirtualFile("b.jsx", "")))
        // Host document: <script> JS in .html, on by default (Milestone 13).
        assertTrue("should claim .html", d.isSupportedFile(LightVirtualFile("page.html", "")))
        assertFalse("must not claim .ts", d.isSupportedFile(LightVirtualFile("c.ts", "")))
        assertFalse("must not claim .json", d.isSupportedFile(LightVirtualFile("d.json", "")))
        // Template formats are opt-in (ETY_SCRIPT_HOSTS) — not claimed by default.
        assertFalse("must not claim .tpl by default", d.isSupportedFile(LightVirtualFile("e.tpl", "")))
        assertFalse("must not claim extensionless", d.isSupportedFile(LightVirtualFile("noext", "")))
    }

    fun `test passes scriptHosts to the server as initializationOptions`() {
        val opts = descriptor().createInitializationOptions() as JsonObject
        val hosts = opts.getAsJsonArray("scriptHosts")
        assertNotNull("initializationOptions must carry scriptHosts", hosts)
        // Default set is exactly ['html']; the server defaults to the same.
        assertEquals(1, hosts.size())
        assertEquals("html", hosts[0].asString)
    }

    fun `test launches node on the server entry point over stdio`() {
        val cmd = descriptor().createCommandLine()

        val exe = cmd.exePath
        assertTrue("expected a node executable, was '$exe'",
            exe == "node" || exe == "node.exe" || exe.endsWith("/node") || exe.endsWith("\\node.exe"))

        val params = cmd.parametersList.parameters
        assertEquals("transport flag must be the last argument", "--stdio", params.lastOrNull())
        assertTrue("expected the server main.js as a program argument, got $params",
            params.any { it.endsWith("main.js") })
    }
}

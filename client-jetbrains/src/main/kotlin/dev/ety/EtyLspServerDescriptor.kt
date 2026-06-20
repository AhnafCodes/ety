package dev.ety

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import java.io.File

/**
 * Describes how to launch and which files belong to the ety server. The server
 * is the same Node process the VS Code client spawns; here it is started over
 * **stdio** (`--stdio`), the transport pinned by server/test/stdio-boot.test.js.
 *
 * No type logic lives in this client — it only spawns the server and lets the
 * platform's LSP support do diagnostics + hover (Milestone 7 / Gate 5).
 */
class EtyLspServerDescriptor(project: Project) :
    ProjectWideLspServerDescriptor(project, "ety") {

    override fun isSupportedFile(file: VirtualFile): Boolean = isEtyFile(file)

    /**
     * Hand the host extensions to the server as `initializationOptions`
     * (Milestone 13), the same `ety.scriptHosts` list the VS Code client passes.
     * The server projects those files' `<script>` blocks to line/column-parallel
     * JS; client and server must agree on the set, so both read it from here /
     * the setting.
     */
    override fun createInitializationOptions(): Any {
        val hosts = JsonArray().apply { scriptHosts().forEach { add(it) } }
        return JsonObject().apply { add("scriptHosts", hosts) }
    }

    override fun createCommandLine(): GeneralCommandLine {
        val mainJs = serverEntryPoint()
        return GeneralCommandLine(resolveNode(), mainJs.absolutePath, "--stdio")
            // Run from server/ so the TS host's workspaceRoot fallback and any
            // relative resolution behave as they do under the VS Code client.
            .withWorkDirectory(mainJs.parentFile.parentFile)
    }

    /**
     * Locate `server/src/main.js`. In a packaged plugin the server/ tree is
     * bundled next to the plugin (see build.gradle.kts `bundleServer`); during
     * `runIde` from this module the repo-relative path is used instead, so a
     * developer can launch a dev IDE without packaging first.
     */
    private fun serverEntryPoint(): File {
        val candidates = listOf(
            // Packaged: <plugins>/ety-jetbrains/server/src/main.js
            File(PathManager.getPluginsPath(), "ety-jetbrains/server/src/main.js"),
            // Dev (runIde): client-jetbrains/build/server/src/main.js
            File("build/server/src/main.js").absoluteFile,
            // Dev fallback: the sibling server/ in the monorepo.
            File("../server/src/main.js").absoluteFile,
        )
        return candidates.firstOrNull { it.isFile }
            ?: error("ety: could not locate server/src/main.js (looked in: " +
                candidates.joinToString { it.path } + ")")
    }

    /**
     * Resolve a Node executable. The JVM host is not Node, so we cannot assume
     * it on PATH inside the IDE process. Order: explicit override → PATH → a
     * common install location. v1 keeps this simple; integrating the project's
     * configured Node interpreter (NodeJsInterpreterManager) is a follow-up.
     */
    private fun resolveNode(): String {
        System.getenv("ETY_NODE")?.takeIf { it.isNotBlank() }?.let { return it }
        val exe = if (System.getProperty("os.name").startsWith("Windows")) "node.exe" else "node"
        val onPath = System.getenv("PATH").orEmpty()
            .split(File.pathSeparator)
            .map { File(it, exe) }
            .firstOrNull { it.canExecute() }
        return onPath?.absolutePath ?: exe // fall back to bare name; spawn surfaces a clear error
    }
}

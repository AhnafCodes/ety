package dev.ety

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.LspServerSupportProvider.LspServerStarter

/**
 * Entry point registered on the `com.intellij.platform.lsp.serverSupportProvider`
 * extension point. IntelliJ calls [fileOpened] for every opened file; for a
 * JavaScript/JSX file we ask the platform to (re)use one ety server for the
 * project. Mirrors the VS Code client's documentSelector — the server is shared,
 * the editor is swappable.
 */
class EtyLspServerSupportProvider : LspServerSupportProvider {
    override fun fileOpened(project: Project, file: VirtualFile, serverStarter: LspServerStarter) {
        if (isEtyFile(file)) {
            serverStarter.ensureServerStarted(EtyLspServerDescriptor(project))
        }
    }
}

/** Single source of truth for "does ety handle this file" — used here and by the descriptor. */
internal fun isEtyFile(file: VirtualFile): Boolean {
    val ext = file.extension?.lowercase() ?: return false
    // Source files always; host documents (.html + configured templates) carry
    // their JavaScript inside <script> blocks (Milestone 13).
    return ext == "js" || ext == "jsx" || ext in scriptHosts()
}

/**
 * Host extensions whose `<script>` blocks ety analyzes (Milestone 13). Default
 * `html`; `ETY_SCRIPT_HOSTS` (comma-separated, mirroring the `ETY_NODE`
 * override) opts the server-side template formats in. A full Settings UI is a
 * documented follow-up. The list is also handed to the server via
 * `createInitializationOptions` so client and server agree on what is a host.
 */
internal fun scriptHosts(): List<String> {
    val raw = System.getenv("ETY_SCRIPT_HOSTS")
    if (raw.isNullOrBlank()) return listOf("html")
    val cleaned = raw.split(',')
        .map { it.trim().lowercase().removePrefix(".") }
        .filter { it.isNotEmpty() }
        .distinct()
    return cleaned.ifEmpty { listOf("html") }
}

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
internal fun isEtyFile(file: VirtualFile): Boolean =
    file.extension == "js" || file.extension == "jsx"

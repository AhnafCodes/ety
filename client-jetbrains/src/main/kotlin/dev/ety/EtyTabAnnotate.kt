package dev.ety

import com.intellij.codeInsight.lookup.LookupManager
import com.intellij.codeInsight.template.TemplateManager
import com.intellij.ide.DataManager
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.command.CommandProcessor
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Caret
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.actionSystem.EditorActionHandler
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.util.TextRange
import com.intellij.platform.lsp.api.LspServerManager
import com.intellij.platform.lsp.api.LspServerState
import org.eclipse.lsp4j.CodeAction
import org.eclipse.lsp4j.CodeActionContext
import org.eclipse.lsp4j.CodeActionParams
import org.eclipse.lsp4j.Position
import org.eclipse.lsp4j.Range

/**
 * Tab-to-annotate: press Tab right after the `;` of an un-annotated
 * `let`/`const`/`var` declaration (e.g. `let i = 0;`) and the inferred type
 * comment is appended (`let i = 0; // T: number`). Anywhere else Tab behaves
 * normally.
 *
 * No type logic lives here: the type comes from the server's existing
 * "Insert // T: <type>" quick fix (server/src/handlers.js: onCodeAction), so
 * the same closed set of types and the same skip rules (multi-declarator
 * lines, existing trailing comments, ...) apply. If the server offers nothing,
 * the Tab is passed through to the IDE's own handler.
 *
 * LspServer.sendRequestSync must not run on the EDT, so the request goes to a
 * pooled thread and the result is applied back on the EDT, only if the
 * document and caret have not moved in the meantime.
 */
class EtyTabAnnotateHandler(private val original: EditorActionHandler) : EditorActionHandler() {

    override fun isEnabledForCaret(editor: Editor, caret: Caret, dataContext: DataContext?): Boolean =
        original.isEnabled(editor, caret, dataContext)

    override fun doExecute(editor: Editor, caret: Caret?, dataContext: DataContext?) {
        if (!tryAnnotateAsync(editor)) original.execute(editor, caret, dataContext)
    }

    /** True when the Tab was taken over (the request is in flight). */
    private fun tryAnnotateAsync(editor: Editor): Boolean {
        if (!EtySettings.annotateOnTab()) return false
        val project = editor.project ?: return false
        if (editor.caretModel.caretCount != 1 || editor.selectionModel.hasSelection()) return false
        // Tab already means something else while a completion popup or live
        // template is active; never hijack those.
        if (LookupManager.getActiveLookup(editor) != null) return false
        if (TemplateManager.getInstance(project).getActiveTemplate(editor) != null) return false

        val document = editor.document
        val file = FileDocumentManager.getInstance().getFile(document) ?: return false
        if (!isEtyFile(file)) return false

        val offset = editor.caretModel.offset
        val line = document.getLineNumber(offset)
        val lineStart = document.getLineStartOffset(line)
        val lineEnd = document.getLineEndOffset(line)
        val before = document.getText(TextRange(lineStart, offset))
        val after = document.getText(TextRange(offset, lineEnd))
        if (!isTabAnnotateCandidate(before, after)) return false

        val server = LspServerManager.getInstance(project)
            .getServersForProvider(EtyLspServerSupportProvider::class.java)
            .firstOrNull { it.state == LspServerState.Running } ?: return false

        val stamp = document.modificationStamp
        val modality = ModalityState.stateForComponent(editor.component)
        val params = CodeActionParams(
            server.getDocumentIdentifier(file),
            Range(Position(line, 0), Position(line, 0)),
            CodeActionContext(emptyList()),
        )

        ApplicationManager.getApplication().executeOnPooledThread {
            val insertText = runCatching {
                server.sendRequestSync(REQUEST_TIMEOUT_MS) { it.textDocumentService.codeAction(params) }
            }.getOrNull()
                ?.mapNotNull { if (it.isRight) it.right else null }
                ?.let { pickAnnotation(it) }

            ApplicationManager.getApplication().invokeLater({
                // The user kept typing or moved: drop both the annotation and
                // the swallowed Tab rather than act on a stale position.
                if (editor.isDisposed || document.modificationStamp != stamp ||
                    editor.caretModel.offset != offset
                ) return@invokeLater

                if (insertText != null) {
                    WriteCommandAction.runWriteCommandAction(project, "Insert ety Type Comment", null, {
                        val end = document.getLineEndOffset(line)
                        document.insertString(end, insertText)
                        editor.caretModel.moveToOffset(end + insertText.length)
                    })
                } else {
                    // No suggestion: replay the ordinary Tab we held back.
                    CommandProcessor.getInstance().executeCommand(project, {
                        val ctx = DataManager.getInstance().getDataContext(editor.contentComponent)
                        original.execute(editor, editor.caretModel.currentCaret, ctx)
                    }, "Tab", null)
                }
            }, modality)
        }
        return true
    }

    private companion object {
        const val REQUEST_TIMEOUT_MS = 1500
    }
}

/**
 * Cheap client-side filter so ordinary Tabs never wait on the server: the
 * caret must sit right after a `;` (only whitespace after it on the line),
 * and the line must start a `let`/`const`/`var` declaration. The server does
 * the real checks (single declarator, no existing comment, inferable type).
 */
internal fun isTabAnnotateCandidate(beforeCaret: String, afterCaret: String): Boolean {
    if (afterCaret.isNotBlank()) return false
    if (!beforeCaret.trimEnd().endsWith(";")) return false
    if (beforeCaret.contains("//")) return false
    return DECLARATION.containsMatchIn(beforeCaret)
}

private val DECLARATION = Regex("""^\s*(export\s+)?(let|const|var)\s""")

/** The text the server's "Insert // T: <type>" quick fix would append, if offered. */
internal fun pickAnnotation(actions: List<CodeAction>): String? =
    actions.firstOrNull { it.title.startsWith("Insert // T:") }
        ?.edit?.changes?.values?.firstOrNull()?.firstOrNull()?.newText

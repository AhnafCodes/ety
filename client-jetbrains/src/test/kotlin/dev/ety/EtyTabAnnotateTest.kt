package dev.ety

import com.intellij.testFramework.fixtures.BasePlatformTestCase
import org.eclipse.lsp4j.CodeAction
import org.eclipse.lsp4j.Position
import org.eclipse.lsp4j.Range
import org.eclipse.lsp4j.TextEdit
import org.eclipse.lsp4j.WorkspaceEdit

/**
 * Tab-to-annotate: the client-side pieces only (when a Tab is a candidate,
 * which server quick fix it applies, the on/off flag). The type inference
 * itself is the server's onCodeAction, covered by server/test/code-action.test.js.
 */
class EtyTabAnnotateTest : BasePlatformTestCase() {

    fun `test candidate only right after the semicolon of a declaration`() {
        assertTrue(isTabAnnotateCandidate("let i = 0;", ""))
        assertTrue(isTabAnnotateCandidate("    const s = 'a';", "   "))
        assertTrue(isTabAnnotateCandidate("export const n = 1;", ""))
        assertTrue(isTabAnnotateCandidate("var ok = true; ", ""))

        assertFalse("caret before ;", isTabAnnotateCandidate("let i = 0", ";"))
        assertFalse("no semicolon", isTabAnnotateCandidate("let i = 0", ""))
        assertFalse("not a declaration", isTabAnnotateCandidate("i = 0;", ""))
        assertFalse("identifier starting with let", isTabAnnotateCandidate("letter = 0;", ""))
        assertFalse("already commented", isTabAnnotateCandidate("let i = 0; // T: number", ""))
        assertFalse("blank line", isTabAnnotateCandidate("", ""))
    }

    fun `test picks the Insert T quick fix text`() {
        val edit = TextEdit(Range(Position(0, 10), Position(0, 10)), " // T: number")
        val action = CodeAction("Insert // T: number").apply {
            this.edit = WorkspaceEdit(mapOf("file:///a.js" to listOf(edit)))
        }
        assertEquals(" // T: number", pickAnnotation(listOf(CodeAction("Something else"), action)))
        assertNull(pickAnnotation(listOf(CodeAction("Something else"))))
        assertNull(pickAnnotation(emptyList()))
    }

    fun `test annotate on Tab is on by default and can be switched off`() {
        val s = EtySettings.instance().state
        val saved = s.annotateOnTab
        try {
            s.annotateOnTab = true
            if (envAllows("ETY_TAB_ANNOTATE")) assertTrue(EtySettings.annotateOnTab())
            s.annotateOnTab = false
            assertFalse(EtySettings.annotateOnTab())
        } finally {
            s.annotateOnTab = saved
        }
        assertTrue("default state is on", EtySettings.State().annotateOnTab)
    }
}

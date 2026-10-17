package dev.ety

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.panel

/**
 * IDE-wide ety settings (Settings > Tools > ety). Currently one flag:
 * Tab-to-annotate, on by default. `ETY_TAB_ANNOTATE=false` (or `0`) forces it
 * off regardless of the checkbox, same override style as ETY_AUTO_ANNOTATE.
 */
@Service(Service.Level.APP)
@State(name = "EtySettings", storages = [Storage("ety.xml")])
class EtySettings : PersistentStateComponent<EtySettings.State> {
    data class State(var annotateOnTab: Boolean = true)

    private var state = State()
    override fun getState(): State = state
    override fun loadState(loaded: State) { state = loaded }

    companion object {
        fun instance(): EtySettings = service()

        fun annotateOnTab(): Boolean = envAllows("ETY_TAB_ANNOTATE") && instance().state.annotateOnTab
    }
}

/** False only when the variable is set to exactly `false` or `0`. */
internal fun envAllows(name: String): Boolean {
    val raw = System.getenv(name)?.trim()?.lowercase()
    return raw != "false" && raw != "0"
}

class EtyConfigurable : BoundConfigurable("ety") {
    override fun createPanel(): DialogPanel = panel {
        val s = EtySettings.instance().state
        row {
            checkBox("Insert // T: <type> when pressing Tab after ';'")
                .bindSelected(s::annotateOnTab)
                .comment("E.g. <code>let i = 0;</code> + Tab → <code>let i = 0; // T: number</code>. " +
                    "Anywhere else Tab works as usual. ETY_TAB_ANNOTATE=false overrides this.")
        }
    }
}

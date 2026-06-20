# Gate 5 — Manual Verification Checklist (JetBrains client)

The automated half of Milestone 7 is green: the `--stdio` boot contract and the
`uriToPath` JetBrains row run under `npm test`, and the descriptor smoke test
runs under `./gradlew test`. This checklist is the **manual half** — the visual
proof that the plugin actually delivers diagnostics and hover inside a real IDE,
exactly as Gate 3b/Gate 4 demanded for the VS Code client.

**Gate 5 passes when every box below is checked on a real machine.** It cannot be
run headless — it requires a GUI IntelliJ IDEA window.

---

## 0. Environment

- [ ] **IntelliJ IDEA 2025.3 or newer** (the unified distribution). Either the
      free tier or a licensed install works — the LSP API is enabled in both.
- [ ] **JDK 21** available to Gradle.
- [ ] **Node** on `PATH` (`node --version`), or `ETY_NODE` pointing at a Node
      binary. The plugin spawns `node`; if it can't find one, no server starts.
- [ ] The server's dependencies are installed and the parser is built, so the
      spawned server actually runs:
      ```bash
      npm install
      npm run build:parser
      npm test            # sanity: 123 green, incl. the --stdio boot test
      ```

## 1. Launch the dev IDE

- [ ] From the repo root:
      ```bash
      cd client-jetbrains
      ./gradlew runIde
      ```
      First run downloads the 2025.3 platform; subsequent runs are fast.
- [ ] A second IntelliJ IDEA window opens (the **dev IDE**) with the ety plugin
      loaded. (Verify under *Settings → Plugins → Installed* that **ety Language
      Server** is present and enabled.)
- [ ] In the dev IDE, **open the repo's `fixtures/workspace/` folder** as the
      project (File → Open → select `fixtures/workspace`).

## 2. Diagnostics on `.js` — the squiggle lands on the ORIGINAL line

Open `fixtures/workspace/type-error.js`:
```js
let count = 0; // T: number
count = "oops";
```
- [ ] A red squiggle appears under **`"oops"` on line 2** (the assignment), *not*
      on the `// T: number` comment on line 1.
- [ ] The error message reads approximately:
      *Type 'string' is not assignable to type 'number'.*
- [ ] Hovering / viewing the problem shows it anchored to line 2, character 0–5
      (the `count` write) — diagnostics map back to the **real source line**, the
      core invariant.
- [ ] Fix it (`count = 5;`) → the squiggle disappears within ~a second
      (debounce). Re-introduce the error → it returns. (Proves live re-checking,
      not a one-shot.)

## 3. Hover on `.js` — resolved types from `// T:`

Open `fixtures/workspace/box.js` (a generic class with method annotations):
- [ ] Hover the `boxed` symbol in `const boxed = new Box(42);` → the tooltip
      shows it typed as **`Box<number>`** (the `{}` generic resolved to `<>`).
- [ ] Hover `doubled` (`boxed.map(n => n * 2)`) → tooltip shows **`Box<number>`**
      (the `map` method's `{U}((T) => U) => Box{U}` signature applied).
- [ ] Hover the `value` field → shows type **`T`**.
- [ ] Hover **on the `// T:` comment text itself** → nothing weird happens (no
      crash, no bogus tooltip). The comment line is verbatim in the virtual doc;
      hovering trivia returns nothing, by design.

## 4. JSX — the `javascriptreact` path

Open `fixtures/workspace/component.jsx`:
```jsx
let label = 0; // T: number
label = 'oops';
export const el = <div className="x">{label}</div>;
```
- [ ] A red squiggle appears under **`'oops'` on line 4** (string → number),
      proving `.jsx` files are claimed and `jsx: Preserve` lets the JSX below
      parse without spurious errors.
- [ ] **No** spurious diagnostics on the `<div …>` JSX line itself.
- [ ] Hover `label` → type **`number`**.

## 4b. Embedded `<script>` JS in `.html` (Milestone 13)

`.html` is claimed by default (the descriptor's `scriptHosts` defaults to
`html`; set `ETY_SCRIPT_HOSTS=html,jsp,aspx,tpl,ftl` before launching to opt the
template formats in). Open `fixtures/workspace/embedded.html`:
```html
<script>
let qty = 0; // T: number
qty = "oops";
</script>
```
- [ ] A red squiggle appears under **`qty` on line 7** (the `qty = "oops"`
      assignment *inside* the `<script>`), **not** on the `<script>` tag line,
      the `// T:` line, or any HTML markup. This is the projection invariant: the
      squiggle maps back onto the real `.html` line and column.
- [ ] The message reads approximately *Type 'string' is not assignable to type
      'number'.*
- [ ] Hover `qty` inside the `<script>` → tooltip shows **`number`**.
- [ ] The surrounding HTML (`<div>`, `<body>`, the `<script>` tag) draws **no**
      diagnostics and no bogus hovers — only the script body is analyzed.
- [ ] Fix it (`qty = 5;`) → the squiggle clears within ~a second; re-introduce →
      it returns.
- [ ] *(If templates enabled)* with `ETY_SCRIPT_HOSTS` including `tpl`, a `.tpl`
      file's `<script>` behaves the same, and an in-script `${ ... }` does **not**
      itself draw a diagnostic (it is neutralized before analysis).

## 5. Lifecycle / robustness

- [ ] Open a `.js` file with **no `// T:` annotations** → no diagnostics, no
      errors in the IDE log (Help → Show Log). The server stays quiet, not noisy.
- [ ] Open a **JetBrains Scratch file** (File → New → Scratch File → JavaScript),
      paste the `type-error.js` content → the squiggle still lands on line 2.
      (Confirms scratch files — disk-backed, `file://` — work through the normal
      path; the `uriToPath` JetBrains row predicted this.)
- [ ] Edit rapidly for a few seconds in `type-error.js` → no lag spikes, no
      duplicate/stuck squiggles (debounce holds under fast typing).
- [ ] Check the IDE log for `ety`/LSP errors → none beyond expected info lines.

---

## If something fails

| Symptom | Likely cause | Check |
|---------|--------------|-------|
| No squiggles at all | Server never started | IDE log for "ety" / LSP entries; is Node on PATH / `ETY_NODE` set? |
| Squiggle on the `// T:` line, not the code | Line remap regression | Re-run `npm test` (orchestration + handlers cover this) |
| "Cannot find module typescript" in log | Server not bundled / deps missing | `npm install`; for a packaged build confirm `bundleServer` ran |
| Plugin not listed | LSP module gate | Confirm IDE is **2025.3+**; check `plugin.xml` `<depends>` resolved |
| JSX file shows JSX syntax errors | `jsx: Preserve` not applied | Server-side; verify `tsHost.js` compilation settings |

## Recording the result

Gate 5 is **closed** when all boxes are checked on a 2025.3+ install. Note the
IDE build number and OS used, e.g.:

> Gate 5 verified on IntelliJ IDEA 2025.3 (build 253.xxxxx), macOS / Linux /
> Windows, Node vXX. All sections pass.

Add that line to the Milestone 7 entry (or the PR description) so the gate has a
durable, dated record — same discipline as the Gate 3a "resolved GREEN" note.

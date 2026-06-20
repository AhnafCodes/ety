// Milestone 13 — Embedded JS in host documents (`<script>` tags).
//
// ety analyzes the JavaScript inside `<script>` blocks of host documents
// (.html by default; .jsp/.aspx/.tpl/.ftl opt-in). This module is the only new
// code the milestone needs below the pipeline: a PURE pre-pass that turns a host
// document into a JavaScript projection the unchanged parser, transformer, TS
// host, and handlers can consume.
//
// THE invariant that makes the whole milestone a pre-pass: the projection is
// LINE- AND COLUMN-PARALLEL to the host. Same number of lines, and every byte
// that survives keeps its exact (line, character). So `vToO`/`oToV` built over
// the projection map straight back onto the real host file — no new coordinate
// system, no intra-line tracking. To TypeScript a host doc just looks like a .js
// file whose non-script lines happen to be blank.

// Script `type`s that are JavaScript. Empty/absent type is JS (HTML default);
// `application/json`, `importmap`, `text/template`, etc. are not and are skipped.
const JS_SCRIPT_TYPES = new Set([
    '', 'module',
    'text/javascript', 'application/javascript',
    'text/ecmascript', 'application/ecmascript',
    'text/babel', 'text/jsx',
]);

// Curated, per-host server-side template delimiters neutralized INSIDE script
// bodies (opt-in formats only). `<%…%>` covers `<%=…%>`/`<%@…%>`; `${…}` is
// JSP EL / generic interpolation; the `<#…>`/`[#…]`/`<@…>`/`[@…]` forms are
// FreeMarker. Plain .html has none — its `<script>` bodies are already JS.
const DELIMITERS = {
    html: [],
    jsp:  [['<%', '%>'], ['${', '}'], ['#{', '}']],
    aspx: [['<%', '%>']],
    tpl:  [['${', '}']],
    ftl:  [['${', '}'], ['</#', '>'], ['<#', '>'], ['[/#', ']'], ['[#', ']'], ['<@', '>'], ['[@', ']']],
};

// Normalize a configured host list to a lowercase, dot-stripped Set.
export function normalizeHosts(scriptHosts) {
    return new Set((scriptHosts ?? []).map(h => String(h).toLowerCase().replace(/^\./, '')));
}

// The file extension of a URI/path: lowercased, query/fragment stripped, '' if none.
export function uriExtension(uri) {
    const clean = String(uri).replace(/[?#].*$/, '');
    const base = clean.slice(Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\')) + 1);
    const dot = base.lastIndexOf('.');
    return dot >= 0 ? base.slice(dot + 1).toLowerCase() : '';
}

// Normalize the `ety.scriptHosts` setting (from initializationOptions or a
// didChangeConfiguration push) to a clean string[] of extensions. Unset or
// invalid -> the default `['html']`; entries are lowercased, dot-stripped,
// trimmed, de-duplicated, and non-strings dropped. Kept here (pure) so main.js
// stays plumbing and this is unit-tested.
export function resolveScriptHosts(raw) {
    if (!Array.isArray(raw)) return ['html'];
    const cleaned = [...new Set(
        raw.filter(x => typeof x === 'string')
            .map(x => x.toLowerCase().replace(/^\./, '').trim())
            .filter(Boolean),
    )];
    return cleaned.length ? cleaned : ['html'];
}

// The matched host extension (e.g. 'html', 'tpl') when `uri` is a configured
// host document, else null. `.js`/`.jsx` are never hosts — they go through the
// normal source path unchanged.
export function detectScriptHost(uri, scriptHosts) {
    const ext = uriExtension(uri);
    return normalizeHosts(scriptHosts).has(ext) ? ext : null;
}

// Host docs need a JS extension as their TS file-name key: TypeScript derives
// ScriptKind from the extension, and a `.html` key classifies as Unknown (never
// parsed as JS). Append `.jsx` (a superset of JS+JSX that still honors // T:
// JSDoc), exactly as the untitled-buffer path does in uriToPath.
export function hostScriptPath(path) {
    return path + '.jsx';
}

// Find the byte spans of every JavaScript `<script>` BODY in `source`. Honors
// the HTML5 raw-text rule (a body ends at the first `</script`, even inside a
// JS string), skips non-JS `type`s and `src`-only/self-closing tags, and is
// case-insensitive over the tag name and attributes.
export function findScriptRegions(source) {
    const regions = [];
    const lower = source.toLowerCase();
    let i = 0;
    while (i < source.length) {
        const open = lower.indexOf('<script', i);
        if (open === -1) break;
        // Guard against `<scripts>`/`<scripting>`: the name must end here.
        const after = source[open + 7];
        if (after !== undefined && !/[\s>/]/.test(after)) { i = open + 7; continue; }

        const tagEnd = findTagEnd(source, open + 7);
        if (tagEnd === -1) break; // unterminated open tag — give up cleanly
        const attrs = source.slice(open + 7, tagEnd);
        const bodyStart = tagEnd + 1;

        // A self-closing `<script/>` has no body and no matching `</script>` —
        // do NOT search for one, or we'd swallow the next real script up to its
        // close tag.
        if (source[tagEnd - 1] === '/') { i = bodyStart; continue; }

        const close = lower.indexOf('</script', bodyStart);
        const bodyEnd = close === -1 ? source.length : close;
        if (isJsScript(attrs)) {
            regions.push({ start: bodyStart, end: bodyEnd });
        }
        i = close === -1 ? source.length : close + 8;
    }
    return regions;
}

// From just past `<script`, return the index of the `>` that closes the open
// tag, skipping quoted attribute values so a `>` inside one doesn't fool us.
function findTagEnd(source, i) {
    while (i < source.length) {
        const c = source[i];
        if (c === '"' || c === "'") {
            i++;
            while (i < source.length && source[i] !== c) i++;
            i++; // step past the closing quote (or end of input)
            continue;
        }
        if (c === '>') return i;
        i++;
    }
    return -1;
}

// Decide whether a `<script>`'s attribute text denotes inline JavaScript.
function isJsScript(attrs) {
    const typeMatch = /\btype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    if (typeMatch) {
        const raw = (typeMatch[2] ?? typeMatch[3] ?? typeMatch[4] ?? '').trim().toLowerCase();
        const base = raw.split(';')[0].trim(); // drop `;charset=…`
        if (!JS_SCRIPT_TYPES.has(base)) return false;
    }
    // `<script src=…>` pulls its body from elsewhere — nothing inline to type.
    if (/\bsrc\s*=/i.test(attrs)) return false;
    return true;
}

// Build the line- and column-parallel JS projection of a host document. Every
// char outside a script body becomes a space (newlines/CR preserved, so line
// count and every column are identical to the host); every char inside a script
// body is copied verbatim. For opt-in template hosts, recognized delimiter spans
// inside script bodies are neutralized to width-preserving inert JS.
export function extractScriptProjection(hostSource, hostKind) {
    const regions = findScriptRegions(hostSource);
    const out = new Array(hostSource.length);
    for (let i = 0; i < hostSource.length; i++) {
        const c = hostSource[i];
        out[i] = (c === '\n' || c === '\r') ? c : ' ';
    }
    for (const { start, end } of regions) {
        for (let i = start; i < end; i++) out[i] = hostSource[i];
    }
    const delims = DELIMITERS[hostKind] ?? [];
    if (delims.length) {
        for (const { start, end } of regions) {
            neutralizeDelimiters(out, hostSource, start, end, delims);
        }
    }
    return { jsSource: out.join('') };
}

// Replace [from, to) with width-preserving inert JS. The filler is `null`,
// because under the host's non-strict TS settings (strict:false, so
// strictNullChecks is off) `null` is assignable to EVERY type — so a neutralized
// `${userId}` never fights a `// T: string` (or `number`, or anything) on the
// same line, and an un-annotated `let x = ${…}` infers `any`. A number/string
// filler would conflict with the opposite annotation. Sub-4-width spans (only
// the degenerate `${}`/`<%%>`) fall back to `0`. Spare slots become spaces and
// newlines stay put, so line/column parity holds. (Adjacent delimiters like
// `${a}${b}` are a documented best-effort gap.)
function blankSpan(out, from, to) {
    const slots = [];
    for (let i = from; i < to; i++) {
        if (out[i] !== '\n' && out[i] !== '\r') slots.push(i);
    }
    const filler = slots.length >= 4 ? 'null' : '0';
    for (let k = 0; k < slots.length; k++) {
        out[slots[k]] = k < filler.length ? filler[k] : ' ';
    }
}

function neutralizeDelimiters(out, source, start, end, delims) {
    let i = start;
    while (i < end) {
        let matched = false;
        for (const [open, close] of delims) {
            if (i + open.length <= end && source.startsWith(open, i)) {
                const closeAt = source.indexOf(close, i + open.length);
                const spanEnd = closeAt === -1 ? end : Math.min(closeAt + close.length, end);
                blankSpan(out, i, spanEnd);
                i = spanEnd;
                matched = true;
                break;
            }
        }
        if (!matched) i++;
    }
}

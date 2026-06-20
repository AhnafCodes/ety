// Connection wiring only (implementation-plan.md, Methodology Rule 5) — every
// behavior lives in handlers.js/tsHost.js/transform.js and is unit-tested
// there; nothing here but plumbing. vscode-languageserver already catches
// handler exceptions and answers JSON-RPC errors, so a bug degrades one
// request instead of crashing the process (a crash loop bricks the editor:
// the client only restarts the server a limited number of times).
import {
    createConnection,
    TextDocuments,
    ProposedFeatures,
    TextDocumentSyncKind,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { parse_ety } from './parser.js';
import { createTsService } from './tsHost.js';
import { createState, processDocument, onHover, onCompletion, onDidClose, uriToPath } from './handlers.js';
import { resolveScriptHosts } from './embedded.js';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const state = createState();
const deps = { connection, parse_ety, tsService: null };

connection.onInitialize(params => {
    // Milestone 13: the host extensions whose `<script>` bodies ety analyzes.
    // The client passes the `ety.scriptHosts` setting through initializationOptions
    // (synchronous, no capability negotiation); onDidChangeConfiguration keeps it
    // live. resolveScriptHosts defaults it to ['html'].
    state.scriptHosts = resolveScriptHosts(params.initializationOptions?.scriptHosts);
    const rootUri = params.workspaceFolders?.[0]?.uri ?? params.rootUri;
    deps.tsService = createTsService({
        virtualDocs: state.virtualDocs,
        versions: state.versions,
        ...(rootUri ? { workspaceRoot: uriToPath(rootUri) } : {}),
    });
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            hoverProvider: true,
            // Inference-driven base-type completion (Milestone 9): we offer a
            // primitive type name when the cursor sits in a // T: payload over a
            // binding whose initializer infers to a primitive. Triggered on ':'
            // (the // T: marker) so the editor asks us as the user starts typing
            // the type. This is NOT the deferred general type-name completion
            // (spec: "Deferred: Autocompletion") — that one needs intra-line
            // spoofing into the JSDoc block; this one reads an already-inferred
            // type and returns a whole token.
            completionProvider: { triggerCharacters: [':'] },
            //
            // diagnosticsProvider is NOT declared either: diagnostics use the
            // push model via connection.sendDiagnostics.
        },
    };
});

// TextDocuments fires onDidChangeContent for didOpen too, so this single hook
// covers both; an extra onDidOpen handler would double-process every open.
documents.onDidChangeContent(({ document }) => processDocument(state, deps, document));
documents.onDidClose(({ document }) => onDidClose(state, deps, document));
connection.onHover(params => onHover(state, deps, params));
connection.onCompletion(params => onCompletion(state, deps, params));

// Live `ety.scriptHosts` changes (Milestone 13): re-read the setting and
// re-project every open document so a newly-enabled host takes effect. The
// client's document selector is fixed per session, so attaching a *new* file
// type still needs a window reload — but already-open docs re-project here.
connection.onDidChangeConfiguration(change => {
    state.scriptHosts = resolveScriptHosts(change?.settings?.ety?.scriptHosts);
    for (const document of documents.all()) processDocument(state, deps, document);
});

documents.listen(connection);
connection.listen();

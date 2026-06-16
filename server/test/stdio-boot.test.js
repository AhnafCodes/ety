// Milestone 7, the red-first anchor: the server must boot over STDIO, not just
// VS Code's node-ipc transport. JetBrains' LSP API spawns the server process
// and speaks LSP over stdin/stdout, so this is the contract that lets a second
// editor drive the exact same server binary. Nothing else exercises stdio — the
// VS Code e2e runs over IPC — so this test stands alone as the transport proof.
import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAIN = join(dirname(fileURLToPath(import.meta.url)), '../src/main.js');

// Minimal LSP wire codec: `Content-Length: N\r\n\r\n<json>`.
function frame(message) {
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`), body]);
}

// Read framed JSON-RPC messages off a stream until `predicate(msg)` matches,
// resolving with that message. Rejects on timeout/exit so a hang fails loudly.
function readUntil(child, predicate, timeoutMs = 10_000) {
    return new Promise((resolve, reject) => {
        let buf = Buffer.alloc(0);
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error('timed out waiting for matching LSP message over stdio'));
        }, timeoutMs);

        function onData(chunk) {
            buf = Buffer.concat([buf, chunk]);
            for (;;) {
                const headerEnd = buf.indexOf('\r\n\r\n');
                if (headerEnd === -1) return;
                const header = buf.subarray(0, headerEnd).toString('ascii');
                const m = /Content-Length:\s*(\d+)/i.exec(header);
                if (!m) return;
                const len = Number(m[1]);
                const start = headerEnd + 4;
                if (buf.length < start + len) return; // wait for the full body
                const body = buf.subarray(start, start + len).toString('utf8');
                buf = buf.subarray(start + len);
                let msg;
                try { msg = JSON.parse(body); } catch { continue; }
                if (predicate(msg)) { cleanup(); resolve(msg); }
            }
        }
        function onExit(code) {
            cleanup();
            reject(new Error(`server exited (code ${code}) before a matching message`));
        }
        function cleanup() {
            clearTimeout(timer);
            child.stdout.off('data', onData);
            child.off('exit', onExit);
        }
        child.stdout.on('data', onData);
        child.on('exit', onExit);
    });
}

describe('stdio transport boot (JetBrains contract)', () => {
    it('boots under --stdio and answers initialize with the ety capabilities', async () => {
        const child = spawn(process.execPath, [MAIN, '--stdio'], {
            stdio: ['pipe', 'pipe', 'inherit'],
        });
        try {
            child.stdin.write(frame({
                jsonrpc: '2.0',
                id: 1,
                method: 'initialize',
                params: { processId: process.pid, rootUri: null, capabilities: {} },
            }));

            const response = await readUntil(child, m => m.id === 1 && 'result' in m);
            const caps = response.result.capabilities;

            // Same capability surface main.js advertises over IPC — proving the
            // server is transport-agnostic, not that stdio gets a special build.
            expect(caps.hoverProvider).toBe(true);
            expect(caps.textDocumentSync).toBeDefined();
            // Inference-driven base-type completion (Milestone 9) is advertised
            // with a ':' trigger; general type-name completion remains deferred.
            expect(caps.completionProvider).toEqual({ triggerCharacters: [':'] });
        } finally {
            child.kill();
        }
    });
});

/**
 * CLI-ENGINES §3.2 (CE-1.4, CE-1.5, CE-1.10, CE-1.11): the listener the PreToolUse hook calls. Same rules as the model endpoint (CE-4): 127.0.0.1 and port 0, the exact Host, no Origin and no
 * Sec-Fetch-* header, the run's own token (randomBytes(32), timingSafeEqual), JSON of at most 1 MB, and only POST /decide. Anything else is a bare 403 / 404 with no detail.
 *
 * It answers only its own run's requests. Each request is judged afresh (no cache). Every tool_use id that reaches it is remembered, for the stream watchdog (CE-1.10): a tool that finishes
 * with no request from the hook means the hook is not working. An Ask waits for the person, but never longer than `limitMs`: the bridge answers deny itself first (CE-1.11), and the hook's own
 * timeout (and Claude Code's, in the settings) are set above that.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

export const BRIDGE_ASK_LIMIT_MS = 150_000; // the longest an Ask card waits before Bunny answers deny itself (S1 proved a 300 s hook timeout with a card answered at 120 s and Bunny's own deny at 150 s; nothing longer is proven)
export const HOOK_TIMEOUT_SECONDS = 300;     // Claude Code's hook timeout in Bunny's settings: above the Ask limit
export const HOOK_OWN_LIMIT_MS = 200_000;    // the hook script's own limit: above the Ask limit, below Claude Code's
const MAX_BODY = 1024 * 1024;
const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export function createBridgeServer({ judge, limitMs = BRIDGE_ASK_LIMIT_MS, onDecision = null } = {}) {
  const token = randomBytes(32).toString('hex');
  const tokenBuf = Buffer.from(token);
  const seenIds = new Set();
  const controllers = new Set();
  let server = null; let port = 0; let closed = false;
  const stats = { requests: 0, refused: 0, allowed: 0, denied: 0 };

  const refuse = (res, status = 403) => { stats.refused += 1; res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json' }); res.end('{}'); };
  const tokenOk = (req) => {
    const m = /^Bearer (.+)$/i.exec(String(req.headers.authorization ?? ''));
    if (!m) return false;
    const buf = Buffer.from(m[1]);
    return buf.length === tokenBuf.length && timingSafeEqual(buf, tokenBuf);
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { reject(new Error('too big')); return; }
    const parts = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too big')); req.destroy(); return; } parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });

  async function handle(req, res) {
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(res);
    if (req.headers.origin !== undefined) return refuse(res);
    if (Object.keys(req.headers).some((h) => h.startsWith('sec-fetch-'))) return refuse(res);
    if (!tokenOk(req)) return refuse(res);
    if (!(req.method === 'POST' && req.url === '/decide')) { res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'application/json' }); res.end('{}'); return undefined; }
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return refuse(res, 400); }
    if (!body || typeof body !== 'object' || typeof body.tool !== 'string') return refuse(res, 400);
    stats.requests += 1;
    if (typeof body.id === 'string' && body.id) seenIds.add(body.id);
    const control = new AbortController(); controllers.add(control);
    let answered = false;
    res.on('close', () => { if (!answered) control.abort(); });
    // an Ask waits for the person, but never past the limit: then Bunny's own answer is deny
    const limit = new Promise((resolve) => { const t = setTimeout(() => resolve({ allow: false, reason: 'No answer came in time, so this was not allowed.', timedOut: true }), limitMs); control.signal.addEventListener('abort', () => clearTimeout(t)); t.unref?.(); });
    let verdict;
    try { verdict = await Promise.race([Promise.resolve(judge({ tool: body.tool, input: body.input, id: String(body.id ?? ''), agent: String(body.agent ?? '') })), limit]); } catch (err) { verdict = { allow: false, reason: `Bunny could not judge this call (${String(err?.message ?? err).slice(0, 80)}), so it was not allowed.` }; }
    controllers.delete(control); answered = true;
    const allow = verdict?.allow === true;
    const abstain = !allow && verdict?.abstain === true; // ENGINE-RULES: the floor holds and Bunny has no opinion: the engine's own rules decide
    stats[allow ? 'allowed' : 'denied'] += 1;
    try { onDecision?.({ tool: body.tool, id: body.id, agent: body.agent, allow, reason: verdict?.reason, name: verdict?.name, summary: verdict?.summary }); } catch { /* a log only */ }
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
    res.end(JSON.stringify({ allow, ...(abstain ? { abstain: true } : {}), reason: String(verdict?.reason ?? (allow ? 'Allowed.' : 'Not allowed.')).slice(0, 400) }));
    return undefined;
  }

  return {
    token, stats,
    async start() {
      if (server) throw new Error('already started');
      server = createServer((req, res) => { handle(req, res).catch(() => { try { refuse(res, 500); } catch { /* gone */ } }); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      port = server.address().port;
      return { port, token };
    },
    get port() { return port; },
    /** Has the hook asked about this tool_use id? (the watchdog's question) */
    seen: (id) => seenIds.has(String(id)),
    get closed() { return closed; },
    async close() {
      if (closed) return;
      closed = true;
      for (const c of controllers) c.abort();
      if (server) await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}

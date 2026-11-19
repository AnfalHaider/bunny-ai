/**
 * CLI-ENGINES §3.7.4 (ER-4): the per-run permission-prompt tool for Claude Code when Bunny's engine is off. Claude Code is started with
 * `--permission-prompt-tool mcp__bunny__approve` and `--mcp-config` naming this server; every question the engine itself would ask ("ask" rules, a tool its mode does not allow)
 * arrives here as a `tools/call approve { tool_name, input, tool_use_id }`, and the answer is the person's, through a card.
 *
 * Same rules as the other loopback listeners (CE-4): 127.0.0.1 and port 0, the exact Host, no Origin and no Sec-Fetch-* header, the run's own token, JSON of at most 1 MB, only POST /mcp.
 * Fail closed: anything that is not a well-formed permission request is refused; no answer inside the limit is a deny; a crash, a close and a kill end in a deny because Claude Code gets
 * no allow (the engine treats a failed prompt tool as a deny: the spike S1 line shows it).
 *
 * `decide({ tool, input, id })` -> { allow, reason } is the app's: the floor first (a floor deny beats any Allow), then the card.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { BRIDGE_ASK_LIMIT_MS } from './bridge-server.js';

export const APPROVE_TOOL = 'approve';
export const APPROVE_SERVER = 'bunny';
export const APPROVE_FULL_NAME = `mcp__${APPROVE_SERVER}__${APPROVE_TOOL}`;
const MAX_BODY = 1024 * 1024;
const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const TOOL_DEF = {
  name: APPROVE_TOOL,
  description: 'Bunny asks the person whether the engine may use a tool. Only the engine itself calls this, for a permission request.',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
};

export function createApproveServer({ decide, limitMs = BRIDGE_ASK_LIMIT_MS, onQuestion = null } = {}) {
  const token = randomBytes(32).toString('hex');
  const tokenBuf = Buffer.from(token);
  const controllers = new Set();
  let server = null; let port = 0; let closed = false;
  const stats = { requests: 0, refused: 0, questions: 0, allowed: 0, denied: 0, malformed: 0 };

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
  const json = (res, status, body) => { res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
  const result = (id, value) => ({ jsonrpc: '2.0', id, result: value });
  const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  const answer = (verdict, input) => ({ content: [{ type: 'text', text: JSON.stringify(verdict.allow === true ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: String(verdict.reason ?? 'Bunny did not allow this.').slice(0, 400) }) }] });

  /** A permission request has exactly the shape the engine sends: a tool name, an object input, a tool_use id. Anything else is not one. */
  const wellFormed = (a) => a && typeof a === 'object' && typeof a.tool_name === 'string' && a.tool_name.length > 0 && a.tool_name.length < 200
    && a.input && typeof a.input === 'object' && !Array.isArray(a.input) && typeof a.tool_use_id === 'string' && a.tool_use_id.length > 0 && a.tool_use_id.length < 200;

  async function call(msg, res) {
    const args = msg.params?.arguments;
    if (msg.params?.name !== APPROVE_TOOL || !wellFormed(args)) { stats.malformed += 1; return json(res, 200, result(msg.id, { isError: true, content: [{ type: 'text', text: JSON.stringify({ behavior: 'deny', message: 'That was not a permission request, so it was refused.' }) }] })); }
    // the engine's own tools are judged under the bunny namespace too: the approve tool itself is never allowed to be used by the model (mapped as a floor deny in the bridge)
    stats.questions += 1;
    const control = new AbortController(); controllers.add(control);
    let answered = false;
    res.on('close', () => { if (!answered) control.abort(); });
    const limit = new Promise((resolve) => { const t = setTimeout(() => resolve({ allow: false, reason: 'No answer came in time, so this was not allowed.', timedOut: true }), limitMs); control.signal.addEventListener('abort', () => clearTimeout(t)); t.unref?.(); });
    let verdict;
    try { onQuestion?.({ tool: args.tool_name, id: args.tool_use_id }); verdict = await Promise.race([Promise.resolve(decide({ tool: args.tool_name, input: args.input, id: args.tool_use_id })), limit]); } catch (err) { verdict = { allow: false, reason: `Bunny could not judge this (${String(err?.message ?? err).slice(0, 80)}), so it was not allowed.` }; }
    controllers.delete(control); answered = true;
    if (verdict?.allow === true) stats.allowed += 1; else stats.denied += 1;
    return json(res, 200, result(msg.id, answer(verdict ?? { allow: false }, args.input)));
  }

  async function handle(req, res) {
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(res);
    if (req.headers.origin !== undefined) return refuse(res);
    if (Object.keys(req.headers).some((h) => h.startsWith('sec-fetch-'))) return refuse(res);
    if (!tokenOk(req)) return refuse(res);
    if (!(req.method === 'POST' && (req.url === '/mcp' || req.url === '/mcp/'))) { res.writeHead(req.method === 'GET' || req.method === 'DELETE' ? 405 : 404, { ...SECURITY_HEADERS, 'content-type': 'application/json' }); res.end('{}'); return undefined; }
    let msg;
    try { msg = JSON.parse(await readBody(req)); } catch { return refuse(res, 400); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.method !== 'string') return refuse(res, 400);
    stats.requests += 1;
    if (msg.id === undefined) { res.writeHead(202, SECURITY_HEADERS); res.end(); return undefined; } // a notification
    if (msg.method === 'initialize') return json(res, 200, result(msg.id, { protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: APPROVE_SERVER, version: '1' } }));
    if (msg.method === 'ping') return json(res, 200, result(msg.id, {}));
    if (msg.method === 'tools/list') return json(res, 200, result(msg.id, { tools: [TOOL_DEF] }));
    if (msg.method === 'tools/call') return call(msg, res);
    return json(res, 200, failure(msg.id, -32601, 'Method not found'));
  }

  return {
    token, stats,
    async start() {
      if (server) throw new Error('already started');
      server = createServer((req, res) => { handle(req, res).catch(() => { try { refuse(res, 500); } catch { /* gone */ } }); });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      port = server.address().port;
      return { port, token, url: `http://127.0.0.1:${port}/mcp` };
    },
    get port() { return port; },
    get closed() { return closed; },
    async close() {
      if (closed) return;
      closed = true;
      for (const c of controllers) c.abort();
      if (server) await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}

/** The `--mcp-config` content for the run: this server only. The token is read from the environment by Claude Code (`${BUNNY_APPROVE_TOKEN}`), never written into a file. */
export const mcpConfig = (url) => ({ mcpServers: { [APPROVE_SERVER]: { type: 'http', url, headers: { Authorization: 'Bearer ${BUNNY_APPROVE_TOKEN}' } } } });

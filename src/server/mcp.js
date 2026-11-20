/**
 * MCP: tools that live outside this app.
 *
 * A minimal Model Context Protocol client over streamable HTTP. It speaks the
 * two calls that matter — list the tools, run a tool — and keeps no state
 * beyond the configured servers.
 *
 * Nothing here runs a command from a config file: servers are HTTP endpoints
 * with a name, so a configuration cannot become arbitrary code execution.
 */

import { appVersion } from './updates.js'; // the app's own version, read from package.json (it used to be typed here and went stale)

const PROTOCOL_VERSION = '2025-06-18';

export class McpError extends Error {
  constructor(message, code = 'mcp.failed', extra = {}) {
    super(message);
    this.code = code;
    if (extra.signInUrl !== undefined) this.signInUrl = extra.signInUrl;
    if (extra.expired) this.expired = true; // it was signed in, and the saved sign-in could not be renewed
  }
}

/** The resource_metadata address a 401 names (RFC 9728), or null. */
export function resourceMetadataFrom(res) {
  const header = res?.headers?.get?.('www-authenticate') ?? '';
  const m = /resource_metadata="([^"]+)"/i.exec(header);
  return m ? m[1] : null;
}

/**
 * Send one JSON-RPC request. With an `auth` function (returns extra headers,
 * called per request) a 401 gets one refresh-and-retry when a token was sent,
 * then becomes mcp.needsSignIn; the raw 401 text never reaches the model or the window.
 */
async function send(url, server, body, { signal, auth, fetchImpl }) {
  const session = sessions.get(sessionKey(server, url));
  for (let attempt = 0; ; attempt++) {
    const extra = auth ? ((await auth({ refresh: attempt > 0 })) ?? {}) : {};
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(session?.version ? { 'mcp-protocol-version': session.version } : {}),
        ...(session?.id ? { 'mcp-session-id': session.id } : {}),
        ...(server.headers ?? {}),
        ...extra,
      },
      body: JSON.stringify(body),
      signal,
    });
    if (res.status === 401 && auth) {
      if (attempt === 0 && Object.keys(extra).length > 0) continue;
      throw new McpError('This connector needs you to sign in.', 'mcp.needsSignIn', { signInUrl: resourceMetadataFrom(res) });
    }
    return res;
  }
}

/**
 * R-2: the handshake. A streamable-HTTP server expects `initialize`, then `notifications/initialized`, and then the session id and protocol version it
 * answered with on every later request; many refuse (400 or 404) without it. One handshake per connector, kept in memory; a server that does not
 * speak it (the answer is not an initialize result) is used as before. The connector's own `instructions` are kept too (L-1).
 */
const sessions = new Map();
const sessionKey = (server, url) => `${server?.id ?? ''}|${String(url ?? '').trim().toLowerCase()}`;

async function ensureSession(url, server, { signal, auth, fetchImpl }) {
  const key = sessionKey(server, url);
  if (sessions.has(key)) return sessions.get(key);
  const state = { id: null, version: null, instructions: '' };
  let clean = false; // true only when the server plainly does not take the handshake (so it is not asked again)
  try {
    const res = await send(url, server, { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'Bunny AI', version: await appVersion() } } }, { signal, auth, fetchImpl });
    if (res.ok) {
      const payload = await readPayload(res);
      if (payload?.result?.protocolVersion) {
        state.version = String(payload.result.protocolVersion).slice(0, 40);
        state.id = res.headers.get('mcp-session-id') || null;
        state.instructions = String(payload.result.instructions ?? '').slice(0, 2000);
        sessions.set(key, state); // the next request carries the session
        const done = await send(url, server, { jsonrpc: '2.0', method: 'notifications/initialized' }, { signal, auth, fetchImpl }).catch(() => null);
        await done?.body?.cancel?.().catch(() => {});
        return state;
      }
      clean = true; // answered, but not with an initialize result
    } else {
      await res.body?.cancel?.().catch(() => {});
      clean = [400, 404, 405, 415, 422, 501].includes(res.status); // a 500, a 429 or a timeout is a failure, not a "no"
    }
  } catch (err) {
    if (err instanceof McpError && err.code === 'mcp.needsSignIn') throw err;
    if (err?.name === 'AbortError') throw err;
    /* a server that cannot be reached for the handshake is used as before, and asked again next time */
  }
  if (clean) sessions.set(key, state);
  return state;
}

/** What the connector said about itself in the handshake (L-1), cut to 2,000 characters. */
export const connectorInstructions = (server) => sessions.get(sessionKey(server, String(server?.url ?? '').trim()))?.instructions ?? '';
/** The session is gone (the server forgot it): the next request starts a new one. */
export const forgetSession = (server) => { sessions.delete(sessionKey(server, String(server?.url ?? '').trim())); };

/** @param {{name: string, url: string, headers?: object}} server */
export async function callTool(server, { name, arguments: args = {}, timeoutMs = 30_000, fetchImpl = globalThis.fetch, auth = null, signal = null }) {
  const url = String(server?.url ?? '').trim();
  if (!url) throw new McpError('This MCP server has no address', 'mcp.noUrl');
  if (!/^https?:\/\//i.test(url)) throw new McpError('An MCP server must be reached over http or https', 'mcp.badUrl');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // R-7: the person's Stop ends the call at once
  let stopped = false;
  const onStop = () => { stopped = true; controller.abort(); };
  if (signal?.aborted) onStop(); else signal?.addEventListener('abort', onStop, { once: true });

  try {
    const opts = { signal: controller.signal, auth, fetchImpl };
    await ensureSession(url, server, opts);
    const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } };
    let res = await send(url, server, call, opts);
    if (res.status === 404 && sessions.get(sessionKey(server, url))?.id) { forgetSession(server); await ensureSession(url, server, opts); res = await send(url, server, call, opts); } // the server forgot the session: start one again, once

    if (!res.ok) {
      throw new McpError(`The server answered ${res.status}`, 'mcp.http');
    }
    const payload = await readPayload(res, 1);
    if (payload?.error) {
      throw new McpError(payload.error.message ?? 'The tool failed', 'mcp.toolFailed');
    }
    return payload?.result ?? null;
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (stopped) throw new McpError('Stopped.', 'mcp.cancelled');
    if (err?.name === 'AbortError') throw new McpError('The server did not answer in time', 'mcp.timeout');
    throw new McpError(err.message ?? 'The server could not be reached', 'mcp.unreachable');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onStop);
  }
}

/** The tools a server offers. */
export async function listTools(server, { timeoutMs = 15_000, fetchImpl = globalThis.fetch, auth = null } = {}) {
  const url = String(server?.url ?? '').trim();
  if (!url) throw new McpError('This MCP server has no address', 'mcp.noUrl');
  if (!/^https?:\/\//i.test(url)) throw new McpError('An MCP server must be reached over http or https', 'mcp.badUrl');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const opts = { signal: controller.signal, auth, fetchImpl };
    await ensureSession(url, server, opts);
    // R-5: a server with a long list sends it in pages; follow nextCursor (at most MAX_PAGES = 100 pages)
    const tools = [];
    let cursor = null;
    let truncated = false;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const list = { jsonrpc: '2.0', id: 1 + page, method: 'tools/list', params: cursor ? { cursor } : {} };
      let res = await send(url, server, list, opts);
      if (page === 0 && res.status === 404 && sessions.get(sessionKey(server, url))?.id) { forgetSession(server); await ensureSession(url, server, opts); res = await send(url, server, list, opts); }
      if (!res.ok) throw new McpError(`The server answered ${res.status}`, 'mcp.http');
      const payload = await readPayload(res, list.id);
      if (payload?.error) throw new McpError(payload.error.message ?? 'The server refused', 'mcp.refused');
      tools.push(...(payload?.result?.tools ?? []));
      cursor = payload?.result?.nextCursor || null;
      if (!cursor) break;
      if (tools.length >= MAX_TOOLS || page === MAX_PAGES - 1) { truncated = true; break; }
    }
    const cleaned = tools.slice(0, MAX_TOOLS).map((t) => ({
      name: t.name,
      description: String(t.description ?? '').slice(0, 1000),
      inputSchema: cleanSchema(t.inputSchema),
      readOnlyHint: t.annotations?.readOnlyHint === true, // what the server SAYS: a suggestion only (RO-1)
      readOnly: false,
    }));
    if (truncated) Object.defineProperty(cleaned, 'truncated', { value: true });
    return cleaned;
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err?.name === 'AbortError') throw new McpError('The server did not answer in time', 'mcp.timeout');
    throw new McpError(err.message ?? 'The server could not be reached', 'mcp.unreachable');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a JSON-RPC answer.
 *
 * A streamable HTTP server may answer with plain JSON or with a single
 * server-sent event; both are handled.
 */
export const MAX_ANSWER_BYTES = 5 * 1024 * 1024;
/** R-5: a tool list is followed for at most this many pages and tools; past that the answer says it is cut (truncated). */
export const MAX_PAGES = 100;
export const MAX_TOOLS = 1000;

/** The body of a connector's answer as text, refusing more than about 5 MB (up to 100 pages of a tool list could otherwise fill the memory). */
async function readCapped(res, limit = MAX_ANSWER_BYTES) {
  const tooBig = () => new McpError('The connector answered with more than 5 MB, which is too much to read.', 'mcp.tooLarge');
  if (Number(res.headers.get('content-length')) > limit) { await res.body?.cancel?.().catch(() => {}); throw tooBig(); }
  if (!res.body?.getReader) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel().catch(() => {}); throw tooBig(); }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function readPayload(res, wantedId = null) {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/event-stream')) {
    const text = await readCapped(res);
    // R-6: progress and log notifications may come first; the answer is the message with our request id (or, with none, the first with a result or error)
    const messages = [];
    for (const part of text.split('\n\n')) {
      const data = part.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).join('');
      if (!data) continue;
      try { messages.push(JSON.parse(data)); } catch { /* a frame that is not JSON is not the answer */ }
    }
    const answer = messages.find((x) => wantedId !== null && x?.id === wantedId && ('result' in x || 'error' in x))
      ?? messages.find((x) => x && !x.method && ('result' in x || 'error' in x));
    if (!answer) throw new McpError('The server sent no answer', 'mcp.empty');
    return answer;
  }
  const text = await readCapped(res);
  if (!text.trim()) throw new McpError('The server sent no answer', 'mcp.empty');
  try {
    return JSON.parse(text);
  } catch {
    throw new McpError('The server sent something that is not JSON', 'mcp.malformed');
  }
}

/**
 * W4-11 R-3: a function name an OpenAI-compatible endpoint accepts: only letters, digits, _ and -, at most 64 characters.
 * An MCP tool name may hold dots or slashes and the prefix takes up to 24 characters, so the real name is cleaned and, when it is too long,
 * cut with a short hash of the whole name (so two long names that start alike stay apart). The real name stays in the tool index.
 */
export function functionName(prefix, name) {
  const joined = `${prefix ? `${prefix}__` : ''}${name}`;
  const clean = joined.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (clean.length <= 64) return clean;
  let h = 5381;
  for (const ch of joined) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  const tag = h.toString(36).padStart(7, '0').slice(-7);
  return clean.slice(0, 56) + '_' + tag;
}

/** The tool definitions an OpenAI-compatible endpoint expects. */
export function toToolDefinitions(tools, { prefix } = {}) {
  return (tools ?? []).map((tool) => ({
    type: 'function',
    function: {
      name: functionName(prefix, tool.name),
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}

/**
 * W4-11 R-4: the definitions of every connector at once, with names that are unique (a second connector of the same name, or two tool names
 * that clean to the same text, get _2, _3 ...) and an index from each offered name back to its server and real tool.
 * A provider refuses a request with two functions of the same name, so one duplicate would break every message.
 */
export function connectorTools(servers, { planMode = false } = {}) {
  const definitions = [];
  const index = new Map();
  const usedPrefixes = new Set();
  for (const server of servers ?? []) {
    const base = toolPrefix(server.name) || 'connector';
    let prefix = base;
    for (let n = 2; usedPrefixes.has(prefix); n += 1) prefix = `${base.slice(0, 20)}_${n}`;
    usedPrefixes.add(prefix);
    for (const tool of server.tools ?? []) {
      if (planMode && !isReadOnlyTool(server, tool)) continue;
      const definition = toToolDefinitions([tool], { prefix })[0];
      let name = definition.function.name;
      for (let n = 2; index.has(name); n += 1) name = `${definition.function.name.slice(0, 60)}_${n}`;
      definition.function.name = name;
      definitions.push(definition);
      index.set(name, { server, tool });
    }
  }
  return { definitions, index };
}

/**
 * D-1: a connector's answer as text for the model. Not the raw JSON-RPC (text inside JSON escapes), but the text parts joined, resources and
 * links as short lines, structuredContent as indented JSON when there is no text, and an error marked as one ({ text, isError }).
 */
export function mcpResultText(result, { vision = false } = {}) {
  if (result === null || result === undefined) return { text: '(the tool returned nothing)', isError: false, images: [] };
  if (typeof result !== 'object') return { text: String(result), isError: false, images: [] };
  const parts = Array.isArray(result.content) ? result.content : [];
  const lines = [];
  const images = []; // D-2: data addresses of pictures a model that can see is shown after the answer
  const MAX_PICTURE_BYTES = 4 * 1024 * 1024;
  for (const p of parts) {
    if (p?.type === 'text' && typeof p.text === 'string') lines.push(p.text);
    else if (p?.type === 'resource' && p.resource) lines.push(typeof p.resource.text === 'string' ? p.resource.text : `[resource: ${p.resource.uri ?? 'no address'}${p.resource.mimeType ? `, ${p.resource.mimeType}` : ''}]`);
    else if (p?.type === 'resource_link') lines.push(`[link: ${p.name ?? ''} ${p.uri ?? ''}]`.replace(/\s+\]/, ']'));
    else if (p?.type === 'image') {
      const bytes = Math.round(String(p.data ?? '').length * 0.75);
      const ok = vision && images.length < 2 && /^image\/(png|jpe?g|gif|webp)$/i.test(String(p.mimeType ?? '')) && /^[A-Za-z0-9+/=]+$/.test(String(p.data ?? '')) && bytes > 0 && bytes <= MAX_PICTURE_BYTES;
      if (ok) images.push(`data:${String(p.mimeType).toLowerCase()};base64,${p.data}`);
      lines.push(`[image${p.mimeType ? `: ${p.mimeType}` : ''}, ${Math.round(bytes / 1024)} KB, ${ok ? 'shown after this answer' : 'not shown here'}]`);
    }
    else if (p?.type === 'audio') lines.push('[audio, not shown here]');
    else if (p) lines.push(JSON.stringify(p));
  }
  let text = lines.join('\n');
  if (!text.trim() && result.structuredContent !== undefined) text = JSON.stringify(result.structuredContent, null, 2);
  if (!text.trim() && !('content' in result) && !('isError' in result)) text = JSON.stringify(result, null, 2);
  if (!text.trim()) text = '(the tool returned no text)';
  const isError = result.isError === true;
  return { text: isError ? `The tool reported an error: ${text}` : text, isError, images };
}

/**
 * RO-1: does this tool only read? Not because the server says so (a hostile connector can label a write tool as reading, which would skip the
 * question in Ask mode and offer it in Plan mode), but because the person marked the connector as one whose labels they trust.
 */
export const isReadOnlyTool = (server, tool) => server?.trustReadOnly === true
  && (tool?.readOnlyHint === true || tool?.readOnly === true)
  // only a tool that was in the list when the person trusted it, with that same label: a new tool, or a label that changed to "read only", is not trusted
  && server.trustedTools?.[tool.name] === true;

/** The tools (and whether each said it only reads) at the moment the person trusts a connector's labels. */
export const trustSnapshot = (tools) => Object.fromEntries((tools ?? []).map((t) => [t.name, t.readOnlyHint === true || t.readOnly === true]));

/** Does the connector's list now hold anything the person's trust did not cover: a new tool, or one that now says it only reads? */
export const outsideTrust = (server, tools) => (tools ?? []).some((t) => !(t.name in (server?.trustedTools ?? {})) || ((t.readOnlyHint === true || t.readOnly === true) && server.trustedTools[t.name] !== true));

/**
 * L-3: when to ask a connector for its tools again. Never listed: now (unless it is marked as failed). Listed more than an hour ago: again, in case it
 * changed. A remote connector that failed is tried again, once per reply, with a short wait; a local one is not (starting a program can take minutes).
 */
export const TOOL_LIST_MAX_AGE_MS = 60 * 60 * 1000;
export const RETRY_FAILED_MS = 4000;
export function relistReason(server, now = Date.now()) {
  if (!server?.tools?.length && server?.status !== 'error') return 'new';
  if (server?.status === 'error' && server.type !== 'local') return 'retry';
  if (server?.tools?.length && server.checkedAt && now - Date.parse(server.checkedAt) > TOOL_LIST_MAX_AGE_MS) return 'stale';
  return null;
}

/** R-8: a tool's input schema in the form providers accept: an object with a type, without $schema. */
export function cleanSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return { type: 'object', properties: {} };
  const { $schema, ...rest } = schema;
  return { ...rest, type: 'object', properties: rest.properties && typeof rest.properties === 'object' ? rest.properties : {} };
}

/** A tool name prefix that is safe to use in a function name. */
export function toolPrefix(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

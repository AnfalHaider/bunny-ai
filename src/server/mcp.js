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
  for (let attempt = 0; ; attempt++) {
    const extra = auth ? ((await auth({ refresh: attempt > 0 })) ?? {}) : {};
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
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

/** @param {{name: string, url: string, headers?: object}} server */
export async function callTool(server, { name, arguments: args = {}, timeoutMs = 30_000, fetchImpl = globalThis.fetch, auth = null }) {
  const url = String(server?.url ?? '').trim();
  if (!url) throw new McpError('This MCP server has no address', 'mcp.noUrl');
  if (!/^https?:\/\//i.test(url)) throw new McpError('An MCP server must be reached over http or https', 'mcp.badUrl');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await send(url, server, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      { signal: controller.signal, auth, fetchImpl });

    if (!res.ok) {
      throw new McpError(`The server answered ${res.status}`, 'mcp.http');
    }
    const payload = await readPayload(res);
    if (payload?.error) {
      throw new McpError(payload.error.message ?? 'The tool failed', 'mcp.toolFailed');
    }
    return payload?.result ?? null;
  } catch (err) {
    if (err instanceof McpError) throw err;
    if (err?.name === 'AbortError') throw new McpError('The server did not answer in time', 'mcp.timeout');
    throw new McpError(err.message ?? 'The server could not be reached', 'mcp.unreachable');
  } finally {
    clearTimeout(timer);
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
    const res = await send(url, server, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { signal: controller.signal, auth, fetchImpl });

    if (!res.ok) throw new McpError(`The server answered ${res.status}`, 'mcp.http');
    const payload = await readPayload(res);
    if (payload?.error) throw new McpError(payload.error.message ?? 'The server refused', 'mcp.refused');
    const tools = payload?.result?.tools ?? [];
    return tools.map((t) => ({
      name: t.name,
      description: String(t.description ?? '').slice(0, 400),
      inputSchema: t.inputSchema ?? null,
      readOnly: t.annotations?.readOnlyHint === true,
    }));
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
async function readPayload(res) {
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/event-stream')) {
    const text = await res.text();
    const frame = text.split('\n\n').find((part) => part.includes('data:'));
    if (!frame) throw new McpError('The server sent no answer', 'mcp.empty');
    const data = frame.split('\n').filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim()).join('');
    return JSON.parse(data);
  }
  const text = await res.text();
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
      if (planMode && !tool.readOnly) continue;
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
 * PV-2: a provider takes at most about 128 tools, and a long tool list costs context on every turn. Over the limit (100 tools or 20,000 characters
 * of definitions), only the built-in tools are offered, with two small tools: list_connector_tools (what a connector can do) and call_connector_tool
 * (call one by name). Every connector tool stays reachable; none is dropped.
 */
export const META_TOOLS = ['list_connector_tools', 'call_connector_tool'];
export function capTools(definitions, index, { maxTools = 100, maxChars = 20_000 } = {}) {
  const chars = JSON.stringify(definitions).length;
  if (definitions.length <= maxTools && chars <= maxChars) return { definitions, deferred: new Map() };
  const offered = definitions.filter((d) => !index.has(d.function.name));
  const deferred = new Map();
  for (const d of definitions) if (index.has(d.function.name)) deferred.set(d.function.name, d);
  offered.push(
    { type: 'function', function: { name: 'list_connector_tools', description: `Connector tools are not all listed here (there are ${deferred.size}). Call this to see the tools of the connectors, optionally only those whose name or description contains the text given. Then use call_connector_tool.`, parameters: { type: 'object', properties: { match: { type: 'string', description: 'Optional text to look for in names and descriptions' } } } } },
    { type: 'function', function: { name: 'call_connector_tool', description: 'Call one connector tool by the exact name list_connector_tools gave, with its arguments.', parameters: { type: 'object', properties: { name: { type: 'string' }, arguments: { type: 'object' } }, required: ['name'] } } },
  );
  return { definitions: offered, deferred };
}

/** The text list_connector_tools answers with. */
export function describeDeferred(deferred, match = '') {
  const q = String(match ?? '').toLowerCase();
  const rows = [...deferred.values()].filter((d) => !q || `${d.function.name} ${d.function.description ?? ''}`.toLowerCase().includes(q));
  if (!rows.length) return 'No connector tool matches.';
  return rows.slice(0, 60).map((d) => `${d.function.name}: ${String(d.function.description ?? '').slice(0, 160)}`).join('\n') + (rows.length > 60 ? `\n… ${rows.length - 60} more: narrow it with match.` : '');
}

/**
 * D-1: a connector's answer as text for the model. Not the raw JSON-RPC (text inside JSON escapes), but the text parts joined, resources and
 * links as short lines, structuredContent as indented JSON when there is no text, and an error marked as one ({ text, isError }).
 */
export function mcpResultText(result) {
  if (result === null || result === undefined) return { text: '(the tool returned nothing)', isError: false };
  if (typeof result !== 'object') return { text: String(result), isError: false };
  const parts = Array.isArray(result.content) ? result.content : [];
  const lines = [];
  for (const p of parts) {
    if (p?.type === 'text' && typeof p.text === 'string') lines.push(p.text);
    else if (p?.type === 'resource' && p.resource) lines.push(typeof p.resource.text === 'string' ? p.resource.text : `[resource: ${p.resource.uri ?? 'no address'}${p.resource.mimeType ? `, ${p.resource.mimeType}` : ''}]`);
    else if (p?.type === 'resource_link') lines.push(`[link: ${p.name ?? ''} ${p.uri ?? ''}]`.replace(/\s+\]/, ']'));
    else if (p?.type === 'image') lines.push(`[image${p.mimeType ? `: ${p.mimeType}` : ''}, ${Math.round(String(p.data ?? '').length * 0.75 / 1024)} KB, not shown here]`);
    else if (p?.type === 'audio') lines.push('[audio, not shown here]');
    else if (p) lines.push(JSON.stringify(p));
  }
  let text = lines.join('\n');
  if (!text.trim() && result.structuredContent !== undefined) text = JSON.stringify(result.structuredContent, null, 2);
  if (!text.trim() && !('content' in result) && !('isError' in result)) text = JSON.stringify(result, null, 2);
  if (!text.trim()) text = '(the tool returned no text)';
  const isError = result.isError === true;
  return { text: isError ? `The tool reported an error: ${text}` : text, isError };
}

/** A tool name prefix that is safe to use in a function name. */
export function toolPrefix(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

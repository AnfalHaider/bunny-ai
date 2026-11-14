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
  constructor(message, code = 'mcp.failed') {
    super(message);
    this.code = code;
  }
}

/** @param {{name: string, url: string, headers?: object}} server */
export async function callTool(server, { name, arguments: args = {}, timeoutMs = 30_000, fetchImpl = globalThis.fetch }) {
  const url = String(server?.url ?? '').trim();
  if (!url) throw new McpError('This MCP server has no address', 'mcp.noUrl');
  if (!/^https?:\/\//i.test(url)) throw new McpError('An MCP server must be reached over http or https', 'mcp.badUrl');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(server.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: args },
      }),
      signal: controller.signal,
    });

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
export async function listTools(server, { timeoutMs = 15_000, fetchImpl = globalThis.fetch } = {}) {
  const url = String(server?.url ?? '').trim();
  if (!url) throw new McpError('This MCP server has no address', 'mcp.noUrl');
  if (!/^https?:\/\//i.test(url)) throw new McpError('An MCP server must be reached over http or https', 'mcp.badUrl');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(server.headers ?? {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
      signal: controller.signal,
    });

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

/** The tool definitions an OpenAI-compatible endpoint expects. */
export function toToolDefinitions(tools, { prefix } = {}) {
  return (tools ?? []).map((tool) => ({
    type: 'function',
    function: {
      name: `${prefix ? `${prefix}__` : ''}${tool.name}`,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    },
  }));
}

/** A tool name prefix that is safe to use in a function name. */
export function toolPrefix(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}

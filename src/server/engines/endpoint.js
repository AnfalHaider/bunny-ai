/**
 * CLI-ENGINES §2 (CE-4): Bunny's local model endpoint for an engine in LOCAL mode. One listener per run, on 127.0.0.1 and port 0 (never 0.0.0.0), separate from the window's server and the
 * device server, closed when the run ends, on Stop and when Bunny quits.
 *
 * Every request must carry: the exact Host `127.0.0.1:<port>`; NO Origin and no Sec-Fetch-* header (a web page always sends one or the other); the run's token (randomBytes(32), compared with
 * timingSafeEqual, in Authorization: Bearer or x-api-key); JSON no bigger than the limit; and a listed path. Anything else gets a 403 with no detail. No CORS headers, always no-store.
 * At most 4 requests at once. The model name the CLI sends is IGNORED: the answer comes from the chat's provider and model, through `upstream`. No key, no upstream header and no
 * secret-looking error text ever reaches the CLI.
 *
 *   POST /v1/responses          Codex: translated to Chat Completions and back (translate/responses.js)
 *   POST /v1/messages           Claude Code: translated to Chat Completions and back (translate/messages.js); /v1/messages/count_tokens is a rough count
 *   POST /v1/chat/completions   Aider: passed on
 *   GET  /v1/models             one entry: the chat's model label
 *
 * `upstream({ chat, signal })` is given by the app: it sends a Chat Completions request (always streamed) to the chat's provider through the existing fetch path and yields parsed chunks.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { looksSecret } from '../secretLike.js';
import { ResponsesRequestError, createResponsesStream, offeredToolNames, responsesToChat, sseLine } from './translate/responses.js';
import { MessagesRequestError, createMessagesStream, estimateInputTokens, messagesFromChat, messagesToChat, offeredToolNames as messageToolNames, sseLine as messagesSse } from './translate/messages.js';

export const MAX_REQUEST_BYTES = 48 * 1024 * 1024;
export const MAX_CONCURRENT = 4;
const SECURITY_HEADERS = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

/** A sentence for the CLI from an upstream failure: never one that looks like it holds a secret. */
export function safeMessage(err) {
  const raw = String(err?.message ?? err ?? 'The model could not be reached.');
  if (looksSecret(raw)) return 'The model provider answered with an error (the details are not passed on).';
  return raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
}

/** Aggregate Chat Completions chunks into one answer (for a non-streamed request). */
export async function chatFromChunks(chunks) {
  let content = ''; let reasoning = ''; const calls = new Map(); let finish = 'stop'; let usage = null;
  for await (const c of chunks) {
    const ch = c?.choices?.[0];
    if (c?.usage) usage = c.usage;
    if (ch?.delta?.content) content += ch.delta.content;
    if (ch?.delta?.reasoning_content) reasoning += ch.delta.reasoning_content;
    for (const t of ch?.delta?.tool_calls ?? []) {
      const i = Number.isInteger(t.index) ? t.index : 0;
      const cur = calls.get(i) ?? { id: t.id, type: 'function', function: { name: '', arguments: '' } };
      if (t.id) cur.id = t.id;
      if (t.function?.name) cur.function.name = t.function.name;
      if (t.function?.arguments) cur.function.arguments += t.function.arguments;
      calls.set(i, cur);
    }
    if (ch?.finish_reason) finish = ch.finish_reason;
  }
  const message = { role: 'assistant', content: content || (calls.size ? null : '') };
  if (reasoning) message.reasoning_content = reasoning;
  if (calls.size) message.tool_calls = [...calls.values()];
  return { id: 'chatcmpl-bunny', object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: 'bunny', choices: [{ index: 0, message, finish_reason: finish }], usage: usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
}

export function createEndpoint({ upstream, label = 'bunny', onToolList = null, onUsage = null, onRequest = null, maxBytes = MAX_REQUEST_BYTES, maxConcurrent = MAX_CONCURRENT } = {}) {
  const token = randomBytes(32).toString('hex');
  const tokenBuf = Buffer.from(token);
  const controllers = new Set();
  let server = null; let port = 0; let closed = false; let active = 0;
  const stats = { requests: 0, refused: 0 };

  const refuse = (res, status = 403) => {
    stats.refused += 1;
    res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json' });
    res.end('{}');
  };
  const json = (res, status, body) => { res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };

  const tokenOk = (req) => {
    const auth = String(req.headers.authorization ?? '');
    const candidate = /^Bearer (.+)$/i.exec(auth)?.[1] ?? String(req.headers['x-api-key'] ?? '');
    const buf = Buffer.from(candidate);
    return buf.length === tokenBuf.length && timingSafeEqual(buf, tokenBuf);
  };

  const readBody = (req) => new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes) { reject(Object.assign(new Error('too big'), { status: 413 })); return; }
    const parts = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > maxBytes) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); return; } parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });

  async function handleResponses(res, request, signal) {
    let converted;
    try { converted = responsesToChat(request); } catch (err) {
      if (err instanceof ResponsesRequestError) return json(res, err.status, { error: { type: 'invalid_request_error', message: err.message } });
      throw err;
    }
    if (onToolList) {
      const verdict = onToolList(offeredToolNames(request));
      if (verdict && verdict !== true) return json(res, 400, { error: { type: 'invalid_request_error', message: typeof verdict === 'string' ? verdict : 'The engine offered a tool Bunny does not allow.' } });
    }
    const wantsStream = request.stream !== false;
    const conv = createResponsesStream({ model: label, customNames: converted.customNames });
    if (!wantsStream) {
      try {
        const chat = await chatFromChunks(upstream({ chat: converted.chat, signal }));
        const stream = createResponsesStream({ model: label, customNames: converted.customNames });
        const message = chat.choices[0].message;
        stream.push({ choices: [{ delta: { content: message.content ?? undefined, reasoning_content: message.reasoning_content, tool_calls: (message.tool_calls ?? []).map((c, i) => ({ index: i, id: c.id, function: c.function })) }, finish_reason: chat.choices[0].finish_reason }], usage: chat.usage });
        const events = stream.finish();
        onUsage?.(stream.usage);
        return json(res, 200, events.at(-1).response);
      } catch (err) { return json(res, 502, { error: { type: 'upstream_error', message: safeMessage(err) } }); }
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
    let failure = null;
    try {
      for await (const chunk of upstream({ chat: converted.chat, signal })) {
        if (signal.aborted) break;
        for (const ev of conv.push(chunk)) res.write(sseLine(ev));
      }
    } catch (err) { failure = safeMessage(err); }
    if (!signal.aborted) {
      for (const ev of conv.finish({ error: failure })) res.write(sseLine(ev));
      onUsage?.(conv.usage);
    }
    res.end();
    return undefined;
  }

  async function handleMessages(res, request, signal) {
    let converted;
    try { converted = messagesToChat(request); } catch (err) {
      if (err instanceof MessagesRequestError) return json(res, err.status, { type: 'error', error: { type: 'invalid_request_error', message: err.message } });
      throw err;
    }
    if (onToolList) {
      const verdict = onToolList(messageToolNames(request));
      if (verdict && verdict !== true) return json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: typeof verdict === 'string' ? verdict : 'The engine offered a tool Bunny does not allow.' } });
    }
    const inputGuess = estimateInputTokens(request);
    if (request.stream !== true) {
      try {
        const chat = await chatFromChunks(upstream({ chat: converted.chat, signal }));
        onUsage?.({ input: chat.usage.prompt_tokens ?? 0, output: chat.usage.completion_tokens ?? 0 });
        return json(res, 200, messagesFromChat(chat, { model: label }));
      } catch (err) { return json(res, 502, { type: 'error', error: { type: 'api_error', message: safeMessage(err) } }); }
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
    const conv = createMessagesStream({ model: label, inputTokens: inputGuess });
    let failure = null;
    try {
      for await (const chunk of upstream({ chat: converted.chat, signal })) {
        if (signal.aborted) break;
        for (const ev of conv.push(chunk)) res.write(messagesSse(ev));
      }
    } catch (err) { failure = safeMessage(err); }
    if (!signal.aborted) {
      for (const ev of conv.finish({ error: failure })) res.write(messagesSse(ev));
      onUsage?.(conv.usage);
    }
    res.end();
    return undefined;
  }

  async function handleChat(res, request, signal) {
    if (!request || typeof request !== 'object' || !Array.isArray(request.messages)) return json(res, 400, { error: { type: 'invalid_request_error', message: 'The request has no messages.' } });
    const chat = { ...request, stream: true };
    delete chat.model; // the model is the chat's, never the CLI's
    delete chat.stream_options;
    const wantsStream = request.stream === true;
    if (!wantsStream) {
      try { const whole = await chatFromChunks(upstream({ chat, signal })); onUsage?.({ input: whole.usage.prompt_tokens, output: whole.usage.completion_tokens }); return json(res, 200, { ...whole, model: label }); } catch (err) { return json(res, 502, { error: { type: 'upstream_error', message: safeMessage(err) } }); }
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive' });
    let usage = null;
    try {
      for await (const chunk of upstream({ chat, signal })) {
        if (signal.aborted) break;
        if (chunk?.usage) usage = chunk.usage;
        res.write(`data: ${JSON.stringify({ ...chunk, model: label })}\n\n`);
      }
    } catch (err) { res.write(`data: ${JSON.stringify({ error: { type: 'upstream_error', message: safeMessage(err) } })}\n\n`); }
    res.write('data: [DONE]\n\n');
    if (usage) onUsage?.({ input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 });
    res.end();
    return undefined;
  }

  async function handle(req, res) {
    // 1-3: who may call
    const url = (() => { try { return new URL(req.url, 'http://x'); } catch { return null; } })();
    if (!url) return refuse(res);
    if (req.headers.host !== `127.0.0.1:${port}`) return refuse(res);
    if (req.headers.origin !== undefined) return refuse(res);
    if (Object.keys(req.headers).some((h) => h.startsWith('sec-fetch-'))) return refuse(res);
    if (!tokenOk(req)) return refuse(res);
    const path = url.pathname;
    const method = req.method ?? 'GET';
    const known = (method === 'POST' && ['/v1/responses', '/v1/messages', '/v1/messages/count_tokens', '/v1/chat/completions'].includes(path)) || (method === 'GET' && path === '/v1/models');
    if (!known) { res.writeHead(404, { ...SECURITY_HEADERS, 'content-type': 'application/json' }); res.end('{}'); return undefined; }
    if (active >= maxConcurrent) return refuse(res, 429);
    active += 1; stats.requests += 1;
    const control = new AbortController(); controllers.add(control);
    res.on('close', () => { if (!res.writableEnded) control.abort(); });
    try {
      onRequest?.({ method, path });
      if (method === 'GET') return json(res, 200, { object: 'list', data: [{ id: label, object: 'model', created: 0, owned_by: 'bunny' }] });
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (err) { return json(res, err.status === 413 ? 413 : 400, { error: { type: 'invalid_request_error', message: err.status === 413 ? 'The request is too big.' : 'The request is not JSON.' } }); }
      if (path === '/v1/responses') return await handleResponses(res, body, control.signal);
      if (path === '/v1/messages/count_tokens') return json(res, 200, { input_tokens: estimateInputTokens(body) });
      if (path === '/v1/messages') return await handleMessages(res, body, control.signal);
      return await handleChat(res, body, control.signal);
    } catch (err) {
      if (!res.headersSent) json(res, 500, { error: { type: 'server_error', message: safeMessage(err) } }); else res.end();
      return undefined;
    } finally { active -= 1; controllers.delete(control); }
  }

  return {
    token, stats,
    /** Listen on 127.0.0.1, port 0. Resolves { port, base, token }. */
    async start() {
      if (server) throw new Error('already started');
      server = createServer((req, res) => { handle(req, res); });
      server.headersTimeout = 60_000;
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      port = server.address().port;
      return { port, base: `http://127.0.0.1:${port}/v1`, token };
    },
    get port() { return port; },
    get closed() { return closed; },
    /** Close the listener and end every request in flight. */
    async close() {
      if (closed) return;
      closed = true;
      for (const c of controllers) c.abort();
      if (server) await new Promise((r) => { server.close(() => r()); server.closeAllConnections?.(); });
    },
  };
}

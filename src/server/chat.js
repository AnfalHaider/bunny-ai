/**
 * Streaming chat against any OpenAI-compatible endpoint.
 *
 * Yields text deltas. The caller decides how to present them. A fake upstream
 * exists so the whole app can be exercised, and tested, without a real key.
 *
 * When tools are offered, the model may ask for one. The tool is run, its
 * result is put back into the conversation, and the model answers again — all
 * inside the same stream, so the person sees one continuous reply.
 */

import { ConnectError } from '../providers/errors.js';

const MAX_TOOL_ROUNDS = 4;

// How long a provider may stay silent before the chat gives up on it. Slow
// "thinking" models still stream keep-alives or their first token well within
// this; the providers that accept a request and never answer do not.
const DEFAULT_STALL_MS = 120_000;

/**
 * @param {{
 *   baseUrl: string,
 *   apiKey?: string,
 *   model: string,
 *   messages: Array<{role: string, content: any}>,
 *   signal?: AbortSignal,
 *   fetchImpl?: typeof fetch,
 *   fake?: boolean,
 *   tools?: Array<object> | null,
 *   runTool?: (call: {name: string, arguments: object}) => Promise<string>
 * }} opts
 * @returns {AsyncGenerator<string>}
 */
export async function* streamChat({
  baseUrl, apiKey, model, messages, signal, fetchImpl = globalThis.fetch,
  fake = false, tools = null, runTool = null, maxTokens = 4096, auth = null, stallMs,
}) {
  if (fake) {
    yield* fakeStream(model, messages, signal);
    return;
  }

  const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
    if (auth?.header) headers[auth.header] = apiKey;
    if (auth?.extra) Object.assign(headers, auth.extra);
  }

  // The conversation grows as tools are used, so it is copied rather than
  // mutated in place.
  const conversation = messages.map((m) => ({ ...m }));
  const offerTools = Array.isArray(tools) && tools.length > 0 && typeof runTool === 'function';

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const body = { model, messages: conversation, stream: true };
    // Without a limit, some providers assume the largest window the model
    // supports and refuse the request when the balance cannot cover it.
    if (maxTokens) body.max_tokens = maxTokens;
    if (offerTools) body.tools = tools;

    const { text, toolCalls } = yield* streamRound({
      baseUrl, headers, body, signal, fetchImpl, stallMs,
    });

    if (!offerTools || !toolCalls.length) return;

    // Run what the model asked for and put the answers back into the
    // conversation, so the model can finish its answer.
    conversation.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
    for (const call of toolCalls) {
      let result = '';
      try {
        result = await runTool({
          name: call.function.name,
          arguments: call.function.arguments,
        });
      } catch (err) {
        result = `The tool failed: ${err.message}`;
      }
      conversation.push({ role: 'tool', tool_call_id: call.id, content: String(result).slice(0, 8000) });
    }
  }
}

/**
 * What a provider said when it refused.
 *
 * The body is usually a short JSON object with the reason. It is trimmed so
 * the message stays readable, and it never carries the key back.
 */
async function errorDetail(res) {
  try {
    const text = await res.text();
    if (!text) return '';
    let message = text.trim();
    try {
      const parsed = JSON.parse(message);
      message = parsed?.error?.message ?? parsed?.message ?? parsed?.detail
        ?? parsed?.error ?? message;
    } catch {
      // Not JSON: use the text as it is.
    }
    message = String(message).replace(/\s+/g, ' ').trim();
    if (!message) return '';
    return message.length > 240 ? `${message.slice(0, 240)}…` : message;
  } catch {
    return '';
  }
}

/**
 * One round of streaming.
 * @returns {AsyncGenerator<string, {text: string, toolCalls: object[]}>}
 */
async function* streamRound({ baseUrl, headers, body, signal, fetchImpl, stallMs = DEFAULT_STALL_MS }) {
  // The provider can accept the request and then never send a byte. Without a
  // watchdog the chat spins forever, so silence longer than stallMs is an
  // error, not a wait. The person's own stop signal still cuts in first.
  const stallController = new AbortController();
  let stalled = false;
  const forwardAbort = () => stallController.abort();
  if (signal?.aborted) stallController.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });

  let res;
  try {
    res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: stallController.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (stalled) throw new ConnectError('chat.stalled', 'The provider stopped responding');
    if (err?.name === 'AbortError') return { text: '', toolCalls: [] };
    throw new ConnectError('chat.unreachable', `Could not reach ${baseUrl}`);
  }

  let reader = null;
  let buffer = '';
  let text = '';
  const toolCalls = new Map();
  try {
    if (res.status === 401 || res.status === 403) throw new ConnectError('chat.unauthorized', `The provider rejected that key`);
    if (!res.ok) {
      // The provider usually says why in the body. Throwing that away leaves
      // the person with "the provider answered 404" and nothing to act on.
      const detail = await errorDetail(res);
      throw new ConnectError('chat.http', `The provider answered ${res.status}${detail ? `: ${detail}` : ''}`);
    }
    if (!res.body) throw new ConnectError('chat.empty', 'The provider returned no stream');

    reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const timer = setTimeout(() => {
        stalled = true;
        stallController.abort();
      }, stallMs);
      let done;
      let value;
      try {
        ({ done, value } = await reader.read());
      } catch (err) {
        if (stalled) throw new ConnectError('chat.stalled', 'The provider stopped sending data');
        if (err?.name === 'AbortError') return { text: '', toolCalls: [] };
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;

        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return { text, toolCalls: finishCalls(toolCalls) };

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // keep-alive or a comment frame
        }
        const delta = parsed?.choices?.[0]?.delta;
        if (typeof delta?.content === 'string' && delta.content) {
          text += delta.content;
          yield delta.content;
        }
        collectToolCall(toolCalls, delta?.tool_calls);
      }
    }
  } finally {
    reader?.releaseLock?.();
  }

  return { text, toolCalls: finishCalls(toolCalls) };
}

/** Turn the gathered fragments into complete tool calls. */
function finishCalls(toolCalls) {
  return [...toolCalls.values()].map((call) => ({
    id: call.id || `call_${call.name}`,
    type: 'function',
    function: { name: call.name, arguments: call.arguments || '{}' },
  }));
}

/** Gather the fragments of a tool call that arrive over several frames. */
function collectToolCall(into, fragments) {
  if (!Array.isArray(fragments)) return;
  for (const fragment of fragments) {
    const index = fragment?.index ?? 0;
    const existing = into.get(index) ?? { id: '', name: '', arguments: '' };
    if (fragment.id) existing.id = fragment.id;
    if (fragment.function?.name) existing.name += fragment.function.name;
    if (fragment.function?.arguments) existing.arguments += fragment.function.arguments;
    into.set(index, existing);
  }
}

/** Deterministic stand-in so the UI is fully exercisable offline. */
export async function* fakeStream(model, messages, signal) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  // The content may be a list of parts when a picture was attached.
  const content = Array.isArray(last?.content)
    ? last.content.map((part) => part.text ?? '').join(' ')
    : String(last?.content ?? '');
  const reply = [
    `This is a local test reply from ${model || 'a model'}.`,
    '',
    `**You said:** ${content}`,
    '',
    '```js',
    'console.log("hello from the test reply");',
    '```',
  ].join('\n');
  for (const word of reply.split(/(\s+)/)) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, 8));
    yield word;
  }
}

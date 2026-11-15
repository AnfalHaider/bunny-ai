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
import { clip } from './clip.js';

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
  maxToolRounds = MAX_TOOL_ROUNDS, extraBody = null, parallel = null, onThinking = null,
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

  // The limit may rise during the reply (Code mode switched on part-way), so it is read each round.
  const roundLimit = () => (typeof maxToolRounds === 'function' ? maxToolRounds() : maxToolRounds);
  for (let round = 0; round < roundLimit(); round += 1) {
    const body = { model, messages: conversation, stream: true };
    // Without a limit, some providers assume the largest window the model
    // supports and refuse the request when the balance cannot cover it.
    if (maxTokens) body.max_tokens = maxTokens;
    if (offerTools) body.tools = tools;
    if (extraBody) Object.assign(body, extraBody);

    let { text, toolCalls, finish, aborted } = yield* streamRound({
      baseUrl, headers, body, signal, fetchImpl, stallMs, onThinking,
    });
    if (aborted) return; // stopped: what arrived is kept, nothing more is asked

    // A thinking model can spend the whole reply limit thinking and stop with
    // nothing to show. Once, ask again with more room before giving up.
    if (!String(text ?? '').trim() && !toolCalls.length && finish === 'length' && !signal?.aborted) {
      const roomier = { ...body, max_tokens: Math.min(32_000, (body.max_tokens || 4096) * 4) };
      ({ text, toolCalls, finish } = yield* streamRound({ baseUrl, headers, body: roomier, signal, fetchImpl, stallMs, onThinking }));
      if (!String(text ?? '').trim() && !toolCalls.length && finish === 'length') {
        throw new ConnectError('chat.tooLong', 'The model used up its whole reply limit before answering. Raise the effort or Max tokens in Settings, or pick another model.');
      }
    }

    // Some models write their tool calls as text instead of asking for them properly.
    // Those are read and run, so the work goes on instead of stopping on a line of markup.
    if (offerTools && !toolCalls.length) {
      const offered = new Set(tools.map((d) => d.function?.name).filter(Boolean));
      const written = parseTextToolCalls(text, offered);
      if (written.length) {
        toolCalls = written;
        text = stripToolMarkup(text);
      }
    }

    if (!offerTools || !toolCalls.length) {
      // Some models use their tools and then stop without a word. Ask once for the answer.
      if (round > 0 && !String(text ?? '').trim()) yield* finalAnswer();
      else if (round === 0 && !String(text ?? '').trim() && !signal?.aborted) {
        throw new ConnectError('chat.empty', 'The model sent back an empty reply. Try again, or pick another model.');
      }
      return;
    }

    // Run what the model asked for and put the answers back into the
    // conversation, so the model can finish its answer.
    conversation.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
    // A tool may answer with pictures too (a screenshot): tool messages carry text
    // only, so the pictures follow the answers as one message the model can see.
    const pictures = [];
    const runOne = async (call) => {
      try {
        return await runTool({ name: call.function.name, arguments: call.function.arguments });
      } catch (err) {
        return `The tool failed: ${err.message}`;
      }
    };
    // Calls that can run side by side (helper agents) do; everything else runs in order,
    // because two edits or two browser steps at once would trip over each other.
    const together = typeof parallel === 'function' && toolCalls.length > 1 && toolCalls.every((c) => parallel(c.function.name));
    const results = together ? await Promise.all(toolCalls.map(runOne)) : [];
    for (const [i, call] of toolCalls.entries()) {
      let result = together ? results[i] : await runOne(call);
      if (result && typeof result === 'object') {
        for (const url of result.images ?? []) pictures.push({ name: call.function.name, url });
        result = result.content ?? '';
      }
      conversation.push({ role: 'tool', tool_call_id: call.id, content: clip(result, 12000) });
    }
    if (pictures.length) {
      conversation.push({
        role: 'user',
        content: [
          { type: 'text', text: `The picture${pictures.length > 1 ? 's' : ''} from ${pictures.map((p) => p.name).join(', ')}:` },
          ...pictures.slice(-2).map((p) => ({ type: 'image_url', image_url: { url: p.url } })),
        ],
      });
    }
  }
  // Out of tool steps: the person still gets an answer from what was found so far.
  if (offerTools) yield* finalAnswer();

  /** One more round without tools, asking for the reply itself. */
  async function* finalAnswer() {
    const body = {
      model, stream: true,
      messages: [...conversation, {
        role: 'user',
        content: 'Stop using tools now and reply to me. Say briefly what you did and found, what is left to do (if anything), '
          + 'and what you need from me (if anything). If work remains, end by telling me to send "continue". Do not call any more tools.',
      }],
    };
    if (maxTokens) body.max_tokens = maxTokens;
    if (extraBody) Object.assign(body, extraBody);
    yield* streamRound({ baseUrl, headers, body, signal, fetchImpl, stallMs, onThinking });
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
async function* streamRound({ baseUrl, headers, body, signal, fetchImpl, stallMs = DEFAULT_STALL_MS, onThinking = null }) {
  // The provider can accept the request and then never send a byte. Without a
  // watchdog the chat spins forever, so silence longer than stallMs is an
  // error, not a wait. The person's own stop signal still cuts in first.
  const stallController = new AbortController();
  let stalled = false;
  const forwardAbort = () => stallController.abort();
  if (signal?.aborted) stallController.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });

  let res;
  // The same watchdog covers the wait for the first answer: without it a provider
  // that takes the request and never replies holds the chat for five minutes.
  const firstTimer = setTimeout(() => { stalled = true; stallController.abort(); }, stallMs);
  try {
    res = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      signal: stallController.signal,
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (stalled) throw new ConnectError('chat.stalled', 'The provider did not answer in time');
    if (err?.name === 'AbortError') return { text: '', toolCalls: [], aborted: true };
    throw new ConnectError('chat.unreachable', `Could not reach ${baseUrl}`);
  } finally {
    clearTimeout(firstTimer);
  }

  let reader = null;
  let buffer = '';
  let text = '';
  let finish = null;
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
        if (err?.name === 'AbortError') return { text: '', toolCalls: [], aborted: true };
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
        if (payload === '[DONE]') return { text, toolCalls: finishCalls(toolCalls), finish };

        let parsed;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue; // keep-alive or a comment frame
        }
        const delta = parsed?.choices?.[0]?.delta;
        if (parsed?.choices?.[0]?.finish_reason) finish = parsed.choices[0].finish_reason;
        // A reasoning model may send its thinking beside the answer (reasoning_content on
        // DeepSeek and Nvidia, reasoning on OpenRouter). It is passed on, never mixed into the reply.
        const thought = delta?.reasoning_content ?? delta?.reasoning;
        if (typeof thought === 'string' && thought && onThinking) onThinking(thought);
        if (typeof delta?.content === 'string' && delta.content) {
          text += delta.content;
          yield delta.content;
        }
        // Image models (OpenRouter) return pictures beside the text: show them in the reply.
        for (const img of Array.isArray(delta?.images) ? delta.images : []) {
          const url = img?.image_url?.url ?? img?.url;
          if (typeof url === 'string' && /^(data:image\/|https:\/\/)/.test(url)) {
            const piece = `

![Generated image](${url})

`;
            text += piece;
            yield piece;
          }
        }
        collectToolCall(toolCalls, delta?.tool_calls);
      }
    }
  } finally {
    reader?.releaseLock?.();
  }

  return { text, toolCalls: finishCalls(toolCalls), finish };
}

/**
 * Tool calls a model wrote into its reply as text, in the two common forms:
 *   <tool_call><function=NAME><parameter=KEY>VALUE</parameter></function></tool_call>
 *   <tool_call>{"name": "NAME", "arguments": {...}}</tool_call>
 * Only tools that were offered are taken.
 */
export function parseTextToolCalls(text, offered) {
  const calls = [];
  const src = String(text ?? '');
  const add = (name, args) => {
    if (!offered.has(name)) return;
    calls.push({ id: `text_call_${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args ?? {}) } });
  };
  for (const m of src.matchAll(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|<\/tool_call>|$)/g)) {
    const args = {};
    for (const p of m[2].matchAll(/<parameter=([\w.-]+)>([\s\S]*?)<\/parameter>/g)) {
      const raw = p[2].replace(/^\n/, '').replace(/\n$/, '');
      try { args[p[1]] = /^[[{]|^(true|false|null|-?\d+(\.\d+)?)$/.test(raw.trim()) ? JSON.parse(raw.trim()) : raw; } catch { args[p[1]] = raw; }
    }
    add(m[1], args);
  }
  if (!calls.length) {
    for (const m of src.matchAll(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g)) {
      try {
        const o = JSON.parse(m[1]);
        const args = typeof o.arguments === 'string' ? JSON.parse(o.arguments) : (o.arguments ?? o.parameters);
        add(o.name, args);
      } catch { /* not a call */ }
    }
  }
  return calls;
}

/** The reply with any written-out tool calls taken away. */
export function stripToolMarkup(text) {
  return String(text ?? '')
    .replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, '')
    .replace(/<function=[\w.-]+>[\s\S]*?(<\/function>|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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

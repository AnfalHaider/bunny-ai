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
import { waitLimits } from './waitLimits.js';

const MAX_TOOL_ROUNDS = 4;

// W6-21: the most characters of one tool result the model reads (it was 8,000 for workspace tools).
export const RESULT_LIMIT = 50_000;

/** A tool result fitted to the limit; what is left out is said, and how to get it. */
export function fitResult(name, text) {
  const s = String(text ?? '');
  if (s.length <= RESULT_LIMIT) return s;
  // W6-21: a result over 128 KB is never saved (the secret check cannot clear something that large), so do not say it is.
  const how = name === 'read_file' ? ' Read the rest with start_line and end_line.'
    : s.length > 128 * 1024 ? ' The whole output is too large to be saved: run the command again with a narrower filter (a path, a pattern, head or tail).'
      : ' The whole output is saved in .bunny/notes (the step says where): read_file it in parts.';
  return `${clip(s, RESULT_LIMIT)}
[Cut to ${RESULT_LIMIT} characters.${how}]`;
}

// How long a provider may stay silent before the chat gives up on it (T-3). Two limits, because they mean
// different things: waiting for the FIRST byte (30 s; 60 s for reasoning models and image or video jobs), and
// silence between chunks once the reply is streaming (60 s). Thinking tokens count as activity. These numbers
// are a starting point and the one place to tune them; tests inject small values with `stallMs`.
export const DEFAULT_STALL_MS = 30_000;
export const SLOW_FIRST_BYTE_MS = 60_000;
export const DEFAULT_GAP_MS = 60_000;
// Reasoning models (o-series, gpt-5, r1, anything named reason or think) and image or video jobs wait longer for a first byte.
const SLOW_MODEL = /reason|think|r1\b|image|video|dall-e|imagen|veo|sora|gpt-5|(^|[/:-])o[1-9](-|$)/i;
export const firstByteLimit = (model, setting) => { const l = waitLimits(setting); return SLOW_MODEL.test(String(model ?? '')) ? l.slowFirstMs : l.firstMs; }; // W4-9: setting = the person's wait, in seconds

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
  fake = false, tools = null, runTool = null, maxTokens = 4096, auth = null, stallMs, waitSeconds: waitSetting,
  maxToolRounds = MAX_TOOL_ROUNDS, extraBody = null, parallel = null, onThinking = null,
  extendRounds = null, contextChars = 0, tokenBudget = 0, onLimit = null,
  onReplyEnd = null,
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
  let cutOffCalls = 0;
  let inputTokens = 0; let repeats = 0; let sinceNew = 0; let lastSig = '';
  const seenCalls = new Set();
  for (let round = 0; ; round += 1) {
    // W6-2: out of steps is not the end of the job. The caller may grant more (up to its own cap) and the work goes on.
    if (round >= roundLimit()) {
      let more = false;
      try { more = typeof extendRounds === 'function' && !signal?.aborted && Boolean(await extendRounds(round)); } catch { more = false; }
      if (!more) break;
    }
    // A long job must not outgrow the model's window: older results and big arguments are shortened, the newest kept whole.
    if (contextChars) shrinkConversation(conversation, contextChars);
    // Limits that need a person: a token budget for the reply, the same step three times in a row, no new step in 25 rounds.
    // The caller asks them (ask_user); "keep going" resets the counters, anything else ends the work with a report.
    if (typeof onLimit === 'function' && round > 0) {
      const kind = tokenBudget && inputTokens >= tokenBudget ? 'tokens' : repeats >= 3 ? 'repeat' : sinceNew >= 25 ? 'stalled' : null;
      if (kind) {
        let go = false;
        let said = '';
        try {
          const r = signal?.aborted ? false : await onLimit({ kind, round, inputTokens, repeats, sinceNew, step: lastSig.split('|')[0] });
          go = Boolean(r);
          if (r && typeof r === 'object' && typeof r.answer === 'string') said = r.answer; // the person's own words go on to the model
        } catch { go = false; }
        if (!go) break;
        if (said) conversation.push({ role: 'user', content: said });
        if (kind === 'tokens') inputTokens = 0;
        repeats = 0; sinceNew = 0; lastSig = '';
      }
    }
    inputTokens += Math.ceil(conversation.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0) / 4);
    const body = { model, messages: conversation, stream: true };
    // Without a limit, some providers assume the largest window the model
    // supports and refuse the request when the balance cannot cover it.
    if (maxTokens) body.max_tokens = maxTokens;
    if (offerTools) body.tools = tools;
    if (extraBody) Object.assign(body, extraBody);

    let { text, toolCalls, finish, aborted, shown } = yield* streamRound({
      baseUrl, headers, body, signal, fetchImpl, stallMs, firstByteMs: stallMs ?? firstByteLimit(model, waitSetting), gapMs: stallMs ?? waitLimits(waitSetting).gapMs, onThinking, hideMarkup: offerTools,
    });
    if (aborted) return; // stopped: what arrived is kept, nothing more is asked

    // A thinking model can spend the whole reply limit thinking and stop with
    // nothing to show. Once, ask again with more room before giving up.
    if (!String(text ?? '').trim() && !toolCalls.length && finish === 'length' && !signal?.aborted) {
      const roomier = { ...body, max_tokens: Math.min(32_000, (body.max_tokens || 4096) * 4) };
      ({ text, toolCalls, finish, shown } = yield* streamRound({ baseUrl, headers, body: roomier, signal, fetchImpl, stallMs, firstByteMs: stallMs ?? firstByteLimit(model, waitSetting), gapMs: stallMs ?? waitLimits(waitSetting).gapMs, onThinking, hideMarkup: offerTools }));
      if (!String(text ?? '').trim() && !toolCalls.length && finish === 'length') {
        throw new ConnectError('chat.tooLong', 'The model used up its whole reply limit before answering. Raise the effort or Max tokens in Settings, or pick another model.');
      }
    }

    // Some models write their tool calls as text instead of asking for them properly.
    // Those are read and run, so the work goes on instead of stopping on a line of markup.
    if (offerTools && !toolCalls.length) {
      const offered = new Set(tools.map((d) => d.function?.name).filter(Boolean));
      // A call for a tool that is not offered is read too, and answered with an error, so it is never left on screen as text.
      const written = parseTextToolCalls(text, null);
      if (written.length) {
        toolCalls = written;
        text = stripToolMarkup(text);
        for (const c of written) c.unoffered = !offered.has(c.function.name);
      } else if (shown < String(text ?? '').length) {
        yield text.slice(shown); // it only looked like a call: show what was held back
      }
    }

    // A call cut off by the reply limit is never run: half a write_file would overwrite a file with half its content.
    // The model is told, and asked to send it again in smaller pieces.
    if (offerTools && toolCalls.length && finish === 'length') {
      const writtenOut = toolCalls.some((c) => String(c.id).startsWith('text_call_'));
      const brokenJson = toolCalls.some((c) => { try { JSON.parse(c.function.arguments || '{}'); return false; } catch { return true; } });
      if (writtenOut || brokenJson) {
        cutOffCalls += 1;
        if (cutOffCalls > 3) throw new ConnectError('chat.tooLong', 'The model kept running out of room in the middle of a tool call. Raise Max tokens in Settings, or pick another model.');
        conversation.push({ role: 'assistant', content: stripToolMarkup(text) || '(cut off)' },
          { role: 'user', content: 'Your last reply hit the length limit in the middle of a tool call, so that call was NOT run. Send it again in smaller pieces: '
            + 'for a big file, write it in several steps (create it with the first part, then add the rest with edit_file or run_command), and keep each call short.' });
        continue;
      }
    }

    if (!offerTools || !toolCalls.length) {
      // Some models use their tools and then stop without a word. Ask once for the answer.
      if (round > 0 && !String(text ?? '').trim()) yield* finalAnswer();
      else if (round === 0 && !String(text ?? '').trim() && !signal?.aborted) {
        if (finish === 'content_filter') throw new ConnectError('chat.refused', 'The model declined to answer.');
        throw new ConnectError('chat.empty', 'The model sent back an empty reply. Try again, or pick another model.');
      }
      // W6-3: a reply that stops to ask permission for work already asked for is turned into "carry on".
      if (offerTools && String(text ?? '').trim() && !signal?.aborted && typeof onReplyEnd === 'function') {
        const nudge = onReplyEnd({ text, round });
        if (nudge) {
          conversation.push({ role: 'assistant', content: text }, { role: 'user', content: nudge });
          continue;
        }
      }
      return;
    }

    // Run what the model asked for and put the answers back into the
    // conversation, so the model can finish its answer.
    conversation.push({ role: 'assistant', content: text || null, tool_calls: toolCalls.map(({ unoffered, ...c }) => c) });
    let fresh = false;
    for (const c of toolCalls) {
      const sig = `${c.function.name}|${c.function.arguments}`;
      repeats = sig === lastSig ? repeats + 1 : 1;
      lastSig = sig;
      if (!seenCalls.has(sig)) { seenCalls.add(sig); fresh = true; }
    }
    sinceNew = fresh ? 0 : sinceNew + 1;
    // A tool may answer with pictures too (a screenshot): tool messages carry text
    // only, so the pictures follow the answers as one message the model can see.
    const pictures = [];
    const offeredNames = new Set((tools ?? []).map((d) => d.function?.name).filter(Boolean));
    const runOne = async (call) => {
      if (call.unoffered) return `There is no tool called ${call.function.name} here. The tools you have: ${[...offeredNames].join(', ')}.`;
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
      conversation.push({ role: 'tool', tool_call_id: call.id, content: clip(result, RESULT_LIMIT) });
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
    yield* streamRound({ baseUrl, headers, body, signal, fetchImpl, stallMs, firstByteMs: stallMs ?? firstByteLimit(model, waitSetting), gapMs: stallMs ?? waitLimits(waitSetting).gapMs, onThinking, hideMarkup: true });
  }
}

/**
 * Keep a long conversation within a size (characters). Newest messages stay whole; older tool results are cut to a short
 * head and tail, and big arguments of older tool calls (a file written in full) are replaced by a short summary (W6-22).
 * Changes the array in place; the first message(s) and the last KEEP_WHOLE messages are never touched.
 */
const KEEP_WHOLE = 16;
export function shrinkConversation(conversation, budget) {
  const size = () => conversation.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length)
    + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);
  if (size() <= budget) return false;
  const limit = conversation.length - KEEP_WHOLE;
  // Pass 1: big arguments of tool calls (a whole file written) become a one-line summary.
  for (let i = 0; i < limit; i += 1) {
    const m = conversation[i];
    if (m.role !== 'assistant' || !m.tool_calls) continue;
    m.tool_calls = m.tool_calls.map((c) => {
      const raw = c.function?.arguments;
      if (typeof raw !== 'string' || raw.length <= 1500) return c;
      let summary;
      try {
        const a = JSON.parse(raw);
        summary = Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? `${v.slice(0, 120)}… (${v.length} characters, left out of the history)` : v]));
      } catch { summary = { note: `${raw.slice(0, 200)}… (${raw.length} characters)` }; }
      return { ...c, function: { ...c.function, arguments: JSON.stringify(summary) } };
    });
  }
  // Pass 2: older tool results, oldest first, until the conversation fits.
  for (let i = 0; i < limit && size() > budget; i += 1) {
    const m = conversation[i];
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > 600) m.content = `${clip(m.content, 600)}
(older result shortened; read the file again if you need it)`;
  }
  // Pass 3: pictures from older messages go.
  for (let i = 0; i < limit && size() > budget; i += 1) {
    const m = conversation[i];
    if (Array.isArray(m.content)) m.content = m.content.filter((p) => p.type !== 'image_url').map((p) => p.text ?? '').join(' ') || '(picture left out)';
  }
  return true;
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

const MARKERS = ['<tool_call', '<function='];
const MARKUP_START = /<tool_call|<function=/;

/**
 * One round of streaming.
 * @returns {AsyncGenerator<string, {text: string, toolCalls: object[]}>}
 */
async function* streamRound({ baseUrl, headers, body, signal, fetchImpl, firstByteMs = DEFAULT_STALL_MS, gapMs = DEFAULT_GAP_MS, onThinking = null, hideMarkup = false }) {
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
  const firstTimer = setTimeout(() => { stalled = true; stallController.abort(); }, firstByteMs);
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
  let shown = 0; // how much of `text` was passed on (all of it, unless a written-out tool call is being held back)
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
      }, gapMs);
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
        if (payload === '[DONE]') return { text, toolCalls: finishCalls(toolCalls), finish, shown };

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
          if (!hideMarkup) { yield delta.content; shown = text.length; } else {
            // W6-4: a written-out tool call is run, not shown: hold text back from its first marker on.
            const at = text.search(MARKUP_START);
            let end = at >= 0 ? at : text.length;
            if (at < 0) { const lt = text.lastIndexOf('<'); if (lt >= text.length - 14 && MARKERS.some((m) => m.startsWith(text.slice(lt)))) end = lt; }
            if (end > shown) { yield text.slice(shown, end); shown = end; }
          }
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

  return { text, toolCalls: finishCalls(toolCalls), finish, shown };
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
    if (offered && !offered.has(name)) return;
    calls.push({ id: `text_call_${calls.length}`, type: 'function', function: { name, arguments: JSON.stringify(args ?? {}) } });
  };
  for (const m of src.matchAll(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|<\/tool_call>|$)/g)) {
    const args = {};
    for (const p of m[2].matchAll(/<parameter=([\w.-]+)>([\s\S]*?)(?:<\/parameter>|(?=<parameter=)|$)/g)) {
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
  // A prompt that asks for a long answer is streamed slowly (a few seconds), so a test can press Stop mid-reply on a busy machine.
  const gap = /long answer/i.test(content) ? 80 : 8;
  for (const word of reply.split(/(\s+)/)) {
    if (signal?.aborted) return;
    await new Promise((r) => setTimeout(r, gap));
    yield word;
  }
}

/**
 * W6-3: does this reply stop to ask permission for the work it was given ("Please confirm that you would like me to...")?
 * A real decision is asked with ask_user, which waits; a closing question like this one is a stop that should not happen.
 */
export function asksPermissionToContinue(text) {
  const tail = String(text ?? '').trim().split(/\n{2,}/).pop().slice(-400);
  // Handing the turn back, as a question or as a statement.
  return /\b(please confirm|would you like( me)? to|do you want me to|shall i|should i\b|want me to|ready for me to|can i (proceed|go ahead|continue)|may i (proceed|go ahead|continue)|let me know (if|when|whether|how|once)|tell me (if|when|whether|to)|say the word|just say|awaiting your|once you (confirm|say|approve)|when you('re| are) ready|whenever you('re| are) ready|if you('d| would) like|if you want me to)\b/i.test(tail);
}

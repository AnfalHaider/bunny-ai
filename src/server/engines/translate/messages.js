/**
 * CLI-ENGINES §2.2: the Messages translator. Claude Code in LOCAL mode speaks Anthropic's Messages API; Bunny's providers speak Chat Completions. Pure functions, each direction tested with fixtures:
 *
 *   messagesToChat(request)       a Messages request -> a Chat Completions request (system, messages, tool_use / tool_result, tools, tool_choice, max_tokens, stop)
 *   createMessagesStream(opts)    Chat Completions chunks -> Messages stream events, `push(chunk)` at a time, then `finish()`
 *   messagesFromChat(chat)        a whole (non-streamed) answer -> a Messages object
 *   estimateInputTokens(request)  a rough count for /v1/messages/count_tokens (4 characters a token); the real count is the provider's
 *
 * Covered: text, images (base64 and url), tool_use, tool_result (text, blocks, is_error), thinking blocks (dropped from the history: no provider can take them back; shown as thinking when the
 * provider streams reasoning), prompt-caching marks (ignored), the stop reasons and usage. UNKNOWN until the real-binary smoke: whether Claude Code accepts a thinking block with the fixed signature "bunny".
 */

export class MessagesRequestError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'MessagesRequestError'; this.status = status; }
}

const text = (v) => (typeof v === 'string' ? v : '');

const blockText = (content) => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (typeof b === 'string' ? b : b?.type === 'text' ? text(b.text) : b?.type === 'image' ? '[image]' : '')).join('');
};

const imagePart = (b) => {
  const s = b?.source;
  if (s?.type === 'base64' && typeof s.data === 'string') return { type: 'image_url', image_url: { url: `data:${text(s.media_type) || 'image/png'};base64,${s.data}` } };
  if (s?.type === 'url' && typeof s.url === 'string') return { type: 'image_url', image_url: { url: s.url } };
  return null;
};

/** The tools: `input_schema` becomes `parameters`; server tools (web_search_..., computer, bash_...) have no `input_schema` and are not offered. */
function convertTools(tools) {
  const out = [];
  for (const t of Array.isArray(tools) ? tools : []) {
    if (!t || typeof t !== 'object' || typeof t.name !== 'string' || !t.input_schema || typeof t.input_schema !== 'object') continue;
    out.push({ type: 'function', function: { name: t.name, description: text(t.description), parameters: t.input_schema } });
  }
  return out;
}

/** The names of the tools a Messages request offers (every entry), for the engine's tool-list check. */
export function offeredToolNames(request) {
  return (Array.isArray(request?.tools) ? request.tools : []).map((t) => (typeof t?.name === 'string' ? t.name : String(t?.type ?? '?')));
}

/** A Messages request -> a Chat Completions request body, always streamed. */
export function messagesToChat(request) {
  if (!request || typeof request !== 'object') throw new MessagesRequestError('The request was not a JSON object.');
  if (!Array.isArray(request.messages)) throw new MessagesRequestError('The request has no messages.');
  const messages = [];
  const system = typeof request.system === 'string' ? request.system : Array.isArray(request.system) ? request.system.map((b) => text(b?.text)).join('\n\n') : '';
  if (system.trim()) messages.push({ role: 'system', content: system });
  for (const m of request.messages) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    if (typeof m.content === 'string') { messages.push({ role, content: m.content }); continue; }
    const blocks = Array.isArray(m.content) ? m.content : [];
    if (role === 'assistant') {
      let plain = ''; const calls = [];
      for (const b of blocks) {
        if (b?.type === 'text') plain += text(b.text);
        else if (b?.type === 'tool_use') calls.push({ id: text(b.id), type: 'function', function: { name: text(b.name), arguments: JSON.stringify(b.input ?? {}) } });
      } // thinking and redacted_thinking are dropped
      const msg = { role: 'assistant', content: plain || (calls.length ? null : '') };
      if (calls.length) msg.tool_calls = calls;
      messages.push(msg);
    } else {
      // tool results first (they answer the assistant's calls just before), then whatever else the person said
      const parts = []; let plain = '';
      for (const b of blocks) {
        if (b?.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: text(b.tool_use_id), content: `${b.is_error ? 'Error: ' : ''}${blockText(b.content)}` });
        else if (b?.type === 'text') { parts.push({ type: 'text', text: text(b.text) }); plain += text(b.text); }
        else if (b?.type === 'image') { const p = imagePart(b); if (p) parts.push(p); }
      }
      if (parts.length) messages.push({ role: 'user', content: parts.some((p) => p.type === 'image_url') ? parts : plain });
    }
  }
  // a call with no answer (a turn that was cut) is given an empty one, so the provider does not refuse the conversation
  const answered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
  const fixed = [];
  for (const m of messages) {
    fixed.push(m);
    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) if (!answered.has(c.id)) fixed.push({ role: 'tool', tool_call_id: c.id, content: '' });
  }
  const chat = { messages: fixed, stream: true };
  const tools = convertTools(request.tools);
  if (tools.length) {
    chat.tools = tools;
    const tc = request.tool_choice;
    if (tc?.type === 'none') delete chat.tools;
    else if (tc?.type === 'any') chat.tool_choice = 'required';
    else if (tc?.type === 'tool' && typeof tc.name === 'string') chat.tool_choice = { type: 'function', function: { name: tc.name } };
    if (tc?.disable_parallel_tool_use === true && chat.tools) chat.parallel_tool_calls = false;
  }
  if (Number.isFinite(request.max_tokens)) chat.max_tokens = request.max_tokens;
  if (Number.isFinite(request.temperature)) chat.temperature = request.temperature;
  if (Number.isFinite(request.top_p)) chat.top_p = request.top_p;
  if (Array.isArray(request.stop_sequences) && request.stop_sequences.length) chat.stop = request.stop_sequences.slice(0, 4);
  return { chat };
}

/** A rough count of the tokens in a request (for count_tokens): 4 characters a token, never zero. */
export function estimateInputTokens(request) {
  const chars = JSON.stringify({ s: request?.system ?? '', m: request?.messages ?? [], t: request?.tools ?? [] }).length;
  return Math.max(1, Math.ceil(chars / 4));
}

const STOP = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens', content_filter: 'end_turn', function_call: 'tool_use' };

/**
 * A converter from Chat Completions chunks to Messages stream events: `push(chunk)` returns the events to send now; `finish({ error })` the closing ones.
 * Reasoning becomes a `thinking` block, text a `text` block, each call a `tool_use` block (its arguments streamed as input_json_delta). One block is open at a time.
 */
export function createMessagesStream({ id = `msg_${Date.now().toString(36)}`, model = 'bunny', inputTokens = 0 } = {}) {
  const events = [];
  let started = false; let closed = false; let index = -1;
  let open = null; // { kind: 'thinking'|'text'|'tool', callIndex? }
  const calls = new Map(); // chat tool index -> { blockIndex, id, name, args }
  let finish = null; let usage = null; let sawTool = false;
  const emit = (type, data) => events.push({ type, ...data });
  const start = () => { if (started) return; started = true; emit('message_start', { message: { id, type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } }); };
  const closeOpen = () => {
    if (!open) return;
    if (open.kind === 'thinking') emit('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'bunny' } });
    emit('content_block_stop', { index });
    open = null;
  };
  const openBlock = (kind, block, callIndex) => { closeOpen(); index += 1; open = { kind, callIndex }; emit('content_block_start', { index, content_block: block }); };

  return {
    id,
    push(chunk) {
      events.length = 0;
      start();
      const choice = chunk?.choices?.[0];
      if (chunk?.usage) usage = chunk.usage;
      const delta = choice?.delta ?? {};
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        if (open?.kind !== 'thinking') openBlock('thinking', { type: 'thinking', thinking: '', signature: '' });
        emit('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: reasoning } });
      }
      if (typeof delta.content === 'string' && delta.content) {
        if (open?.kind !== 'text') openBlock('text', { type: 'text', text: '' });
        emit('content_block_delta', { index, delta: { type: 'text_delta', text: delta.content } });
      }
      for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const ci = Number.isInteger(tc.index) ? tc.index : 0;
        let c = calls.get(ci);
        if (!c) {
          sawTool = true;
          c = { id: text(tc.id) || `toolu_${id}_${ci}`, name: text(tc.function?.name), args: '' };
          openBlock('tool', { type: 'tool_use', id: c.id, name: c.name, input: {} }, ci);
          c.blockIndex = index; calls.set(ci, c);
        } else if (tc.function?.name && !c.name) c.name = tc.function.name;
        const piece = text(tc.function?.arguments);
        if (piece && open?.kind === 'tool' && open.callIndex === ci) { c.args += piece; emit('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: piece } }); }
        else if (piece) c.args += piece; // arguments of an earlier call arriving late: kept, not streamed (providers send one call at a time)
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      return [...events];
    },
    /** The closing events: the open block ends, then message_delta (with the stop reason and the output tokens) and message_stop. With an error: one `error` event instead. */
    finish({ error = null } = {}) {
      events.length = 0;
      start();
      if (closed) return [...events];
      closed = true;
      closeOpen();
      if (error) { emit('error', { error: { type: 'api_error', message: String(error).slice(0, 500) } }); return [...events]; }
      const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
      const reason = STOP[finish] ?? (sawTool ? 'tool_use' : 'end_turn');
      emit('message_delta', { delta: { stop_reason: sawTool && reason === 'end_turn' ? 'tool_use' : reason, stop_sequence: null }, usage: { output_tokens: output } });
      emit('message_stop', {});
      return [...events];
    },
    get usage() { return { input: Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0), output: Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) }; },
  };
}

/** A whole (non-streamed) Chat Completions answer -> a Messages object. */
export function messagesFromChat(chat, { id = `msg_${Date.now().toString(36)}`, model = 'bunny' } = {}) {
  const choice = chat?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content = [];
  if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
  for (const c of message.tool_calls ?? []) {
    let input = {}; try { input = JSON.parse(c.function?.arguments || '{}'); } catch { /* the model sent bad JSON: an empty input, the engine will say so */ }
    content.push({ type: 'tool_use', id: text(c.id) || `toolu_${id}`, name: text(c.function?.name), input });
  }
  const sawTool = (message.tool_calls ?? []).length > 0;
  return { id, type: 'message', role: 'assistant', model, content, stop_reason: sawTool ? 'tool_use' : (STOP[choice.finish_reason] ?? 'end_turn'), stop_sequence: null,
    usage: { input_tokens: Number(chat?.usage?.prompt_tokens ?? 0), output_tokens: Number(chat?.usage?.completion_tokens ?? 0) } };
}

/** The server-sent-event text for one Messages event. */
export const sseLine = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

/**
 * CLI-ENGINES §2.1: the Responses translator. Codex speaks OpenAI's Responses API (`wire_api = "responses"` is the only value it accepts); Bunny's providers speak Chat Completions.
 * These are pure functions, so each direction is tested with fixtures:
 *
 *   responsesToChat(request)      a Responses request  -> a Chat Completions request (messages, tools, tool_choice, max_tokens)
 *   createResponsesStream(opts)   Chat Completions chunks (parsed objects) -> Responses stream events, one `push(chunk)` at a time, then `finish()`
 *   responsesFromChat(chat)       a whole (non-streamed) Chat Completions answer -> a Responses object
 *
 * What is covered in each direction: input items (message, function_call, function_call_output, custom tool calls), `instructions` and the `developer` role (some servers reject `developer`),
 * reasoning (kept as thinking where the provider has it, dropped otherwise), tools (function tools; custom tools such as apply_patch become a function with one string argument; hosted tools
 * are not offered), the streaming events, usage, and stop reasons. State kept on the server (`previous_response_id`, `store: true`) is not offered: such a request is refused with a plain error.
 */

export class ResponsesRequestError extends Error {
  constructor(message, status = 400) { super(message); this.name = 'ResponsesRequestError'; this.status = status; }
}

const text = (v) => (typeof v === 'string' ? v : '');

/** The text of a content value: a string, or a list of { type: 'input_text' | 'output_text' | 'text', text }. Images are kept as image_url parts. */
function contentParts(content) {
  if (typeof content === 'string') return { text: content, parts: null };
  if (!Array.isArray(content)) return { text: '', parts: null };
  const parts = []; let plain = '';
  for (const p of content) {
    if (!p || typeof p !== 'object') continue;
    if (['input_text', 'output_text', 'text', 'summary_text', 'reasoning_text'].includes(p.type) && typeof p.text === 'string') { parts.push({ type: 'text', text: p.text }); plain += p.text; }
    else if (p.type === 'input_image' && typeof p.image_url === 'string') parts.push({ type: 'image_url', image_url: { url: p.image_url } });
  }
  return { text: plain, parts: parts.some((p) => p.type === 'image_url') ? parts : null };
}

const outputText = (output) => {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map((p) => (typeof p === 'string' ? p : text(p?.text) || (p?.type === 'input_image' ? '[image]' : ''))).join('');
  if (output && typeof output === 'object') return JSON.stringify(output);
  return '';
};

const CUSTOM_ARG = 'input';

/** Tools: function tools pass; custom (freeform) tools become a function with one string argument `input`; hosted and unknown tool kinds are not offered. Returns { tools, customNames }. */
function convertTools(tools) {
  const out = []; const customNames = new Set();
  for (const t of Array.isArray(tools) ? tools : []) {
    if (!t || typeof t !== 'object') continue;
    if (t.type === 'function' && typeof t.name === 'string') {
      out.push({ type: 'function', function: { name: t.name, description: text(t.description), parameters: t.parameters && typeof t.parameters === 'object' ? t.parameters : { type: 'object', properties: {} } } });
    } else if (t.type === 'custom' && typeof t.name === 'string') {
      customNames.add(t.name);
      out.push({ type: 'function', function: { name: t.name, description: text(t.description), parameters: { type: 'object', properties: { [CUSTOM_ARG]: { type: 'string', description: 'The whole text of the call, exactly as the tool expects it.' } }, required: [CUSTOM_ARG] } } });
    } // web_search, tool_search, namespaces, local_shell... are not offered to the owner's model
  }
  return { tools: out, customNames };
}

/** The names of the tools a Responses request offers (every kind), for the engine's tool-list check. */
export function offeredToolNames(request) {
  return (Array.isArray(request?.tools) ? request.tools : []).map((t) => (typeof t?.name === 'string' ? t.name : String(t?.type ?? '?')));
}

/** A Responses request -> { chat, customNames } (a Chat Completions request body, always streamed). Throws ResponsesRequestError for a request that needs state kept on the server. */
export function responsesToChat(request) {
  if (!request || typeof request !== 'object') throw new ResponsesRequestError('The request was not a JSON object.');
  if (request.previous_response_id) throw new ResponsesRequestError('Bunny does not keep a conversation on the server (previous_response_id). The engine must send the whole conversation each time.', 400);
  if (request.store === true) throw new ResponsesRequestError('Bunny does not store responses (store: true). The engine must send the whole conversation each time.', 400);
  const messages = [];
  const instructions = text(request.instructions).trim();
  if (instructions) messages.push({ role: 'system', content: instructions });
  const items = typeof request.input === 'string' ? [{ type: 'message', role: 'user', content: request.input }] : Array.isArray(request.input) ? request.input : [];
  const { tools, customNames } = convertTools(request.tools);
  let pending = null; // an assistant message that collects consecutive calls
  const flush = () => { if (pending) { messages.push(pending); pending = null; } };
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const type = item.type ?? (item.role ? 'message' : '');
    if (type === 'message') {
      flush();
      const role = item.role === 'developer' ? 'system' : ['system', 'user', 'assistant'].includes(item.role) ? item.role : 'user';
      const { text: plain, parts } = contentParts(item.content);
      if (role === 'assistant') { if (plain) messages.push({ role: 'assistant', content: plain }); else messages.push({ role: 'assistant', content: '' }); continue; }
      messages.push({ role, content: parts && role === 'user' ? parts : plain });
    } else if (type === 'function_call' || type === 'custom_tool_call') {
      const args = type === 'custom_tool_call' ? JSON.stringify({ [CUSTOM_ARG]: text(item.input) }) : (typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}));
      if (!pending) pending = { role: 'assistant', content: null, tool_calls: [] };
      pending.tool_calls.push({ id: text(item.call_id) || text(item.id), type: 'function', function: { name: text(item.name), arguments: args } });
    } else if (type === 'function_call_output' || type === 'custom_tool_call_output') {
      flush();
      messages.push({ role: 'tool', tool_call_id: text(item.call_id), content: outputText(item.output) });
    } // reasoning items and anything else are dropped: the provider has no place for them
  }
  flush();
  // a tool message must answer a call that is there; a call with no answer (a turn that was cut) is given an empty one, so the provider does not refuse the conversation
  const answered = new Set(messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
  const fixed = [];
  for (const m of messages) {
    fixed.push(m);
    if (m.role === 'assistant' && m.tool_calls) for (const c of m.tool_calls) if (!answered.has(c.id)) fixed.push({ role: 'tool', tool_call_id: c.id, content: '' });
  }
  // instructions and the developer role both became system messages: one after another they are joined (some servers refuse two)
  const joined = [];
  for (const m of fixed) {
    const last = joined.at(-1);
    if (m.role === 'system' && last?.role === 'system' && typeof m.content === 'string' && typeof last.content === 'string') last.content = `${last.content}

${m.content}`; else joined.push(m);
  }
  const chat = { messages: joined, stream: true };
  if (tools.length) {
    chat.tools = tools;
    const tc = request.tool_choice;
    if (tc === 'none') delete chat.tools; else if (tc === 'required') chat.tool_choice = 'required'; else if (tc && typeof tc === 'object' && typeof tc.name === 'string') chat.tool_choice = { type: 'function', function: { name: tc.name } };
    if (request.parallel_tool_calls === false) chat.parallel_tool_calls = false;
  }
  if (Number.isFinite(request.max_output_tokens)) chat.max_tokens = request.max_output_tokens;
  if (Number.isFinite(request.temperature)) chat.temperature = request.temperature;
  if (Number.isFinite(request.top_p)) chat.top_p = request.top_p;
  return { chat, customNames };
}

// ---------------------------------------------------------------- Chat chunks -> Responses events

const STOP = { stop: 'completed', tool_calls: 'completed', length: 'incomplete', content_filter: 'incomplete', function_call: 'completed' };

/**
 * A converter from Chat Completions chunks to Responses stream events. `push(chunk)` returns the events to send now; `finish()` returns the closing events.
 * Text becomes one `message` item, each tool call a `function_call` (or `custom_tool_call` for a custom tool), reasoning a `reasoning` item.
 */
export function createResponsesStream({ id = `resp_${Date.now().toString(36)}`, model = 'bunny', customNames = new Set(), now = () => Math.floor(Date.now() / 1000) } = {}) {
  const events = [];
  let seq = 0; let outIndex = 0; let started = false; let closed = false;
  const output = []; // finished items
  let textItem = null; let reasoningItem = null; const calls = new Map(); // index -> { item, outputIndex, args }
  let finish = null; let usage = null;
  const emit = (type, data) => { events.push({ type, sequence_number: seq, ...data }); seq += 1; };
  const start = () => { if (started) return; started = true; emit('response.created', { response: { id, object: 'response', created_at: now(), status: 'in_progress', model, output: [] } }); };

  const closeReasoning = () => {
    if (!reasoningItem) return;
    const it = { id: reasoningItem.id, type: 'reasoning', summary: [{ type: 'summary_text', text: reasoningItem.text }] };
    emit('response.reasoning_summary_text.done', { item_id: it.id, output_index: reasoningItem.outputIndex, summary_index: 0, text: reasoningItem.text });
    emit('response.output_item.done', { output_index: reasoningItem.outputIndex, item: it });
    output.push(it); reasoningItem = null;
  };
  const closeText = () => {
    if (!textItem) return;
    const it = { id: textItem.id, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text: textItem.text, annotations: [] }] };
    emit('response.output_text.done', { item_id: it.id, output_index: textItem.outputIndex, content_index: 0, text: textItem.text });
    emit('response.content_part.done', { item_id: it.id, output_index: textItem.outputIndex, content_index: 0, part: it.content[0] });
    emit('response.output_item.done', { output_index: textItem.outputIndex, item: it });
    output.push(it); textItem = null;
  };
  const closeCalls = () => {
    for (const c of calls.values()) {
      const custom = customNames.has(c.name);
      let item;
      if (custom) {
        let input = c.args;
        try { const parsed = JSON.parse(c.args || '{}'); input = typeof parsed?.[CUSTOM_ARG] === 'string' ? parsed[CUSTOM_ARG] : c.args; } catch { /* keep the raw text */ }
        item = { id: c.itemId, type: 'custom_tool_call', status: 'completed', call_id: c.callId, name: c.name, input };
      } else {
        emit('response.function_call_arguments.done', { item_id: c.itemId, output_index: c.outputIndex, arguments: c.args || '{}' });
        item = { id: c.itemId, type: 'function_call', status: 'completed', call_id: c.callId, name: c.name, arguments: c.args || '{}' };
      }
      emit('response.output_item.done', { output_index: c.outputIndex, item });
      output.push(item);
    }
    calls.clear();
  };

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
        if (!reasoningItem) { reasoningItem = { id: `rs_${id}_${outIndex}`, outputIndex: outIndex, text: '' }; outIndex += 1; emit('response.output_item.added', { output_index: reasoningItem.outputIndex, item: { id: reasoningItem.id, type: 'reasoning', summary: [] } }); emit('response.reasoning_summary_part.added', { item_id: reasoningItem.id, output_index: reasoningItem.outputIndex, summary_index: 0, part: { type: 'summary_text', text: '' } }); }
        reasoningItem.text += reasoning;
        emit('response.reasoning_summary_text.delta', { item_id: reasoningItem.id, output_index: reasoningItem.outputIndex, summary_index: 0, delta: reasoning });
      }
      if (typeof delta.content === 'string' && delta.content) {
        closeReasoning();
        if (!textItem) {
          textItem = { id: `msg_${id}_${outIndex}`, outputIndex: outIndex, text: '' }; outIndex += 1;
          emit('response.output_item.added', { output_index: textItem.outputIndex, item: { id: textItem.id, type: 'message', status: 'in_progress', role: 'assistant', content: [] } });
          emit('response.content_part.added', { item_id: textItem.id, output_index: textItem.outputIndex, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
        }
        textItem.text += delta.content;
        emit('response.output_text.delta', { item_id: textItem.id, output_index: textItem.outputIndex, content_index: 0, delta: delta.content });
      }
      for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        closeReasoning(); closeText();
        const index = Number.isInteger(tc.index) ? tc.index : 0;
        let c = calls.get(index);
        if (!c) {
          c = { index, name: text(tc.function?.name), callId: text(tc.id) || `call_${id}_${index}`, itemId: `fc_${id}_${index}`, outputIndex: outIndex, args: '' };
          outIndex += 1; calls.set(index, c);
          if (!customNames.has(c.name)) emit('response.output_item.added', { output_index: c.outputIndex, item: { id: c.itemId, type: 'function_call', status: 'in_progress', call_id: c.callId, name: c.name, arguments: '' } });
          else emit('response.output_item.added', { output_index: c.outputIndex, item: { id: c.itemId, type: 'custom_tool_call', status: 'in_progress', call_id: c.callId, name: c.name, input: '' } });
        } else if (tc.function?.name && !c.name) c.name = tc.function.name;
        const piece = text(tc.function?.arguments);
        if (piece) { c.args += piece; if (!customNames.has(c.name)) emit('response.function_call_arguments.delta', { item_id: c.itemId, output_index: c.outputIndex, delta: piece }); }
      }
      if (choice?.finish_reason) finish = choice.finish_reason;
      return [...events];
    },
    /** The closing events: every open item is finished, then `response.completed` (or `response.incomplete`). */
    finish({ error = null } = {}) {
      events.length = 0;
      start();
      if (closed) return [...events];
      closed = true;
      closeReasoning(); closeText(); closeCalls();
      const input_tokens = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
      const output_tokens = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
      const status = error ? 'failed' : (STOP[finish] ?? 'completed');
      const response = { id, object: 'response', created_at: now(), status, model, output, usage: { input_tokens, output_tokens, total_tokens: input_tokens + output_tokens, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
      if (status === 'incomplete') response.incomplete_details = { reason: finish === 'content_filter' ? 'content_filter' : 'max_output_tokens' };
      if (error) { response.error = { code: 'bunny_error', message: String(error).slice(0, 500) }; emit('response.failed', { response }); } else emit(status === 'incomplete' ? 'response.incomplete' : 'response.completed', { response });
      return [...events];
    },
    get usage() { return { input: Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0), output: Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) }; },
  };
}

/** A whole (non-streamed) Chat Completions answer -> a Responses object. */
export function responsesFromChat(chat, { id = `resp_${Date.now().toString(36)}`, model = 'bunny', customNames = new Set() } = {}) {
  const stream = createResponsesStream({ id, model, customNames });
  const choice = chat?.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const delta = { content: typeof message.content === 'string' ? message.content : undefined, reasoning_content: message.reasoning_content, tool_calls: (message.tool_calls ?? []).map((c, i) => ({ index: i, id: c.id, function: c.function })) };
  stream.push({ choices: [{ delta, finish_reason: choice.finish_reason ?? 'stop' }], usage: chat?.usage });
  const events = stream.finish();
  return events.at(-1).response;
}

/** The server-sent-event text for one Responses event. */
export const sseLine = (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;

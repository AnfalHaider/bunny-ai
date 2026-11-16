/**
 * Importing history from another tool.
 *
 * People arrive with transcripts written somewhere else. These parsers read the
 * shapes that are actually exported — Bunny AI's own, Anthropic's, ChatGPT's and
 * a plain Markdown transcript — and turn them into messages.
 *
 * The parsers never throw on a strange file: an unreadable conversation comes
 * back as no messages and a reason, not as a crash.
 */

/** @typedef {{role: string, content: string, at?: string}} ImportedMessage */

/** @returns {{messages: ImportedMessage[], title: string|null, notes: string[]}} */
export function parseImport(text, { title = null } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return { messages: [], title: null, notes: ['The file was empty.'] };

  if (raw.startsWith('{') || raw.startsWith('[')) {
    let data;
    try { data = JSON.parse(raw); } catch { data = undefined; }
    if (data !== undefined) return parseJson(data, { title });
    // JSON Lines: one JSON object per line (Claude Code and other agents keep transcripts this way).
    const rows = raw.split(/\r?\n/).map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    if (rows.length) return parseJson(rows, { title });
    return { messages: [], title: null, notes: ['That file is not valid JSON.'] };
  }
  return parseMarkdown(raw, { title });
}

/** Any JSON export, whichever tool wrote it. */
export function parseJson(data, { title = null } = {}) {
  const notes = [];

  // Bunny AI's own export.
  if (data && Array.isArray(data.messages)) {
    return { messages: clean(data.messages), title: title ?? data.title ?? null, notes };
  }

  // Anthropic chat export: { chat_messages: [{ sender, text }] }
  if (data && Array.isArray(data.chat_messages)) {
    const messages = data.chat_messages
      .map((m) => ({
        role: m.sender === 'human' ? 'user' : 'assistant',
        content: Array.isArray(m.text) ? m.text.map((t) => t.text ?? '').join('\n') : String(m.text ?? ''),
        at: m.created_at,
      }))
      .filter((m) => m.content.trim());
    return { messages, title: title ?? data.name ?? null, notes };
  }

  // ChatGPT's export: { mapping: { id: { message, parent } } }
  if (data && data.mapping && typeof data.mapping === 'object') {
    const nodes = Object.values(data.mapping)
      .filter((node) => node && node.message && node.message.content)
      .sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0));
    const messages = nodes.map((node) => {
      const role = node.message.author?.role === 'assistant' ? 'assistant' : 'user';
      const content = node.message.content.parts?.filter((p) => typeof p === 'string').join('\n') ?? '';
      return { role, content, at: node.create_time ? new Date(node.create_time * 1000).toISOString() : undefined };
    }).filter((m) => m.content.trim());
    return { messages, title: title ?? data.title ?? null, notes };
  }

  // A bare array of messages.
  if (Array.isArray(data)) {
    const messages = clean(data);
    if (messages.length) return { messages, title, notes };
  }

  // Any other shape: the longest list of things that look like messages, wherever it sits.
  const found = findMessageList(data);
  if (found.length) return { messages: found, title: title ?? data?.title ?? data?.name ?? data?.summary ?? null, notes };

  notes.push('No messages were found in that file.');
  return { messages: [], title, notes };
}

/** A plain Markdown transcript: "# Title", then "## You" / "## Assistant". */
export function parseMarkdown(text, { title = null } = {}) {
  const lines = String(text).split(/\r?\n/);
  const messages = [];
  let heading = null;
  let buffer = [];

  const flush = () => {
    if (!heading) { buffer = []; return; }
    const content = buffer.join('\n').trim();
    if (content) messages.push({ role: heading === 'you' ? 'user' : 'assistant', content });
    buffer = [];
  };

  let foundTitle = title;
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) { foundTitle ??= h1[1].trim(); continue; }
    // "## You", "### Assistant", "**User:**" or "Human:" starts a message.
    const h2 = line.match(/^#{2,4}\s+(.*)$/) ?? line.match(/^\*\*([^*]{1,30})\*\*:?\s*$/) ?? line.match(/^(you|user|human|assistant|claude|chatgpt|ai|model|bunny):\s*$/i);
    if (h2) {
      const label = h2[1].trim().replace(/[:*]+$/, '').trim().toLowerCase().split(/[\s(]/)[0];
      const next = USER.test(label) ? 'you' : ASSISTANT.test(label) ? 'assistant' : null;
      if (next || line.startsWith('##')) { flush(); heading = next; continue; }
    }
    // "User: hello" / "Assistant: hi" with the text on the same line (Q2-16).
    const inline = line.match(/^(you|user|human|assistant|claude|chatgpt|ai|model|bunny):\s+(\S.*)$/i);
    if (inline) {
      const who = inline[1].toLowerCase();
      flush(); heading = USER.test(who) ? 'you' : 'assistant'; buffer.push(inline[2]);
      continue;
    }
    buffer.push(line);
  }
  flush();

  const notes = messages.length ? [] : ['No messages were found in that file.'];
  return { messages, title: foundTitle, notes };
}

const ASSISTANT = /^(assistant|model|ai|bot|claude|gpt|chatgpt|gemini|bunny|agent)$/i;
const USER = /^(user|human|you|person|me)$/i;

/** Who wrote a message, from whichever field the tool used; null when it is neither side. */
function roleOf(m) {
  const who = m?.role ?? m?.message?.role ?? m?.author?.role ?? m?.author ?? m?.sender ?? m?.from ?? m?.speaker ?? m?.type;
  const w = typeof who === 'string' ? who.trim() : '';
  if (ASSISTANT.test(w)) return 'assistant';
  if (USER.test(w)) return 'user';
  return null;
}

/** The words of a message: a string, a list of parts ({type:'text', text}), or nested in .message. */
function textOf(value, depth = 0) {
  if (value == null || depth > 4) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((p) => (typeof p === 'string' ? p : p?.type && p.type !== 'text' ? '' : textOf(p?.text ?? p?.content, depth + 1))).filter(Boolean).join('\n');
  if (typeof value === 'object') {
    if (value.parts) return textOf(value.parts, depth + 1);
    return textOf(value.text ?? value.content ?? value.message?.content ?? value.value, depth + 1);
  }
  return '';
}

function clean(list) {
  return (Array.isArray(list) ? list : [])
    .map((m) => ({
      role: roleOf(m) ?? (m?.role ? 'user' : null),
      content: textOf(m?.content ?? m?.text ?? m?.message ?? m?.parts ?? m?.body),
      at: m?.at ?? m?.created_at ?? m?.timestamp ?? m?.createdAt ?? undefined,
    }))
    .filter((m) => m.role && m.content.trim())
    .map((m) => (m.at === undefined ? { role: m.role, content: m.content } : m));
}

/** Walks any JSON and returns the longest list whose items read as messages. */
function findMessageList(data) {
  let best = [];
  const seen = new Set();
  const walk = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 8 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const objects = node.filter((x) => x && typeof x === 'object');
      if (objects.length >= 2 && objects.filter((x) => roleOf(x)).length >= objects.length / 2) {
        const messages = clean(objects);
        if (messages.length > best.length) best = messages;
      }
      for (const x of objects) walk(x, depth + 1);
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(data, 0);
  return best;
}

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
    try {
      return parseJson(JSON.parse(raw), { title });
    } catch {
      return { messages: [], title: null, notes: ['That file is not valid JSON.'] };
    }
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
    return { messages: clean(data), title, notes };
  }

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
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      flush();
      const label = h2[1].trim().toLowerCase();
      heading = label.startsWith('you') || label === 'user' ? 'you'
        : label.startsWith('assistant') || label === 'model' || label === 'claude' ? 'assistant'
          : null;
      continue;
    }
    buffer.push(line);
  }
  flush();

  const notes = messages.length ? [] : ['No messages were found in that file.'];
  return { messages, title: foundTitle, notes };
}

function clean(list) {
  return (Array.isArray(list) ? list : [])
    .map((m) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'assistant' : 'user',
      content: String(m.content ?? m.text ?? ''),
      at: m.at ?? m.created_at ?? undefined,
    }))
    .filter((m) => m.content.trim());
}

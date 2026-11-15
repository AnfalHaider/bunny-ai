/**
 * Chat session store.
 *
 * One JSON file per session under the app data directory, written atomically so
 * a crash mid-save cannot leave a half-written transcript.
 *
 * A session is more than a transcript: it can hang off another session (a
 * branch), belong to a project, be pinned or archived, and be excluded from
 * history (incognito). All of that is in the file, so every screen agrees.
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const ID_PATTERN = /^[a-f0-9-]{36}$/;
const TITLE_MAX = 120;

/** Coarse token estimate. ~4 characters per token is close enough for a meter. */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/**
 * What an attachment costs the model. A picture or file kept as a data URL is not read
 * as its base64 text, so it counts as a fixed amount; a read document counts its words.
 */
function attachmentTokens(file) {
  const data = String(file?.data ?? '');
  if (file?.kind === 'image' || data.startsWith('data:') || data.startsWith('/api/')) return 1000;
  return estimateTokens(data) + (file?.pictures?.length ?? 0) * 1000;
}

/** Where the model's view of a chat starts: the latest summary, or the beginning. */
export function sinceSummary(messages = []) {
  for (let i = messages.length - 1; i >= 0; i -= 1) if (messages[i].kind === 'summary') return i;
  return 0;
}

/** @param {string} dir */
export function createSessionStore({ dir, contextLimit = 200_000 } = {}) {
  const fileFor = (id) => join(dir, `${id}.json`);

  async function ensureDir() {
    await mkdir(dir, { recursive: true });
  }

  function requireId(id) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error(`Invalid session id: ${id}`);
    return id;
  }

  async function save(session) {
    await ensureDir();
    const target = fileFor(session.id);
    // A temp name of its own: two saves must never share one half-written file.
    const temp = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    session.updatedAt = new Date().toISOString();
    await writeFile(temp, JSON.stringify(session, null, 2), 'utf8');
    // Windows refuses to replace a file another request is reading at that moment
    // (EPERM, EACCES, EBUSY). It clears in milliseconds, so try again a few times.
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(temp, target);
        return;
      } catch (err) {
        if (attempt >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) {
          await rm(temp, { force: true }).catch(() => {});
          throw err;
        }
        await new Promise((r) => setTimeout(r, 15 * (attempt + 1)));
      }
    }
  }

  /** Bring an older file up to the current shape without losing anything. */
  function normalise(session) {
    session.parentId ??= null;
    session.branchFrom ??= null;
    session.projectId ??= null;
    session.folder ??= null;
    session.branch ??= null;
    session.permissionMode ??= 'ask';
    session.effort ??= null;
    session.pinned ??= false;
    session.archived ??= false;
    session.incognito ??= false;
    session.messages ??= [];
    for (const m of session.messages) {
      m.id ??= randomUUID();
      m.at ??= session.createdAt ?? new Date().toISOString();
      m.kind ??= 'text';
    }
    return session;
  }

  async function get(id) {
    try {
      return normalise(JSON.parse(await readFile(fileFor(requireId(id)), 'utf8')));
    } catch {
      return null;
    }
  }

  /** The context meter for a transcript. */
  function context(session) {
    let used = 0;
    // Only what the model reads counts: from the latest summary on. Earlier messages stay
    // on screen but are no longer sent.
    const messages = session.messages ?? [];
    for (const m of messages.slice(sinceSummary(messages))) {
      used += estimateTokens(m.content) + 4;
      if (m.kind === 'tool_call') used += estimateTokens(m.result);
      // An attachment costs the model context too.
      for (const file of m.attachments ?? []) used += attachmentTokens(file) + 4;
    }
    // A model with a known window sets the limit; otherwise the default stands.
    const limit = session.contextLimit ?? contextLimit;
    return {
      used,
      limit,
      pct: Math.min(100, Math.round((used / limit) * 100)),
      messages: session.messages?.length ?? 0,
    };
  }

  function summary(session) {
    const last = session.messages?.at(-1);
    return {
      id: session.id,
      title: session.title,
      providerId: session.providerId ?? null,
      model: session.model ?? null,
      parentId: session.parentId ?? null,
      projectId: session.projectId ?? null,
      folder: session.folder ?? null,
      branch: session.branch ?? null,
      permissionMode: session.permissionMode ?? 'ask',
      effort: session.effort ?? null,
      pinned: Boolean(session.pinned),
      archived: Boolean(session.archived),
      incognito: Boolean(session.incognito),
      // A chat a helper agent or another chat started: who made it, and how its work is going.
      agent: session.agent ?? null,
      agentStatus: session.agentStatus ?? null,
      messageCount: session.messages?.length ?? 0,
      preview: String(last?.content ?? '').replace(/\s+/g, ' ').slice(0, 90),
      context: context(session),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * @param {{ includeArchived?: boolean, q?: string, projectId?: string }} opts
   */
  async function list({ includeArchived = false, q = '', projectId = null } = {}) {
    await ensureDir();
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
    const needle = String(q ?? '').trim().toLowerCase();
    const sessions = [];
    for (const file of files) {
      try {
        const raw = normalise(JSON.parse(await readFile(join(dir, file), 'utf8')));
        if (!includeArchived && raw.archived) continue;
        if (projectId && raw.projectId !== projectId) continue;
        if (needle) {
          const haystack = [raw.title, ...(raw.messages ?? []).map((m) => m.content)].join('\n').toLowerCase();
          if (!haystack.includes(needle)) continue;
        }
        sessions.push(summary(raw));
      } catch {
        // A corrupt file should not take the sidebar down.
      }
    }
    // Pinned first, then most recently touched: pins sit above the
    // chronological list.
    return sessions.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return String(b.updatedAt).localeCompare(String(a.updatedAt));
    });
  }

  async function create({ title = 'New chat', providerId = null, model = null, parentId = null, branchFrom = null, projectId = null, folder = null, branch = null, permissionMode = 'ask', effort = null, incognito = false, messages = [], agent = null, agentStatus = null, workMode = null } = {}) {
    const now = new Date().toISOString();
    const session = normalise({
      id: randomUUID(),
      title,
      providerId,
      model,
      parentId,
      branchFrom,
      projectId,
      folder,
      branch,
      permissionMode,
      effort,
      pinned: false,
      archived: false,
      incognito,
      ...(agent ? { agent: String(agent).slice(0, 40), agentStatus } : {}),
      ...(workMode ? { workMode: workMode === 'code' ? 'code' : 'chat' } : {}),
      createdAt: now,
      updatedAt: now,
      messages: messages.map((m) => ({ ...m, id: m.id ?? randomUUID(), at: m.at ?? now })),
    });
    await save(session);
    return session;
  }

  async function append(id, message) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    const entry = {
      id: randomUUID(),
      role: message.role,
      content: String(message.content ?? ''),
      kind: message.kind ?? 'text',
      attachments: message.attachments ?? [],
      at: new Date().toISOString(),
    };
    // Optional details: tool steps (tool, status, result) and which model answered (Auto).
    for (const key of ['tool', 'status', 'result', 'note', 'model', 'providerId', 'job', 'auto', 'fellBackFrom']) {
      if (message[key] !== undefined && message[key] !== null) entry[key] = typeof message[key] === 'string' ? message[key].slice(0, 2000) : message[key];
    }
    // A question the model asked, its choices and the person's answer (null: not answered).
    if (message.question && typeof message.question === 'object') {
      const q = message.question;
      entry.question = {
        question: String(q.question ?? '').slice(0, 600),
        choices: (Array.isArray(q.choices) ? q.choices : []).slice(0, 6).map((c) => ({ label: String(c?.label ?? c ?? '').slice(0, 120), reason: String(c?.reason ?? '').slice(0, 240), recommended: c?.recommended === true })),
        answer: q.answer == null ? null : String(q.answer).slice(0, 4000),
      };
    }
    // The model's thinking, when it sent any (shown folded above the reply).
    if (typeof message.thinking === 'string' && message.thinking.trim()) entry.thinking = message.thinking.slice(0, 40_000);
    // The checklist the model kept while it worked (update_tasks).
    if (Array.isArray(message.tasks) && message.tasks.length) {
      entry.tasks = message.tasks.slice(0, 20).map((t) => ({ text: String(t.text ?? '').slice(0, 160), done: Boolean(t.done) }));
    }
    // The files this reply changed can be put back (see checkpoints.js).
    if (message.checkpoint && /^[a-f0-9-]{36}$/.test(String(message.checkpoint.id))) {
      entry.checkpoint = { id: message.checkpoint.id, files: Number(message.checkpoint.files) || 0, restored: false };
    }
    // Another chat a tool step started or talked to (a helper, a background chat).
    if (message.linked && typeof message.linked === 'object' && /^[a-f0-9-]{36}$/.test(String(message.linked.id))) {
      entry.linked = { id: message.linked.id, title: String(message.linked.title ?? 'Chat').slice(0, 120), status: String(message.linked.status ?? '').slice(0, 20), ...(message.linked.model ? { model: String(message.linked.model).slice(0, 120) } : {}) };
    }
    // An artifact a tool step made: kept so the chat can show its card again later.
    if (message.artifact && typeof message.artifact === 'object' && /^[a-f0-9-]{36}$/.test(String(message.artifact.id))) {
      const { id: artifactId, title, kind } = message.artifact;
      entry.artifact = { id: artifactId, title: String(title ?? 'Artifact').slice(0, 120), kind: ['html', 'code', 'markdown'].includes(kind) ? kind : 'markdown' };
    }
    session.messages.push(entry);
    // First user line becomes the title, so the sidebar is useful immediately.
    if (session.title === 'New chat' && message.role === 'user') {
      session.title = String(message.content).trim().slice(0, 60) || 'New chat';
    }
    await save(session);
    return session;
  }

  async function update(id, patch) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    if (patch.title !== undefined) session.title = String(patch.title).trim().slice(0, TITLE_MAX) || 'Untitled';
    if (patch.providerId !== undefined) session.providerId = patch.providerId;
    if (patch.model !== undefined) session.model = patch.model;
    if (patch.contextLimit !== undefined) session.contextLimit = Number(patch.contextLimit) || null;
    if (patch.pinned !== undefined) session.pinned = Boolean(patch.pinned);
    if (patch.archived !== undefined) session.archived = Boolean(patch.archived);
    if (patch.projectId !== undefined) session.projectId = patch.projectId ?? null;
    if (patch.folder !== undefined) session.folder = String(patch.folder ?? '').trim() || null;
    if (patch.branch !== undefined) session.branch = String(patch.branch ?? '').trim() || null;
    if (patch.permissionMode !== undefined) session.permissionMode = patch.permissionMode;
    if (patch.effort !== undefined) session.effort = patch.effort ?? null;
    if (patch.incognito !== undefined) session.incognito = Boolean(patch.incognito);
    if (patch.agentStatus !== undefined) session.agentStatus = patch.agentStatus;
    if (patch.workMode !== undefined) session.workMode = patch.workMode === 'code' || patch.workMode === 'delegate' || patch.workMode === 'cowork' ? 'code' : 'chat';
    await save(session);
    return session;
  }

  async function remove(id) {
    await rm(fileFor(requireId(id)), { force: true });
  }

  /** Drop one message and everything after it. Used by edit-and-resend. */
  async function truncateFrom(id, messageId) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    const index = session.messages.findIndex((m) => m.id === messageId);
    if (index === -1) throw Object.assign(new Error('No such message'), { code: 'message.notFound' });
    session.messages = session.messages.slice(0, index);
    await save(session);
    return session;
  }

  /** Replace a message's text and cut everything after it. */
  async function editMessage(id, messageId, content) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    const index = session.messages.findIndex((m) => m.id === messageId);
    if (index === -1) throw Object.assign(new Error('No such message'), { code: 'message.notFound' });
    const text = String(content ?? '').trim();
    if (!text) throw Object.assign(new Error('Message cannot be empty'), { code: 'message.empty' });
    session.messages[index].content = text;
    session.messages = session.messages.slice(0, index + 1);
    await save(session);
    return session;
  }

  /**
   * Branch a session at a message. The child starts with everything up to and
   * including that message (or the whole transcript when `at` is omitted).
   */
  async function fork(id, { at = null, title } = {}) {
    const parent = await get(requireId(id));
    if (!parent) throw Object.assign(new Error('No such session'), { code: 'session.notFound' });
    const cut = at ? parent.messages.findIndex((m) => m.id === at) : parent.messages.length - 1;
    const end = cut === -1 ? parent.messages.length : cut + 1;
    const messages = parent.messages.slice(0, end).map((m) => ({ ...m }));
    return create({
      title: title ?? `${parent.title} (branch)`,
      providerId: parent.providerId,
      model: parent.model,
      projectId: parent.projectId,
      folder: parent.folder,
      branch: parent.branch,
      permissionMode: parent.permissionMode,
      effort: parent.effort,
      parentId: parent.id,
      branchFrom: end - 1,
      messages,
    });
  }

  /** Direct children, for the nested sidebar. */
  async function children(id) {
    const all = await list({ includeArchived: true });
    return all.filter((s) => s.parentId === id);
  }

  /**
   * `/compact`: replace the transcript with a summary and keep the last
   * exchange. Deliberately local and deterministic — it must work with no key,
   * no provider and no network, and it must not invent facts.
   */
  /**
   * summarize(session) may write the summary with the model; when it is missing or fails,
   * the summary is built here from the transcript, so compacting never depends on a network.
   */
  async function compact(id, { summarize = null } = {}) {
    const session = await get(requireId(id));
    if (!session) throw Object.assign(new Error('No such session'), { code: 'session.notFound' });
    // Only what came after the last summary is summarised (that summary included).
    const since = session.messages.slice(sinceSummary(session.messages));
    if (since.filter((m) => m.kind !== 'summary').length < 2) {
      throw Object.assign(new Error('There is nothing to compact yet'), { code: 'compact.nothing' });
    }
    const before = context(session);
    const userTurns = since.filter((m) => m.role === 'user');
    const ask = String(userTurns[0]?.content ?? '').replace(/\s+/g, ' ').trim();
    const asks = userTurns.slice(1, 6).map((m) => `- ${String(m.content).replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    const lastAssistant = [...since].reverse().find((m) => m.role === 'assistant' && m.kind !== 'tool_call');
    const tail = String(lastAssistant?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

    const lines = [
      '**Summary of the conversation so far**',
      '',
      `Started with: ${ask || '(no opening question)'}`,
    ];
    if (asks.length) lines.push('', 'Then asked:', '', ...asks);
    if (tail) lines.push('', `Latest answer covered: ${tail}${tail.length >= 300 ? '…' : ''}`);
    lines.push('', `_${userTurns.length} request(s) and ${before.messages} messages were summarised._`);
    let written = '';
    if (summarize) {
      try { written = String(await summarize({ ...session, messages: since }) ?? '').trim(); } catch { written = ''; }
    }
    if (written) {
      lines.length = 0;
      lines.push('**Summary of the conversation so far**', '', written, '', `_${before.messages} messages were summarised by the model._`);
    }

    session.compactions ??= [];
    session.compactions.push({
      at: new Date().toISOString(),
      coveredMessages: since.length,
      coveredTokens: before.used,
    });
    // The summary is added after the conversation, which stays on screen: from here on the
    // model reads the summary instead of the messages above it.
    session.messages.push({
      id: randomUUID(),
      role: 'assistant',
      kind: 'summary',
      content: lines.join('\n'),
      at: new Date().toISOString(),
    });
    await save(session);
    return { session, before, after: context(session) };
  }

  /** Automatic compaction: call it before a send when the window is nearly full. */
  async function compactIfFull(id, threshold = 0.8, options = {}) {
    const session = await get(requireId(id));
    if (!session || session.messages.length - sinceSummary(session.messages) < 8) return null;
    const meter = context(session);
    if (meter.used < meter.limit * threshold) return null;
    return compact(id, options);
  }
  /** Everything a transcript export needs, in one call. */
  async function exportSession(id) {
    const session = await get(requireId(id));
    if (!session) throw Object.assign(new Error('No such session'), { code: 'session.notFound' });
    const lines = [`# ${session.title}`, '', `_Exported ${new Date().toISOString()}_`, ''];
    for (const m of session.messages) {
      lines.push(`## ${m.role === 'user' ? 'You' : 'Assistant'}`, '', m.content, '');
    }
    return {
      session,
      markdown: lines.join('\n'),
      json: JSON.stringify({ title: session.title, messages: session.messages.map(({ role, content, at }) => ({ role, content, at })) }, null, 2),
    };
  }

  /** Note that a reply's file changes were undone, so its button goes away. */
  async function markCheckpointRestored(id, checkpointId) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    for (const m of session.messages) if (m.checkpoint?.id === checkpointId) m.checkpoint.restored = true;
    await save(session);
    return session;
  }

  // Changes to one chat take turns. Each change reads the file, edits it and writes it
  // back; two at once (helpers finishing together) would otherwise lose one of them.
  const locks = new Map();
  const locked = (fn) => (id, ...args) => {
    const key = String(id);
    const run = (locks.get(key) ?? Promise.resolve()).then(() => fn(id, ...args));
    const tail = run.catch(() => {});
    locks.set(key, tail);
    tail.then(() => { if (locks.get(key) === tail) locks.delete(key); });
    return run;
  };

  return {
    list, get, create, remove, fork, children, exportSession, context, summary,
    append: locked(append), update: locked(update), truncateFrom: locked(truncateFrom),
    editMessage: locked(editMessage), compact: locked(compact), compactIfFull: locked(compactIfFull),
    markCheckpointRestored: locked(markCheckpointRestored),
  };
}

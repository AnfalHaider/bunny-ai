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
    const temp = `${target}.${process.pid}.tmp`;
    session.updatedAt = new Date().toISOString();
    await writeFile(temp, JSON.stringify(session, null, 2), 'utf8');
    await rename(temp, target);
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
    for (const m of session.messages ?? []) {
      used += estimateTokens(m.content) + 4;
      // An attachment costs the model context too.
      for (const file of m.attachments ?? []) used += estimateTokens(file.data) + 4;
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

  async function create({ title = 'New chat', providerId = null, model = null, parentId = null, branchFrom = null, projectId = null, folder = null, branch = null, permissionMode = 'ask', effort = null, incognito = false, messages = [] } = {}) {
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
  async function compact(id) {
    const session = await get(requireId(id));
    if (!session) throw Object.assign(new Error('No such session'), { code: 'session.notFound' });
    if (session.messages.length < 2) {
      throw Object.assign(new Error('There is nothing to compact yet'), { code: 'compact.nothing' });
    }
    const before = context(session);
    const userTurns = session.messages.filter((m) => m.role === 'user');
    const ask = String(userTurns[0]?.content ?? '').replace(/\s+/g, ' ').trim();
    const asks = userTurns.slice(1, 6).map((m) => `- ${String(m.content).replace(/\s+/g, ' ').trim().slice(0, 120)}`);
    const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant');
    const tail = String(lastAssistant?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

    const lines = [
      '**Summary of the conversation so far**',
      '',
      `Started with: ${ask || '(no opening question)'}`,
    ];
    if (asks.length) lines.push('', 'Then asked:', '', ...asks);
    if (tail) lines.push('', `Latest answer covered: ${tail}${tail.length >= 300 ? '…' : ''}`);
    lines.push('', `_${userTurns.length} request(s) and ${before.messages} messages were summarised._`);

    session.compactions ??= [];
    session.compactions.push({
      at: new Date().toISOString(),
      coveredMessages: session.messages.length,
      coveredTokens: before.used,
    });
    session.messages = [{
      id: randomUUID(),
      role: 'assistant',
      kind: 'summary',
      content: lines.join('\n'),
      at: new Date().toISOString(),
    }];
    await save(session);
    return { session, before, after: context(session) };
  }

  /** Automatic compaction: call it before a send when the window is nearly full. */
  async function compactIfFull(id, threshold = 0.8) {
    const session = await get(requireId(id));
    if (!session || session.messages.length < 8) return null;
    const meter = context(session);
    if (meter.used < meter.limit * threshold) return null;
    return compact(id);
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

  return {
    list, get, create, append, update, remove, truncateFrom, editMessage,
    fork, children, compact, compactIfFull, exportSession, context, summary,
  };
}

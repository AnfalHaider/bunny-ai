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
export function createSessionStore({ dir, contextLimit = 200_000, onCheckpointed = null, onRemoved = null } = {}) {
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
      worktree: session.worktree ? { branch: session.worktree.branch } : null, // W2-9: the branch only, never the path
      permissionMode: session.permissionMode ?? 'ask',
      effort: session.effort ?? null,
      pinned: Boolean(session.pinned),
      archived: Boolean(session.archived),
      incognito: Boolean(session.incognito),
      // A chat a helper agent or another chat started: who made it, and how its work is going.
      agent: session.agent ?? null,
      agentStatus: session.agentStatus ?? null,
      origin: session.origin ?? null,
      remoteAuto: session.remoteAuto ?? null,
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

  async function create({ title = 'New chat', providerId = null, model = null, parentId = null, branchFrom = null, projectId = null, folder = null, branch = null, permissionMode = 'ask', effort = null, incognito = false, messages = [], agent = null, agentStatus = null, workMode = null, origin = null } = {}) {
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
      ...(origin === 'quick-ask' ? { origin: 'quick-ask' } : {}), // QA-ANSWERS: a chat that started in the Quick ask bar (the list tags it)
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
    for (const key of ['tool', 'status', 'result', 'note', 'model', 'providerId', 'job', 'auto', 'fellBackFrom', 'fellBackReason', 'fellBackTries', 'needsSignIn', 'serverId', 'fellBackKind', 'fellBackProvider', 'noAutoLoad', 'pcResults', 'pcSources', 'from', 'to', 'handover']) {
      if (message[key] !== undefined && message[key] !== null) entry[key] = typeof message[key] === 'string' ? message[key].slice(0, 2000) : message[key];
    }
    // W6-18: the model's own, longer copy of a step's result, and where the whole of it was saved.
    if (typeof message.modelResult === 'string' && message.modelResult) entry.modelResult = message.modelResult.slice(0, 8000);
    if (typeof message.resultFile === 'string' && /^\.bunny\/notes\/[\w.-]+$/.test(message.resultFile)) entry.resultFile = message.resultFile;
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
    // ...and how long it thought, in milliseconds ("Thought for 21s"); old chats have none.
    if (entry.thinking && Number.isFinite(message.thinkingMs) && message.thinkingMs > 0) entry.thinkingMs = Math.min(Math.round(message.thinkingMs), 24 * 3600 * 1000);
    // The checklist the model kept while it worked (update_tasks).
    if (Array.isArray(message.tasks) && message.tasks.length) {
      entry.tasks = message.tasks.slice(0, 40).map((t) => ({ text: String(t.text ?? '').slice(0, 160), done: Boolean(t.done) }));
    }
    // The files this reply changed can be put back (see checkpoints.js).
    if (message.checkpoint && /^[a-f0-9-]{36}$/.test(String(message.checkpoint.id))) {
      entry.checkpoint = { id: message.checkpoint.id, files: Number(message.checkpoint.files) || 0, restored: false };
    }
    // Another chat a tool step started or talked to (a helper, a background chat).
    if (message.linked && typeof message.linked === 'object' && /^[a-f0-9-]{36}$/.test(String(message.linked.id))) {
      entry.linked = { id: message.linked.id, title: String(message.linked.title ?? 'Chat').slice(0, 120), status: String(message.linked.status ?? '').slice(0, 20), ...(message.linked.model ? { model: String(message.linked.model).slice(0, 120) } : {}) };
    }
    // F9: a step that ran with no card because the person had allowed its kind for this chat keeps the small mark that says so (a fixed-length label made by the server)
    if (typeof message.allowedKind === 'string' && message.allowedKind.trim()) entry.allowedKind = message.allowedKind.trim().slice(0, 120);
    // An artifact a tool step made: kept so the chat can show its card again later.
    if (message.artifact && typeof message.artifact === 'object' && /^[a-f0-9-]{36}$/.test(String(message.artifact.id))) {
      const { id: artifactId, title, kind } = message.artifact;
      entry.artifact = { id: artifactId, title: String(title ?? 'Artifact').slice(0, 120), kind: ['html', 'code', 'markdown'].includes(kind) ? kind : 'markdown' };
    }
    // A Word, Excel or PowerPoint file made in a chat with no folder (OFFICE-MAKE): kept so the chat shows its card again later. The file itself is under <data>/made/<chat>/.
    if (message.confined === true) entry.confined = true; // F13: the step ran confined; kept so the mark survives a reload
    if (message.madeFile && typeof message.madeFile === 'object' && /^[a-f0-9-]{36}$/.test(String(message.madeFile.id))) {
      const { id: fileId, name, kind, size } = message.madeFile;
      entry.madeFile = { id: fileId, name: String(name ?? 'File').slice(0, 120), kind: ['Word', 'Excel', 'PowerPoint'].includes(kind) ? kind : 'Word', size: Math.max(0, Number(size) || 0) };
    }
    session.messages.push(entry);
    // First user line becomes the title, so the sidebar is useful immediately.
    if (session.title === 'New chat' && message.role === 'user') {
      session.title = String(message.content).trim().slice(0, 60) || 'New chat';
    }
    await save(session);
    // REWIND: the reply that holds a checkpoint is saved, so the checkpoint can record which message it belongs to and what its files look like now
    if (entry.checkpoint) await onCheckpointed?.(session.id, entry.checkpoint.id, entry.id);
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
    if (patch.folder !== undefined) { const next = String(patch.folder ?? '').trim() || null; if (next !== (session.folder ?? null)) delete session.allowKinds; session.folder = next; } // F9: a change of folder ends what was allowed for this chat
    if (patch.branch !== undefined) session.branch = String(patch.branch ?? '').trim() || null;
    if (patch.permissionMode !== undefined) { if (patch.permissionMode === 'plan') delete session.allowKinds; session.permissionMode = patch.permissionMode; } // F9: so does Plan mode
    if (patch.effort !== undefined) session.effort = patch.effort ?? null;
    if (patch.incognito !== undefined) session.incognito = Boolean(patch.incognito);
    if (patch.remoteAuto !== undefined) { if (patch.remoteAuto) session.remoteAuto = String(patch.remoteAuto); else delete session.remoteAuto; } // R6: set to Auto by another device (its id)
    if (patch.agentStatus !== undefined) session.agentStatus = patch.agentStatus;
    if (patch.engine !== undefined) { // CLI-ENGINES: the chat's engine, its auth mode and its own session, fixed at the first message (only the server sets it)
      const e = patch.engine;
      // ENGINE-SWITCH: where the chat came from, when it switched, whether Bunny's engine still owes its first note, and the engines Bunny's check failed for (restrictedFor: only the server sets it; the old
      // `restricted: true` is read as the list of that chat's own engine)
      const ENGINE_IDS = ['bunny', 'claude-code', 'codex'];
      const restrictedFor = (e && typeof e === 'object') ? [...new Set((Array.isArray(e.restrictedFor) ? e.restrictedFor : (e.restricted ? [e.id] : [])).filter((x) => ['claude-code', 'codex'].includes(x)))] : [];
      const carried = (e && typeof e === 'object') ? { ...(ENGINE_IDS.includes(e.from) ? { from: e.from } : {}), ...(typeof e.switchedAt === 'string' ? { switchedAt: e.switchedAt.slice(0, 40) } : {}), ...(e.handoverPending === true ? { handoverPending: true } : {}), ...(restrictedFor.length ? { restrictedFor } : {}) } : {};
      if (e && typeof e === 'object' && e.id === 'bunny') session.engine = { id: 'bunny', rules: 'bunny', ...carried }; // the person chose Bunny's own engine for this chat, explicitly
      else if (e && typeof e === 'object' && ['claude-code', 'codex'].includes(e.id)) session.engine = { id: e.id, auth: e.auth === 'local' ? 'local' : 'account', rules: e.rules === 'engine' ? 'engine' : 'bunny', ...(e.rulesFixed ? { rulesFixed: true } : {}), ...carried, ...(typeof e.sessionId === 'string' ? { sessionId: e.sessionId.slice(0, 200) } : {}), ...(typeof e.version === 'string' ? { version: e.version.slice(0, 40) } : {}) };
      else delete session.engine;
    }
    // FOLDER-RULES: the chat's own switch (window-only), and the hash of the frozen set the chat's engine session was last told (server-written). The text itself lives in the folder's trust record, not here.
    if (patch.folderRules !== undefined) { if (typeof patch.folderRules === 'boolean') session.folderRules = patch.folderRules; else delete session.folderRules; }
    if (patch.folderRulesSent !== undefined) { if (typeof patch.folderRulesSent === 'string' && /^[a-f0-9]{64}$/.test(patch.folderRulesSent)) session.folderRulesSent = patch.folderRulesSent; else delete session.folderRulesSent; }
    delete session.folderRulesRead; delete session.folderRulesNext; // (the earlier per-chat copy, if an old chat has one)
    if (patch.rewindNote !== undefined) { if (patch.rewindNote) session.rewindNote = String(patch.rewindNote).slice(0, 300); else delete session.rewindNote; } // REWIND: fixed text for the next message
    if (patch.workMode !== undefined) session.workMode = patch.workMode === 'code' || patch.workMode === 'delegate' || patch.workMode === 'cowork' ? 'code' : 'chat';
    await save(session);
    return session;
  }

  /** W2-9: the chat's own copy of its project. Only the worktree code calls this (create and finish); no patch, import, fork or route can set it. */
  async function setWorktree(id, worktree) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    if (worktree) session.worktree = { path: String(worktree.path), branch: String(worktree.branch), base: worktree.base ?? null, baseSha: String(worktree.baseSha ?? ''), repo: String(worktree.repo) };
    else delete session.worktree;
    await save(session);
    return session;
  }

  async function remove(id) {
    await rm(fileFor(requireId(id)), { force: true });
    await onRemoved?.(id); // its checkpoints (copies of the person's files) go with it
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

  /**
   * Take the "could not finish" notes off the end of the transcript. A failed attempt leaves one so a reload
   * still says why the reply stopped; once a fallback model has answered, they are noise and go (T-3).
   */
  async function dropTrailingErrors(id) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    let keep = session.messages.length;
    while (keep > 0 && session.messages[keep - 1].kind === 'error') keep -= 1;
    const dropped = session.messages.length - keep;
    if (dropped) { session.messages = session.messages.slice(0, keep); await save(session); }
    return dropped;
  }

  /** v0.1.14.3 (Quick ask): when Bunny shows its own words or results after a model's refusal, they are what the chat keeps as the reply. Only a quick-ask chat, only the last reply (an assistant message with no step
   * after the last user message), only text. Returns true when a reply was replaced. */
  async function replaceLastReply(id, content) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    if (session.origin !== 'quick-ask') return false;
    const text = String(content ?? '').slice(0, 8000);
    if (!text.trim()) return false;
    const last = session.messages.at(-1);
    if (!last || last.role !== 'assistant' || (last.kind && last.kind !== 'text')) return false;
    last.content = text;
    delete last.pcSources;
    await save(session);
    return true;
  }

  /** v0.1.14.1 (Quick ask retry): cut everything after the last user message (the first reply, which is being replaced). The question itself stays, once. Returns how many were cut. */
  async function dropAfterLastUser(id) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    let keep = session.messages.length;
    while (keep > 0 && session.messages[keep - 1].role !== 'user') keep -= 1;
    if (keep === 0) return 0;
    const dropped = session.messages.length - keep;
    if (dropped) { session.messages = session.messages.slice(0, keep); await save(session); }
    return dropped;
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
      session: session.worktree ? { ...session, worktree: { branch: session.worktree.branch } } : session, // W2-9: an export carries the branch name, never the path
      markdown: lines.join('\n'),
      json: JSON.stringify({ title: session.title, messages: session.messages.map(({ role, content, at }) => ({ role, content, at })) }, null, 2),
    };
  }

  /** Note that a reply's file changes were undone, so its button goes away (one id, or a list for a rewind). */
  async function markCheckpointRestored(id, checkpointId, value = true) {
    const session = await get(requireId(id));
    if (!session) throw new Error('Session not found');
    const ids = new Set([].concat(checkpointId));
    for (const m of session.messages) if (m.checkpoint && ids.has(m.checkpoint.id)) m.checkpoint.restored = value;
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

  // F9-5: the list of allowed kinds is written ONLY by these three, called by the server (a window answer to a card, or Forget from the window): update() never takes it from a patch
  async function setAllowKinds(id, next) { const session = await get(requireId(id)); if (!session) throw new Error('Session not found'); if (next && next.length) session.allowKinds = next; else delete session.allowKinds; await save(session); return session.allowKinds ?? []; }
  async function allowKindsOf(id) { return (await get(requireId(id)))?.allowKinds ?? []; }
  async function forgetAllowKind(id, index) { const session = await get(requireId(id)); if (!session) throw new Error('Session not found'); const list = [...(session.allowKinds ?? [])]; if (index === 'all') list.length = 0; else if (Number.isInteger(index) && index >= 0 && index < list.length) list.splice(index, 1); if (list.length) session.allowKinds = list; else delete session.allowKinds; await save(session); return list; }
  return {
    allowKindsOf, setAllowKinds: locked(setAllowKinds), forgetAllowKind: locked(forgetAllowKind),
    list, get, create, remove, fork, children, exportSession, context, summary,
    append: locked(append), update: locked(update), truncateFrom: locked(truncateFrom), dropTrailingErrors: locked(dropTrailingErrors), dropAfterLastUser: locked(dropAfterLastUser), replaceLastReply: locked(replaceLastReply),
    editMessage: locked(editMessage), compact: locked(compact), compactIfFull: locked(compactIfFull),
    markCheckpointRestored: locked(markCheckpointRestored), setWorktree: locked(setWorktree),
  };
}

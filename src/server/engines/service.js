/**
 * CLI-ENGINES §1.4, §4.4, §7: what app.js talks to. One object per app: the store (downloads, versions), the settings rules for engines, the routes' data, and `runTurn`, which runs one
 * Code-mode reply on an engine and turns its events into the events the page already understands (delta, thinking, tool, done, error), so the page needs nothing new.
 *
 * Fake mode (BUNNY_FAKE_ENGINE set): the gate and the end-to-end tests use a scripted stand-in engine and a fake download registry; no real CLI, no network, no account.
 */
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawnEngine } from './process.js';
import { removeTree } from '../toolInstall.js';
import { rulesFor } from '../permissionRules.js';
import { createBridge, keyFolders } from './bridge.js';
import { AUTH_COMMANDS, denyRules, signInUrlFrom, startClaude } from './claude-code.js';
import { loadSchema, startCodex } from './codex.js';
import { loadPins } from './pins.js';
import { createEngineStore } from './store.js';
import { keepSeed, seedHome } from './sandbox-seed.js';
import { cutResult } from './events.js';
import { describeReview, diff, discard, review, stage, stageDirFor } from './staging.js';
import { makeZipForFake } from './fake-registry.js';

export const ENGINE_IDS = Object.freeze(['claude-code', 'codex']);
export const AUTH_DEFAULTS = Object.freeze({ 'claude-code': 'account', codex: 'local' });
const LABELS = { 'claude-code': 'Claude Code', codex: 'Codex CLI' };
export const CODEX_ACCOUNT_NOTE = 'Not available yet: signing in to Codex is still being tested.';
export const LOCAL_NOTE_CLAUDE = 'Not supported by Anthropic. Claude Code may stop working with your models after an update.';
const FAKE_ENGINE_PATH = fileURLToPath(new URL('./fake-engine.mjs', import.meta.url));

/** The person's own rules for an engine (ENGINE-RULES, Claude Code's pattern syntax): { allow, ask, deny }, each a list of short strings. Anything else is dropped. */
const RULE_SHAPE = /^[A-Za-z_][A-Za-z0-9_]*(\([^\r\n]*\))?$/;
const cleanRules = (r) => { const out = { allow: [], ask: [], deny: [] }; for (const k of Object.keys(out)) out[k] = (Array.isArray(r?.[k]) ? r[k] : []).filter((x) => typeof x === 'string' && x.length <= 200 && RULE_SHAPE.test(x) && !x.startsWith('mcp__bunny__')).slice(0, 200); return out; };
/** A sentence if a rules object is not acceptable, else null: at most 200 rules of at most 200 characters, in Claude Code's pattern syntax (`Bash(npm test:*)`, `Read(./docs/**)`). */
export function validateRules(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return 'The rules are not valid.';
  for (const k of Object.keys(r)) if (!['allow', 'ask', 'deny'].includes(k)) return `A rule list is allow, ask or deny, not ${JSON.stringify(k.slice(0, 20))}.`;
  for (const k of ['allow', 'ask', 'deny']) {
    if (r[k] === undefined) continue;
    if (!Array.isArray(r[k]) || r[k].length > 200) return 'A rule list holds at most 200 rules.';
    for (const x of r[k]) {
      if (typeof x !== 'string' || !x.trim()) return 'A rule is a line of text.';
      if (x.length > 200) return 'A rule is at most 200 characters.';
      if (!RULE_SHAPE.test(x)) return `"${x.slice(0, 40)}" is not in Claude Code's rule form, for example Bash(npm test:*) or Read(./docs/**).`;
      if (x.startsWith('mcp__bunny__')) return 'That tool is Bunny\'s own and cannot be given a rule.';
    }
  }
  return null;
}

/** The engine choices in the settings, with defaults. */
export function engineSettings(settings = {}) {
  const engines = {};
  for (const id of ENGINE_IDS) {
    const s = settings.engines?.[id] ?? {};
    engines[id] = { auth: ['account', 'local'].includes(s.auth) ? s.auth : AUTH_DEFAULTS[id], enabled: s.enabled !== false, rules: cleanRules(s.rules) };
  }
  const engine = ['bunny', ...ENGINE_IDS].includes(settings.engine) ? settings.engine : 'bunny';
  return { engine, engines, useBunnyEngine: settings.useBunnyEngine !== false };
}

/** A sentence if the engine settings in a patch are not acceptable, else null. */
export function validateEngineSettings(patch = {}) {
  if (Object.hasOwn(patch, 'engine') && !['bunny', ...ENGINE_IDS].includes(patch.engine)) return 'Choose Bunny, Claude Code or Codex CLI.';
  if (Object.hasOwn(patch, 'useBunnyEngine') && typeof patch.useBunnyEngine !== 'boolean') return 'Use Bunny\'s engine is on or off.';
  if (Object.hasOwn(patch, 'engines')) {
    const e = patch.engines;
    if (!e || typeof e !== 'object' || Array.isArray(e)) return 'The engine settings are not valid.';
    for (const [id, v] of Object.entries(e)) {
      if (!ENGINE_IDS.includes(id)) return `Bunny has no engine called ${JSON.stringify(id.slice(0, 30))}.`;
      if (!v || typeof v !== 'object') return 'The engine settings are not valid.';
      for (const k of Object.keys(v)) if (!['auth', 'enabled', 'rules'].includes(k)) return `An engine has no setting called ${JSON.stringify(k.slice(0, 30))}.`;
      if (v.auth !== undefined && !['account', 'local'].includes(v.auth)) return 'Choose Sign in with an account, or Operate locally.';
      if (id === 'codex' && v.auth === 'account') return CODEX_ACCOUNT_NOTE;
      if (v.enabled !== undefined && typeof v.enabled !== 'boolean') return 'An engine is on or off.';
      if (v.rules !== undefined) { if (id !== 'claude-code') return 'Only Claude Code has rules to edit: Codex asks about every step.'; const bad = validateRules(v.rules); if (bad) return bad; }
    }
  }
  return null;
}

// ---------------------------------------------------------------- the fake pieces (gate and e2e)

function fakePins() {
  const archive = makeZipForFake();
  const sha = createHash('sha256').update(archive).digest('hex');
  const mk = (id, label) => ({ version: '1.0.0', entry: 'fake.exe', label, licence: 'test', hosts: ['fake.test'], signature: 'Fake Co', files: [{ name: `${id}.zip`, url: `https://fake.test/${id}.zip`, sha256: sha, kind: 'zip', size: archive.length }] });
  return { pins: { 'claude-code': { ...mk('claude-code', 'Claude Code'), promptTool: true }, codex: { ...mk('codex', 'Codex CLI'), model: 'gpt-5.5', sessionAllow: true } }, archive };
}

/** The Chat Completions stream for the model endpoint: the chat's own provider, through fetch (the stand-in answers in fake mode). */
export function makeUpstream({ provider, apiKey, model, fake, fetchImpl = globalThis.fetch }) {
  return async function* upstream({ chat, signal }) {
    if (fake && !provider.custom) {
      yield { choices: [{ delta: { role: 'assistant', content: 'This is the stand-in model answering for the engine.' }, finish_reason: null }] };
      yield { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 9 } };
      return;
    }
    const headers = { 'content-type': 'application/json', accept: 'text/event-stream' };
    if (apiKey) { headers.authorization = `Bearer ${apiKey}`; if (provider.auth?.header) headers[provider.auth.header] = apiKey; if (provider.auth?.extra) Object.assign(headers, provider.auth.extra); }
    const body = { ...chat, model, stream: true, stream_options: { include_usage: true } };
    const res = await fetchImpl(`${String(provider.baseUrl).replace(/\/+$/, '')}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (!res.ok) throw new Error(`The model provider answered ${res.status}: ${cutResult(await res.text().catch(() => ''), 300)}`);
    const decoder = new TextDecoder(); let buf = '';
    for await (const part of res.body) {
      buf += decoder.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try { yield JSON.parse(data); } catch { /* a comment or a broken line */ }
      }
    }
  };
}

/**
 * EN-6 (CE-4.5): an engine run counts against the chat's token budget at the endpoint. At the budget Bunny stops forwarding and asks through the existing limit card (`turn.onLimit`);
 * no answer, or "stop", means the run stops. "Keep going" raises the budget by the same amount. Without a budget (0) nothing is counted.
 */
export function budgeted(upstream, turn) {
  let budget = Number(turn.tokenBudget) || 0; const step = budget; let used = 0;
  return async function* guarded(args) {
    if (budget && used >= budget) {
      let go = false;
      try { go = Boolean(await turn.onLimit?.({ kind: 'tokens', inputTokens: used })); } catch { go = false; }
      if (!go) { turn.limitHit = true; throw new Error('The token budget for this job was reached, so the run stopped.'); }
      budget += step;
    }
    for await (const chunk of upstream(args)) {
      if (chunk?.usage) used += Number(chunk.usage.prompt_tokens ?? 0) + Number(chunk.usage.completion_tokens ?? 0);
      yield chunk;
    }
  };
}


// ---------------------------------------------------------------- the service

export function createEngineService({ dataDir, fake = Boolean(process.env.BUNNY_FAKE_ENGINE), pinsOverride = null, fetchImpl = null, versionOf, signatureOf, busyCheck = () => false, openLoginRun = null, loginWaitMs = 12_000 } = {}) {
  const fakeMode = Boolean(fake);
  const fp = fakeMode ? fakePins() : null;
  const pins = pinsOverride ?? (fakeMode ? fp.pins : loadPins());
  const registry = fetchImpl ?? (fakeMode ? async () => ({ status: 200, ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(fp.archive.length) : null) }, body: new ReadableStream({ async start(c) { for (let o = 0; o < fp.archive.length; o += 4096) { c.enqueue(new Uint8Array(fp.archive.subarray(o, o + 4096))); await new Promise((r) => setTimeout(r, 15)); } c.close(); } }) }) : globalThis.fetch);
  const running = new Set(); // engine ids with a reply going
  const store = createEngineStore({ dataDir, pins, fetchImpl: registry, busy: (id) => running.has(id) || busyCheck(id), ...(fakeMode ? { versionOf: async () => 'fake 1.0.0', signatureOf: async () => ({ ok: true }) } : {}), ...(versionOf ? { versionOf } : {}), ...(signatureOf ? { signatureOf } : {}) });
  const progress = new Map(); const lastError = new Map(); let schemaPromise = null;
  const schema = () => (schemaPromise ??= loadSchema().catch(() => null));

  // ------------------------------------------------------------ Claude Code account sign-in (spec 7.1): the vendor's own flow, in one account folder; Bunny reads only "signed in or not"
  const accountHome = join(dataDir, 'engines', 'claude-code', 'account', 'home');
  const accountConfig = join(accountHome, 'config');
  const authCache = new Map(); // id -> { at, signedIn }
  const AUTH_TTL_MS = 30_000;
  const authEnv = () => ({ CLAUDE_CONFIG_DIR: accountConfig, HOME: accountHome, USERPROFILE: accountHome, APPDATA: join(accountHome, 'AppData', 'Roaming'), LOCALAPPDATA: join(accountHome, 'AppData', 'Local') });
  const fakeFlag = () => join(accountConfig, 'fake-signed-in');

  /** Ask the engine itself whether the account is signed in: true / false, or null when it cannot be told. The answer is the boolean only: nothing the engine prints is kept. */
  async function readSignedIn(id) {
    if (id !== 'claude-code') return null;
    if (fakeMode) return existsSync(fakeFlag());
    const found = await store.locate(id);
    if (!found.ok) return null;
    await mkdir(accountConfig, { recursive: true });
    let run;
    try { run = spawnEngine({ file: found.exe, args: AUTH_COMMANDS.status, cwd: accountHome, extraEnv: authEnv() }); } catch { return null; }
    run.end();
    let out = '';
    const reader = (async () => { try { for await (const line of run.lines) out = (out + line).slice(0, 4000); } catch { /* unreadable: unknown */ } })();
    const timer = setTimeout(() => run.kill(), 20_000);
    const code = await run.exited; clearTimeout(timer); await reader;
    try { const j = JSON.parse(out); if (typeof j.loggedIn === 'boolean') return j.loggedIn; } catch { /* not JSON */ }
    return code === 0 ? true : code === 1 ? false : null;
  }
  async function refreshAuth(id) { const signedIn = await readSignedIn(id).catch(() => null); authCache.set(id, { at: Date.now(), signedIn }); return signedIn; }
  function cachedAuth(id) {
    const hit = authCache.get(id);
    if (!hit || Date.now() - hit.at > (hit.signedIn === true ? AUTH_TTL_MS : 2000)) { if (!authCache.get(`${id}:busy`)) { authCache.set(`${id}:busy`, true); refreshAuth(id).finally(() => authCache.delete(`${id}:busy`)); } }
    return hit?.signedIn ?? null;
  }

  /** Start the vendor's own sign-in, with only the account folder set, and say what really happened: { started: true, url } when the program printed its sign-in page (the person opens it with one click),
   * { started: true, url: null } when it is running but showed no page address (nobody can tell whether a browser page opened), or an error that says why it could not start or stopped.
   * v0.1.14.1: the program has no console window (a detached one with its output thrown away never opened a page on some PCs), so what it prints is read here: only the page address, and nothing is kept. */
  const loginRuns = new Map(); // id -> the running sign-in, so a second click replaces it and the end of the session stops it
  const LOGIN_LIFETIME_MS = 10 * 60_000;
  async function signIn(id) {
    if (id !== 'claude-code') throw Object.assign(new Error('Only Claude Code signs in with an account for now.'), { status: 400 });
    const found = fakeMode ? { ok: true } : await store.locate(id);
    if (!found.ok) throw Object.assign(new Error('Download Claude Code first.'), { status: 409 });
    await mkdir(accountConfig, { recursive: true });
    authCache.delete(id);
    await store.addRecord({ engine: id, action: 'signin', from: null, to: null, sha12: '' });
    if (fakeMode && !openLoginRun) { setTimeout(() => writeFile(fakeFlag(), '1').catch(() => {}), 200); return { started: true, url: 'https://claude.ai/login?stand-in=1' }; }
    loginRuns.get(id)?.kill?.();
    let run;
    try { run = (openLoginRun ?? spawnEngine)({ file: found.exe, args: AUTH_COMMANDS.login, cwd: accountHome, extraEnv: authEnv() }); }
    catch (err) { throw Object.assign(new Error(`Claude Code's sign-in could not start (${String(err?.message ?? err).slice(0, 120)}).`), { status: 502 }); }
    loginRuns.set(id, run);
    let said = '';
    let exitCode;
    let url = null;
    run.exited.then((code) => { exitCode = code; if (loginRuns.get(id) === run) loginRuns.delete(id); authCache.delete(id); }).catch(() => {});
    (async () => { try { for await (const line of run.lines) { said = (said + line + '\n').slice(-8000); url ??= signInUrlFrom(said); } } catch { /* unreadable: no address */ } })();
    const stop = setTimeout(() => { try { run.kill?.(); } catch { /* gone */ } }, LOGIN_LIFETIME_MS); stop.unref?.();
    run.exited.finally(() => clearTimeout(stop)).catch(() => {});
    const t0 = Date.now();
    while (url === null && exitCode === undefined && Date.now() - t0 < loginWaitMs) { url ??= signInUrlFrom(`${said}\n${run.stderr?.() ?? ''}`); if (url) break; await new Promise((r) => setTimeout(r, 100)); }
    url ??= signInUrlFrom(`${said}\n${run.stderr?.() ?? ''}`);
    if (url && exitCode === undefined) await new Promise((r) => setTimeout(r, 300)); // a program that prints an address and stops at once with an error did not sign anyone in
    if (url && (exitCode === undefined || exitCode === 0)) return { started: true, url }; // a program that already stopped with an error is a failure, whatever address its message holds
    if (exitCode !== undefined && exitCode !== 0) {
      const why = String(run.stderr?.() ?? said).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
      throw Object.assign(new Error(`Claude Code's sign-in stopped before it showed a page (exit code ${exitCode}).${why ? ` It said: ${why.replace(/https?:\/\/\S+/g, '[address]').slice(0, 160)}` : ''}`), { status: 502 });
    }
    if (exitCode === 0) { await refreshAuth(id).catch(() => {}); return { started: true, url: null, finished: true }; }
    return { started: true, url: null };
  }

  /** Sign out: the vendor's own logout in the account folder, then the folder is deleted. */
  async function signOut(id) {
    if (id !== 'claude-code') throw Object.assign(new Error('Only Claude Code signs in with an account for now.'), { status: 400 });
    if (running.has(id)) throw Object.assign(new Error('Claude Code is answering right now. Sign out when it has finished.'), { status: 409 });
    if (!fakeMode) {
      const found = await store.locate(id);
      if (found.ok) {
        try { const run = spawnEngine({ file: found.exe, args: AUTH_COMMANDS.logout, cwd: accountHome, extraEnv: authEnv() }); run.end(); const t = setTimeout(() => run.kill(), 20_000); await run.exited; clearTimeout(t); } catch { /* the folder is deleted anyway */ }
      }
    }
    await removeTree(join(dataDir, 'engines', 'claude-code', 'account')).catch(() => {});
    authCache.delete(id);
    await store.addRecord({ engine: id, action: 'signout', from: null, to: null, sha12: '' });
    return { ok: true };
  }

  async function status(settings) {
    const st = await store.status();
    const cfg = engineSettings(settings);
    const list = [];
    for (const id of ENGINE_IDS) {
      const s = st[id];
      list.push({
        id, label: LABELS[id], downloaded: s.downloaded, version: s.version, available: s.available, updateAvailable: s.updateAvailable, previous: s.previous, sizeBytes: s.sizeBytes,
        downloading: s.downloading, progress: progress.get(id) ?? null, error: lastError.get(id) ?? null, enabled: cfg.engines[id].enabled, auth: cfg.engines[id].auth, recommendedAuth: AUTH_DEFAULTS[id],
        authModes: id === 'codex' ? { local: { available: true }, account: { available: false, note: CODEX_ACCOUNT_NOTE } } : { local: { available: true, note: LOCAL_NOTE_CLAUDE }, account: { available: true } },
        licence: pins[id]?.licence ?? '',
        signedIn: id === 'claude-code' && s.downloaded ? cachedAuth(id) : null,
        rules: cfg.engines[id].rules, rulesEditable: id === 'claude-code', ownRules: ownRulesOk(id),
      });
    }
    return { engines: list, engine: cfg.engine, useBunnyEngine: cfg.useBunnyEngine, fake: fakeMode };
  }

  /** Start a download in the background (progress through status); resolves at once. */
  function startDownload(id) {
    if (!ENGINE_IDS.includes(id)) throw Object.assign(new Error('Bunny does not know that engine.'), { status: 404 });
    lastError.delete(id);
    progress.set(id, { bytes: 0, total: 0 });
    store.download(id, { onProgress: (p) => progress.set(id, { bytes: p.bytes, total: p.total, file: p.file, files: p.files }) })
      .catch((err) => { lastError.set(id, err.message); })
      .finally(() => { progress.delete(id); });
    return { started: true };
  }

  // ------------------------------------------------------------ one reply on an engine

  /**
   * Run one Code-mode reply. `turn`: { id (the chat), session, content, workspace root `root`, permissionMode, send, logStep, askPermission, signal, provider, apiKey, model,
   * incognito, beforeWrite, rules (the folder's rules), hidden, settings, onSession(engineSessionId), usageRecord(text) }.
   * Resolves { text, ok, stoppedForCheck }.
   */
  async function runTurn(turn) {
    const { session, settings } = turn;
    const choice = session.engine ?? { id: engineSettings(settings).engine, auth: null };
    const id = choice.id;
    const label = LABELS[id] ?? id;
    const auth = choice.auth ?? engineSettings(settings).engines[id].auth;
    let mode = choice.restricted ? 'restricted' : 'full';
    // ENGINE-RULES: with Bunny's engine off the chat follows the engine's own rules, fixed at its first message; restricted mode keeps Bunny's diff review, and an engine whose prompt tool is unproven stays on Bunny's rules
    const ownRules = choice.rules === 'engine' && mode === 'full' && ownRulesOk(id);
    const home = join(dataDir, 'engines', id, auth, 'chat', String(turn.id).replace(/[^\w-]/g, '_'));
    await mkdir(home, { recursive: true });
    let assembled = ''; let stoppedForCheck = false; let ok = true;
    if (id === 'claude-code' && auth === 'account' && (!fakeMode || process.env.BUNNY_FAKE_SIGNIN_REQUIRED)) {
      if ((await refreshAuth(id)) === false) {
        const why = 'Claude Code is not signed in. Sign in in Settings, Engines, or switch it to Local.';
        turn.send('error', { code: 'engine.signin', message: why });
        await turn.logStep({ role: 'assistant', kind: 'error', content: why });
        return { text: '', ok: false };
      }
    }

    // where the program is
    let exe = null; let launcher = null;
    if (fakeMode) {
      const script = process.env.BUNNY_FAKE_ENGINE_SCRIPT ?? '{"steps":[{"say":"Done."}]}';
      launcher = [process.execPath, FAKE_ENGINE_PATH, id];
      exe = 'fake';
      turn.extraEnv = { BUNNY_FAKE_SCRIPT: script };
    } else {
      const found = await store.locate(id);
      if (!found.ok) {
        const why = found.reason === 'not-downloaded' ? `${label} is not downloaded yet. Download it in Settings, Engines, or use Bunny's engine.` : `${label} cannot run (${found.reason}). ${found.canRollBack ? 'Roll back to the earlier version in Settings, Engines, ' : 'Download it again in Settings, Engines, '}or use Bunny's engine.`;
        turn.send('error', { code: 'engine.missing', message: why });
        await turn.logStep({ role: 'assistant', kind: 'error', content: why });
        return { text: '', ok: false };
      }
      exe = found.exe;
    }

    // the one judge
    const root = turn.root;
    const planMode = turn.permissionMode === 'plan';
    const ctx = {
      mode: () => turn.permissionMode, rules: () => (ownRules ? [] : rulesFor(settings.permissionRules, root)), root, protect: [dataDir], keyFolders: keyFolders({ home: homedir() }),
      ask: async (summary, detail, opts = {}) => {
        // "Allow for this chat" is offered on Codex's cards only, and only with Bunny's engine off
        const answer = await turn.askPermission(`${label} asks: ${summary}`, detail, ownRules && id === 'codex' && opts.forSession === true && pins.codex?.sessionAllow === true ? { forSession: true } : {});
        const ok = answer === true || answer === 'session';
        if (ownRules) await turn.logStep({ role: 'assistant', kind: 'tool_call', tool: `${label} asked: ${summary}`, status: ok ? 'allowed' : 'denied', content: '', result: answer === 'session' ? 'You allowed it for this chat.' : ok ? 'You allowed it.' : 'You did not allow it.' }).catch(() => {});
        return ownRules && id === 'codex' && answer === 'session' ? 'session' : ok;
      },
    };
    const bridge = createBridge(ctx);
    const checked = async (res, paths) => { if (res.allow && res.name !== 'run_command' && res.name !== 'read_file') for (const p of paths) await turn.beforeWrite?.(p).catch(() => {}); return res; };
    const judgeClaude = async (req) => {
      const p = req.input?.file_path ?? req.input?.path ?? req.input?.notebook_path;
      if (ownRules) { const r = await bridge.claudeFloor(req); if (r.abstain && p && ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(req.tool)) await turn.beforeWrite?.(p).catch(() => {}); return r; } // the checkpoint is taken before a write the engine may then do
      const r = await bridge.claude(req); return checked(r, p ? [p] : []);
    };
    const decideClaude = async (req) => { const r = await bridge.claudeAsk(req); const p = req.input?.file_path ?? req.input?.path; return checked(r, p ? [p] : []); };
    const bridgeForCodex = ownRules ? {
      codexCommand: (params) => bridge.codexCommandRelay(params),
      codexChanges: async (changes) => { const r = await bridge.codexChangesRelay(changes); return checked(r, (changes ?? []).map((c) => c?.path).filter(Boolean)); },
    } : {
      codexCommand: (params) => bridge.codexCommand(params),
      codexChanges: async (changes) => { const r = await bridge.codexChanges(changes); return checked(r, (changes ?? []).map((c) => c?.path).filter(Boolean)); },
    };

    // restricted mode works in a copy and Bunny reviews the diff at the end
    let cwd = root; let staged = null;
    if (mode === 'restricted') {
      const dir = stageDirFor(dataDir, id, turn.id);
      staged = await stage({ root, dir, hidden: turn.hidden ?? (() => false), keepOut: [dataDir] });
      cwd = dir;
    }

    running.add(id);
    const control = new AbortController();
    turn.signal?.addEventListener?.('abort', () => control.abort(), { once: true });
    let run;
    try {
      const deny = denyRules({ rules: ownRules ? [] : rulesFor(settings.permissionRules, root), root, protect: [dataDir, join(dataDir, 'engines')], keyFolders: keyFolders({ home: homedir() }) });
      if (id === 'claude-code') {
        run = await startClaude({ cwd, prompt: turn.content, home, exe, auth, mode, planMode, resumeId: choice.sessionId ?? null, deny, judge: judgeClaude, signal: control.signal, launcher, extraEnv: turn.extraEnv ?? {}, silenceMs: 10 * 60_000, configDir: auth === 'account' ? accountConfig : null, rules: ownRules ? 'engine' : 'bunny', engineRules: ownRules ? cleanRules(engineSettings(settings).engines['claude-code'].rules) : null, decide: ownRules ? decideClaude : null,
          upstream: auth === 'local' ? budgeted(makeUpstream({ provider: turn.provider, apiKey: turn.apiKey, model: turn.model, fake: turn.fake }), turn) : null, onEndpointUsage: (u) => { turn.noteUsage?.(u); } });
      } else {
        const sch = await schema();
        if (!fakeMode) await seedHome({ dataDir, root: turn.root, codexHome: join(home, 'codex') }); // the first command of a chat is not a 3-minute sandbox set-up (see sandbox-seed.js)
        run = await startCodex({ cwd, prompt: turn.content, home, exe, auth, mode, planMode, model: pins.codex.model, bridge: bridgeForCodex, signal: control.signal, launcher, extraEnv: turn.extraEnv ?? {}, schema: fakeMode ? null : sch, silenceMs: 10 * 60_000,
          upstream: budgeted(makeUpstream({ provider: turn.provider, apiKey: turn.apiKey, model: turn.model, fake: turn.fake }), turn), onEndpointUsage: (u) => { turn.noteUsage?.(u); } });
      }
      const steps = new Map();
      for await (const ev of run.events) {
        if (ev.type === 'text') { assembled += ev.delta; turn.send('delta', { text: ev.delta }); }
        else if (ev.type === 'thinking') turn.send('thinking', { text: ev.delta });
        else if (ev.type === 'tool-start') { turn.logTool?.(`${id}:${ev.name}`); const tool = `${label}: ${ev.engineTool ?? ev.name}${ev.input?.command ? ` ${cutResult(ev.input.command, 80)}` : ev.input?.file_path ? ` ${ev.input.file_path}` : ev.input?.paths?.length ? ` ${ev.input.paths[0]}` : ''}`; steps.set(ev.callId, tool); turn.send('tool', { tool, status: 'running' }); }
        else if (ev.type === 'tool-end') { const tool = steps.get(ev.callId) ?? `${label} tool`; const status = ev.ok ? 'done' : 'failed'; await turn.logStep({ role: 'assistant', kind: 'tool_call', tool, status, content: '', result: cutResult(ev.output ?? '', 1200), fullResult: ev.output ?? '' }); turn.send('tool', { tool, status, result: cutResult(ev.output ?? '', 1200) }); }
        else if (ev.type === 'session') await turn.onSession?.(ev.engineSessionId, pinVersion(id));
        else if (ev.type === 'usage') turn.noteUsage?.({ input: ev.input, output: ev.output });
        else if (ev.type === 'error') {
          ok = false;
          if (ev.code === 'watchdog' || ev.code === 'engine.tools') stoppedForCheck = true;
          turn.send('error', { code: `engine.${ev.code ?? 'failed'}`, message: ev.message });
          await turn.logStep({ role: 'assistant', kind: 'error', content: `${label} stopped: ${ev.message}` });
        }
      }
    } catch (err) {
      ok = false;
      turn.send('error', { code: 'engine.start', message: `${label} could not start: ${cutResult(err.message, 300)}` });
      await turn.logStep({ role: 'assistant', kind: 'error', content: `${label} could not start: ${err.message}` });
    } finally {
      running.delete(id);
      try { await run?.stop?.(); } catch { /* ended */ }
    }

    if (staged) {
      try {
        const changes = await diff({ root, dir: staged.dir, manifest: staged.manifest });
        const collector = createBridge({ ...ctx, ask: async (summary, detail) => { void summary; void detail; return false; } });
        const result = await review({ root, dir: staged.dir, changes, mode: turn.permissionMode, judge: (c) => collector.judge(c), ask: (summary, detail) => turn.askPermission(summary, detail), writeReal: (rel, buf) => turn.writeReal(rel, buf) });
        const said = describeReview(result);
        assembled += `${assembled ? '\n\n' : ''}${said}`; turn.send('delta', { text: `${assembled === said ? '' : '\n\n'}${said}` });
      } finally { await discard(staged.dir); }
    }
    if (id === 'codex' && !fakeMode) await keepSeed({ dataDir, root: turn.root, codexHome: join(home, 'codex') });
    if (turn.incognito) await removeTree(home).catch(() => {});
    return { text: assembled, ok, stoppedForCheck };
  }

  /** Can this engine follow its own rules while Bunny's engine is off? Claude Code only where the prompt-tool spike passed for the pinned version (pins.json: promptTool); Codex always asks. */
  const ownRulesOk = (id) => id === 'codex' || (id === 'claude-code' && pins['claude-code']?.promptTool === true);
  const pinVersion = (id) => pins[id]?.version ?? null;

  const busy = (id) => running.has(id);
  return { store, pins, status, startDownload, signIn, signOut, refreshAuth, runTurn, busy, progress, ids: ENGINE_IDS, fake: fakeMode, randomId: randomUUID };
}

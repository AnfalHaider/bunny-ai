/**
 * BROWSER, step 2: let a phone or another computer on the SAME local network open Bunny, behind a passcode.
 *
 * OFF until the person turns it on. REMOTE-STAY (owner, 2026-11-18): once on it stays on across restarts until the person turns it off; the app then opens it again at start
 * (resumeRemote in app.js) on the same network only, and every device signs in again (sessions are never saved). While it is on:
 *  - a second server listens on the PC's local-network address ONLY (127.0.0.1 keeps its own server and its own rules, untouched);
 *  - nothing is served to a device that has not signed in except the sign-in page; no token is handed out, no API answers;
 *  - a session is an HttpOnly, SameSite=Strict cookie, and every write also needs the session's own CSRF header;
 *  - five wrong passcodes in a row make that device wait (longer each time); a flood from many devices makes everyone wait;
 *  - the Host header must be exactly the LAN address and port, the Origin (when sent) exactly that origin: nothing wider;
 *  - a remote device never gets a window-only route, and may only do the small allow-list in remotePolicy() below.
 * Pure of sockets and files except the passcode record (a salt and a scrypt hash: the passcode itself is never stored).
 */
import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { execFile } from 'node:child_process';
import { powershellPath, safeEnv } from './safeExec.js';

export const MIN_PASSCODE = 12;
export const COOKIE = 'bunny_remote';
export const SESSION_IDLE_MS = 2 * 60 * 60 * 1000; // R7: two hours without use ends a session
export const FAILS_BEFORE_WAIT = 5;
/** DEVICE-FULL: what a signed-in device may do. 'chats' (the default) is the small allow-list below; 'everything' is what Bunny's window can do, except /api/remote*. Only the window sets it. */
/** DEVICE-FULL (Security R-DF1): a device at Everything is signed out after 30 minutes idle, not 2 hours. */
export const EVERYTHING_IDLE_MS = 30 * 60 * 1000;
/** R-DF2: the action log keeps the last 500 entries or 30 days, whichever is fewer. */
export const LOG_MAX_ENTRIES = 500;
export const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const LEVELS = Object.freeze(['chats', 'everything']);
export const DEFAULT_LEVEL = 'chats';
/** Routes even an 'everything' device never reaches: turning device access on or off, the list, levels, signing out OTHER devices. (A device may still sign ITSELF out: /api/remote/signout.) */
/** What a device at Everything is told when it reaches for device access (the drawn sentence). */
export const DEVICE_ACCESS_MESSAGE = "Only Bunny's window can change device access.";
export const isRemoteAdminPath = (path) => /^\/api\/remote(\/|$)/.test(String(path));
export const FLOOD_LIMIT = 30; // wrong tries from anyone in 10 minutes before everyone waits a minute
const KDF = { N: 16384, r: 8, p: 1, keylen: 32 };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I: readable aloud

/** A passcode Bunny makes: 20 characters from a 32-letter alphabet (100 bits), in four groups. Shown once. */
export function generatePasscode() {
  const pick = () => ALPHABET[randomInt(ALPHABET.length)];
  return Array.from({ length: 4 }, () => Array.from({ length: 5 }, pick).join('')).join('-');
}

/** What the person typed, checked: at least 12 characters (spaces at the ends do not count). */
export function checkPasscodeChoice(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < MIN_PASSCODE) return { ok: false, message: `The passcode needs at least ${MIN_PASSCODE} characters.` };
  if (text.length > 200) return { ok: false, message: 'That passcode is too long.' };
  return { ok: true, passcode: text };
}

const scryptAsync = (secret, salt) => new Promise((resolve, reject) => scrypt(secret, salt, KDF.keylen, { N: KDF.N, r: KDF.r, p: KDF.p }, (err, key) => (err ? reject(err) : resolve(key))));

/** A salted scrypt record of a passcode. The passcode itself is never kept. */
export async function hashPasscode(passcode) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(String(passcode), salt);
  return { v: 1, kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt: salt.toString('hex'), hash: hash.toString('hex') };
}

export async function verifyPasscode(passcode, record) {
  if (!record || record.kdf !== 'scrypt' || typeof record.salt !== 'string' || typeof record.hash !== 'string') return false;
  try {
    const salt = Buffer.from(record.salt, 'hex');
    const want = Buffer.from(record.hash, 'hex');
    const got = await scryptAsync(String(passcode ?? ''), salt);
    return got.length === want.length && timingSafeEqual(got, want);
  } catch { return false; }
}

/** REMOTE-STAY (RS-4): the one plain sentence on the "Allow other devices" row when Bunny does not open it again at start. */
export const NOT_OPENED_NETWORK = "Not opened: this network isn't the one you turned it on with. Turn it on again to allow it here.";
/** RS4-a: on Windows, when Bunny could not tell which network it was turned on with, it does not reopen by itself. Said on the row while it is on, and again at start. */
export const NOT_OPENED_UNKNOWN_NETWORK = 'Bunny could not tell which network this is, so it will not reopen by itself after a restart.';
export const NOT_OPENED_NO_NETWORK = 'Not opened: no local network was found. Turn it on again when you are connected.';
export const NOT_OPENED_NO_PASSCODE = 'Not opened: the saved passcode was not found. Turn it on again and choose one.';

const subnet24 = (a) => String(a ?? '').split('.').slice(0, 3).join('.');

/**
 * RS-4: may Bunny open to other devices again at start? Only on the network access was turned on with, or on one Windows calls Private.
 * `saved` is what was kept when it was turned on ({ address, network: { name, category } | null }); `profile` is what the network is called now ({ name, category } | null).
 * A saved network name that cannot be read now means closed, and on Windows so does no saved name at all (RS4-a). With no saved name on another system, the same /24 as the saved address stands for "the same network".
 */
export function canReopen(saved, lan, profile, platform = process.platform) {
  if (!lan) return { ok: false, reason: NOT_OPENED_NO_NETWORK };
  if (profile?.category === 'Private') return { ok: true };
  // RS4-a: on Windows a network is always named, so a missing saved name means it could not be read when access was turned on: closed (the /24 is only for systems that have no names)
  if (platform === 'win32' && !saved?.network?.name) return { ok: false, reason: NOT_OPENED_UNKNOWN_NETWORK };
  // A network name was saved: it has to be read now and be the same (fail closed when Windows cannot say). Only when none was ever known (not Windows) does the same /24 stand for it.
  const same = saved?.network?.name ? profile?.name === saved.network.name : Boolean(saved?.address) && subnet24(saved.address) === subnet24(lan);
  return same ? { ok: true } : { ok: false, reason: NOT_OPENED_NETWORK };
}

/** What Windows calls the network behind this local address: { name, category: 'Private' | 'Public' | 'DomainAuthenticated' } or null (not Windows, or it could not be asked). The address is private IPv4 only. */
export async function networkProfileOf(address, { interfaces = networkInterfaces(), platform = process.platform, run = null } = {}) {
  if (platform !== 'win32') return null;
  const alias = Object.entries(interfaces).find(([, list]) => (list ?? []).some((i) => i.address === address))?.[0];
  if (!alias) return null;
  const ask = run ?? ((alias2) => new Promise((resolve) => {
    // RS4-b: PowerShell by its full path and the safe environment (the W29-1 pattern), not a bare name with the whole environment
    execFile(powershellPath() ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-NetConnectionProfile -InterfaceAlias $env:BUNNY_NET_ALIAS | Select-Object -First 1 Name,NetworkCategory | ConvertTo-Json -Compress'],
      { timeout: 5000, windowsHide: true, env: safeEnv({ BUNNY_NET_ALIAS: alias2 }) }, (err, out) => resolve(err ? null : String(out)));
  }));
  try {
    const parsed = JSON.parse(String(await ask(alias)).trim());
    const raw = parsed?.NetworkCategory;
    const category = typeof raw === 'string' ? raw : ({ 0: 'Public', 1: 'Private', 2: 'DomainAuthenticated' }[raw] ?? '');
    return parsed?.Name ? { name: String(parsed.Name), category } : null;
  } catch { return null; }
}

/** The PC's local-network IPv4 address (a private range), or null. A test may pass its own. */
export function findLanAddress(interfaces = networkInterfaces()) {
  const private4 = (a) => /^10\./.test(a) || /^192\.168\./.test(a) || /^172\.(1[6-9]|2\d|3[01])\./.test(a);
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal && private4(i.address)) return i.address;
    }
  }
  return null;
}

/**
 * What a signed-in remote device may do. Everything else is "Bunny's window only". Default deny.
 * The owner's decision (2026-11-18): a device gets ORDINARY chats: a chat's own work mode, folder and tools, answering that chat's own permission, question and capability cards,
 * and choosing the mode of a chat. Still the window's alone: the default permission mode, permission rules, connectors, installs and plugins, skills, schedules, hooks, providers,
 * accounts, updates, the window-only settings, the terminal, driving the computer, picking folders, and /api/remote itself.
 */
import { isWindowOnlyRoute } from './windowOnly.js';
const UUID = '[a-f0-9-]{36}';
const READ = [
  /^\/api\/(health|version|models|providers|abilities|usage|search|projects|artifacts|profile\/photo|speech\/voices|settings|processes)$/,
  new RegExp(`^/api/sessions(/${UUID}(/.*)?)?$`),
  new RegExp(`^/api/artifacts/${UUID}(/raw)?$`),
  /^\/api\/remote\/me$/,
];
const WRITE = [
  ['POST', /^\/api\/sessions$/],
  ['POST', new RegExp(`^/api/sessions/${UUID}/(messages|stop|undo|compact|branch|summary|title)$`)],
  ['POST', new RegExp(`^/api/sessions/${UUID}/(permission|question|capability)/${UUID}$`)],
  ['PATCH', new RegExp(`^/api/sessions/${UUID}$`)],
  ['PATCH', new RegExp(`^/api/sessions/${UUID}/setting/(permissionMode|workMode|effort|model|providerId)$`)], // never folder, branch, project or anything else
  ['DELETE', new RegExp(`^/api/sessions/${UUID}$`)],
  ['POST', /^\/api\/artifacts$/],
  ['PATCH', new RegExp(`^/api/artifacts/${UUID}$`)],
  ['DELETE', new RegExp(`^/api/artifacts/${UUID}$`)],
  ['POST', /^\/api\/remote\/signout$/],
];
export function remotePolicy(method, path) {
  const m = String(method).toUpperCase();
  if (!path.startsWith('/api/')) return m === 'GET' || m === 'HEAD'; // the app's own page files (read only)
  if (m === 'GET') return READ.some((re) => re.test(path));
  return WRITE.some(([method2, re]) => method2 === m && re.test(path));
}

/**
 * The few window-only routes a signed-in device MAY still use, for a chat it can see (the cookie and the CSRF token are required before this is asked):
 * answering that chat's own permission, question and capability cards, and choosing the mode of a chat (new or opened). Nothing else that is window-only.
 */
export function remoteException(method, path, body = null) {
  const m = String(method).toUpperCase();
  if (m === 'POST' && new RegExp(`^/api/sessions/${UUID}/(permission|question|capability)/${UUID}$`).test(path)) return true;
  if (m === 'PATCH' && new RegExp(`^/api/sessions/${UUID}/setting/permissionMode$`).test(path)) return true;
  if ((m === 'POST' && path === '/api/sessions') || (m === 'PATCH' && new RegExp(`^/api/sessions/${UUID}$`).test(path))) {
    if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'permissionMode')) return false;
    const { permissionMode: _mode, ...rest } = body;
    return !isWindowOnlyRoute(m, path, rest); // the mode, and nothing else that is window-only, is in the body
  }
  return false;
}

/** R1: the capability cards a device may answer. The others switch a global window-only setting or install something, and stay with the window. */
export const REMOTE_CAPABILITIES = ['code_mode', 'leave_plan_mode'];

/**
 * R2: the tools a chat from another device may use. An ALLOW-list: a tool that is not named here (a new one, a connector's, a custom one the model built) is denied.
 * Allowed: reading and searching, working in the chat's own folder (files, commands, programs), artifacts, questions, asking for the chat's own capabilities, helpers
 * (they use the same checks) and the person's Google and GitHub tools that a card guards. Denied: driving the computer or the window's browser panel, building or installing
 * anything, connectors, skills, schedules, memory, and starting or messaging other chats (all of which change what Bunny may do, or outlive the device's chat).
 * test/remote-access.test.js checks that every tool Bunny has is on exactly one of the two lists, so a new tool cannot be added without a decision.
 */
export const REMOTE_TOOLS_ALLOWED = Object.freeze([
  'web_search', 'read_url', 'search_plugins', 'read_skill', 'ask_user', 'request_capability', 'update_tasks', 'check_environment', 'run_subagent',
  'create_artifact', 'update_artifact',
  'list_files', 'read_file', 'find_files', 'search_files', 'edit_file', 'multi_edit', 'write_file', 'download_file',
  'run_command', 'start_process', 'read_process', 'list_processes', 'stop_process',
  'list_models', 'list_sessions', 'read_session', 'search_chats',
  'github_api_get', 'github_clone', 'github_comment', 'github_create_issue', 'github_create_pull_request', 'github_issue', 'github_list_issues', 'github_list_pull_requests', 'github_my_repos', 'github_pull_request', 'github_read_file', 'github_repo', 'github_search', 'github_update_issue',
  'gmail_draft', 'gmail_read', 'gmail_search', 'gmail_send', 'calendar_create_event', 'calendar_events', 'drive_read', 'drive_search',
]);
export const REMOTE_TOOLS_DENIED = Object.freeze([
  'computer_click', 'computer_key', 'computer_screenshot', 'computer_scroll', 'computer_type',
  'browser_back', 'browser_capture', 'browser_click', 'browser_compare', 'browser_inspect', 'browser_open', 'browser_read', 'browser_screenshot', 'browser_scroll', 'browser_type',
  'create_tool', 'install_plugin', 'install_from_github', 'add_connector', 'add_skill',
  'schedule_task', 'list_scheduled_tasks', 'remember', 'start_session', 'message_session', 'move_to_new_chat',
  'call_connector_tool', 'list_connector_tools',
]);
const allowedTools = new Set(REMOTE_TOOLS_ALLOWED);
export const remoteToolBlocked = (name) => !allowedTools.has(String(name ?? ''));
/**
 * R3: allow-lists. A new chat: its title, work mode, mode, effort, model and provider (no folder, and no project: a project can carry a folder).
 * A change to a chat (PATCH): the same, nothing else (never a folder, branch, project, pin or archive from a device).
 * A message: what the app's own page sends to talk to the model, nothing that decides where it works or how unattended it runs.
 */
const SESSION_KEYS = ['title', 'workMode', 'permissionMode', 'effort', 'providerId', 'model'];
const MESSAGE_KEYS = ['content', 'attachments', 'providerId', 'model', 'retry', 'vision', 'workMode', 'useSkill', 'thinking', 'job', 'auto', 'attemptsLeft', 'fellBackFrom', 'fellBackKind', 'fellBackProvider', 'fellBackReason', 'fellBackTries'];
const pick = (b, keys) => Object.fromEntries(keys.filter((k) => Object.hasOwn(b, k)).map((k) => [k, b[k]]));
export function remoteBody(path, body) {
  const b = body && typeof body === 'object' ? body : {};
  if (path === '/api/sessions') { const out = pick(b, SESSION_KEYS); if (typeof out.title === 'string') out.title = out.title.slice(0, 80); return out; }
  return pick(b, MESSAGE_KEYS);
}
export function remotePatch(body) {
  const b = body && typeof body === 'object' ? body : {};
  const out = pick(b, SESSION_KEYS);
  if (typeof out.title === 'string') out.title = out.title.slice(0, 80);
  return out;
}

/** R4: the settings a device may read: how things look and which model is chosen. No keys, no secrets, no instructions, no connectors. */
const DISPLAY_SETTINGS = ['theme', 'language', 'displayName', 'callName', 'codeFont', 'codeFontSize', 'codeThemeDark', 'codeThemeLight', 'interfaceFont', 'responseFont', 'motion', 'transcriptSize', 'transcriptWidth', 'uiZoom', 'transcriptView', 'statusLabels', 'promptSuggestions', 'providerId', 'model', 'defaultEffort', 'artifactsEnabled', 'chartsEnabled', 'summaryNextSteps', 'unrelatedTask', 'firstReplyWaitSeconds'];
export const remoteSettings = (settings) => pick(settings && typeof settings === 'object' ? settings : {}, DISPLAY_SETTINGS);
/** A short plain name for a device from its browser's own words. */
export function deviceLabel(userAgent = '') {
  const ua = String(userAgent);
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iOS/i.test(ua) ? 'iPhone or iPad' : /Windows/i.test(ua) ? 'Windows' : /Mac OS X|Macintosh/i.test(ua) ? 'Mac' : /Linux/i.test(ua) ? 'Linux' : 'A device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'a browser';
  return `${os} · ${browser}`;
}

export function readCookie(header, name = COOKIE) {
  for (const part of String(header ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return '';
}

export function createRemoteAccess({ file = null, logFile = null, now = () => Date.now(), onEnd = () => {} } = {}) {
  const idleLimit = (s) => (s.level === 'everything' ? EVERYTHING_IDLE_MS : SESSION_IDLE_MS);
  // R-DF2: what devices did, for the person to read in Bunny's window only. Names and routes only: never arguments, bodies, text or secrets.
  let actions = [];
  let loading = null;
  const prune = () => {
    const t = now();
    actions = actions.filter((a) => t - Date.parse(a.at) <= LOG_MAX_AGE_MS).slice(-LOG_MAX_ENTRIES);
  };
  // The saved log is read once, and ANYTHING that writes or reads waits for it, so a new entry after a restart is added to the old ones, never written over them.
  function loadActions() {
    loading ??= (async () => {
      if (!logFile) return;
      try { const saved = JSON.parse(await readFile(logFile, 'utf8')); if (Array.isArray(saved)) actions = saved.concat(actions); } catch { /* none yet */ }
      prune();
    })();
    return loading;
  }
  if (logFile) loadActions().catch(() => {}); // read the saved log at once; every write waits for it
  let saving = Promise.resolve();
  function logAction(device, entry) {
    const clean = { at: new Date(now()).toISOString(), device: device?.deviceId ?? null, label: device?.label ?? null, level: device?.level ?? null };
    for (const key of ['kind', 'tool', 'method', 'path']) if (typeof entry[key] === 'string') clean[key] = entry[key].slice(0, 200);
    if (typeof entry.level === 'string') clean.level = entry.level;
    if (typeof entry.from === 'string') clean.from = entry.from;
    actions.push(clean);
    prune();
    if (logFile) saving = saving.then(loadActions).then(async () => { prune(); await mkdir(dirname(logFile), { recursive: true }); await writeFile(logFile, JSON.stringify(actions)); }).catch(() => {});
  }
  let record = null;       // the scrypt record of the saved passcode
  let loaded = false;
  let on = false;          // never read back from a file: OFF after every restart
  let host = '';           // exactly "<lan address>:<port>" while on
  let address = null;
  const ended = (deviceIds) => { try { onEnd(deviceIds); } catch { /* the sessions are gone either way */ } }; // R6: lets the app put a device's Auto chats back to Ask
  const sessions = new Map(); // secret cookie value -> { deviceId, label, ip, csrf, signedInAt, lastSeen }
  const failures = new Map(); // ip -> { count, until }
  let recent = [];            // times of recent failures from anyone
  const inflight = new Map(); // ip -> tries being checked right now (scrypt takes time, and tries that arrive together must count together)
  let inflightAll = 0;

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!file) return;
    try { record = JSON.parse(await readFile(file, 'utf8')); } catch { record = null; }
  }
  async function savePasscode(passcode) {
    record = await hashPasscode(passcode);
    loaded = true;
    if (file) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(record)); }
  }

  const waitFor = (ip) => {
    const t = now();
    const own = failures.get(ip);
    const ownWait = own && own.until > t ? Math.ceil((own.until - t) / 1000) : 0;
    recent = recent.filter((x) => t - x < 10 * 60_000);
    const floodWait = recent.length > FLOOD_LIMIT && recent.at(-1) + 60_000 > t ? Math.ceil((recent.at(-1) + 60_000 - t) / 1000) : 0;
    return Math.max(ownWait, floodWait);
  };

  async function signIn(ip, passcode, userAgent = '') {
    await load();
    if (!on) return { ok: false, status: 403, message: 'Bunny is not open to other devices.' };
    const wait = waitFor(ip);
    if (wait > 0) return { ok: false, status: 429, waitSeconds: wait, message: `Too many tries. Wait ${wait} seconds and try again.` };
    // RA-1: a try is RESERVED before its (slow) check starts, so tries that arrive together count together. A device has FAILS_BEFORE_WAIT tries in all, counting the ones
    // already being checked; once it has used them, one at a time. Everyone together has FLOOD_LIMIT + 1 checked tries (those being checked count) before the flood wait.
    const flying = inflight.get(ip) ?? 0;
    const used = failures.get(ip)?.count ?? 0;
    const budget = used < FAILS_BEFORE_WAIT ? FAILS_BEFORE_WAIT - used : 1;
    if (flying >= budget) return { ok: false, status: 429, waitSeconds: 30, message: 'Too many tries. Wait 30 seconds and try again.' };
    // (the wrong tries of the last minutes count only while the last of them is under a minute old; tries in flight always count)
    if (recent.length + inflightAll > FLOOD_LIMIT && (inflightAll > 0 || recent.at(-1) + 60_000 > now())) return { ok: false, status: 429, waitSeconds: 60, message: 'Too many tries. Wait 60 seconds and try again.' };
    inflight.set(ip, flying + 1);
    inflightAll += 1;
    let good;
    try { good = await verifyPasscode(typeof passcode === 'string' ? passcode.trim() : '', record); } finally {
      const left = (inflight.get(ip) ?? 1) - 1;
      if (left > 0) inflight.set(ip, left); else inflight.delete(ip);
      inflightAll -= 1;
    }
    if (!good) {
      const entry = failures.get(ip) ?? { count: 0, until: 0 };
      entry.count += 1;
      recent.push(now());
      if (entry.count >= FAILS_BEFORE_WAIT) entry.until = now() + Math.min(15 * 60, 30 * 2 ** (entry.count - FAILS_BEFORE_WAIT)) * 1000; // 30 s, 60 s, 2 min ... at most 15 min
      failures.set(ip, entry);
      const w = waitFor(ip);
      return { ok: false, status: 401, waitSeconds: w || undefined, message: w ? `That passcode is not right. Wait ${w} seconds before trying again.` : 'That passcode is not right.' };
    }
    failures.delete(ip);
    const secret = randomBytes(32).toString('hex');
    const session = { deviceId: randomBytes(8).toString('hex'), label: deviceLabel(userAgent), ip, csrf: randomBytes(24).toString('hex'), signedInAt: now(), lastSeen: now(), level: DEFAULT_LEVEL };
    sessions.set(secret, session);
    logAction(session, { kind: 'signin' });
    return { ok: true, secret, session };
  }

  /** Drop every session idle for too long, and tell the app (so a device's Auto chats go back to Ask). Called on a timer and before any count or list. */
  function sweep() {
    const gone = [];
    for (const [secret, s] of sessions) if (now() - s.lastSeen > idleLimit(s)) { sessions.delete(secret); gone.push(s.deviceId); logAction(s, { kind: 'idle-signout' }); }
    if (gone.length) ended(gone);
    return gone.length;
  }

  /** The session behind a Cookie header, or null (expired ones are dropped). */
  function sessionFor(cookieHeader) {
    const secret = readCookie(cookieHeader);
    if (!secret || !on) return null;
    const s = sessions.get(secret);
    if (!s) return null;
    if (now() - s.lastSeen > idleLimit(s)) { sessions.delete(secret); ended([s.deviceId]); logAction(s, { kind: 'idle-signout' }); return null; }
    s.lastSeen = now();
    return s;
  }

  return {
    load,
    get enabled() { return on; },
    get host() { return host; },
    get address() { return address; },
    async hasPasscode() { await load(); return Boolean(record); },
    /** Turn on at this host. `passcode` is set (and hashed) now; with none, the saved one is kept (if there is none, that is an error). */
    async enable({ lanHost, lanAddress, passcode = null }) {
      await load();
      if (passcode !== null) await savePasscode(passcode);
      else if (!record) return { ok: false, message: 'Choose a passcode first.' };
      host = String(lanHost).toLowerCase();
      address = lanAddress;
      on = true;
      return { ok: true };
    },
    /** Turn off: every session ends at once. */
    disable() { const ids = [...sessions.values()].map((s) => s.deviceId); on = false; host = ''; address = null; sessions.clear(); failures.clear(); recent = []; ended(ids.length ? ids : null); },
    signIn,
    sessionFor,
    /** The person's own browser sessions, for the list in the window (never the secrets). */
    sweep,
    list() { sweep(); return [...sessions.values()].map((s) => ({ id: s.deviceId, label: s.label, ip: s.ip, signedInAt: new Date(s.signedInAt).toISOString(), lastSeen: new Date(s.lastSeen).toISOString(), level: s.level, asked: Boolean(s.asked) })).sort((a, b) => a.signedInAt.localeCompare(b.signedInAt)); },
    count() { sweep(); return sessions.size; },
    /** DEVICE-FULL: the level lives with the session, so it ends with sign-out, turning access off or the idle timeout. Returns the device, or null. */
    setLevel(deviceId, level) {
      if (!LEVELS.includes(level)) return null;
      sweep();
      for (const s of sessions.values()) if (s.deviceId === deviceId) { const from = s.level; s.level = level; s.asked = true; s.lastSeen = now(); if (from !== level) logAction(s, { kind: 'level', from }); return { id: s.deviceId, level: s.level }; }
      return null;
    },
    /** R-DF2: record one thing a device did (a tool's name, a window-only route and its method, a sign-in or a level change). */
    logAction,
    flushLog: () => saving,
    /** R-DF2: the log, newest first. Only the window's route hands it out. */
    async actions() { await loadActions(); prune(); return [...actions].reverse(); },
    anyEverything() { sweep(); return [...sessions.values()].some((s) => s.level === 'everything'); },
    signOutDevice(deviceId) { for (const [secret, s] of sessions) if (s.deviceId === deviceId) { sessions.delete(secret); ended([deviceId]); return true; } return false; },
    signOutSecret(secret) { const s = sessions.get(secret); const gone = sessions.delete(secret); if (gone && s) ended([s.deviceId]); return gone; },
    signOutAll() { const ids = [...sessions.values()].map((s) => s.deviceId); const n = sessions.size; sessions.clear(); if (ids.length) ended(ids); return n; },
    cookieFor(secret) { return `${COOKIE}=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_IDLE_MS / 1000)}`; },
    clearCookie() { return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`; },
  };
}


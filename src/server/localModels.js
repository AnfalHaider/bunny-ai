/**
 * LOCAL-MODELS: what the Settings card and the chat menu need to know about Bunny local, and the window's buttons.
 *
 * This is the FAKE-MODE service (BUNNY_FAKE_LOCAL=1, or an app made with fakeLocal): an invented profile, an invented list of models, set-up and downloads that
 * finish by themselves in a moment, and a PC with invented memory numbers. It lets the screens, the routes and the chat menu be built and checked now. The real
 * runtime, the pins and the curated list wait for spikes S-LM1 to S-LM5 and Security's sign-off; nothing here downloads or starts a real program.
 *
 * The rules this already keeps (Tech Lead's spec LM-13): every write is the window's alone (windowOnly.js), a device only chats with a model that already runs.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { GB, chooseContext } from './localFit.js';

export const IDLE_CHOICES = [5, 10, 30, 60, 0]; // minutes; 0 = only when Bunny closes
export const PROGRAM = { name: 'llama.cpp', sizeMB: 39, from: 'GitHub releases', licence: 'MIT', host: 'github.com', signed: false }; // signed: S-LM1 decides; until it says otherwise the card says the program is not signed (LM-1)
export const QUICK_ASK_STARTING = 'Starting your local model…';
export const RAISABLE = ['memory', 'missing', 'changed', 'fingerprint', 'hfchanged', 'disk', 'device'];
const PROVIDER_ID = 'bunny-local';

/** The invented list (fake mode only). Real entries come from localModels.json once the spikes and Security have settled them. */
export const FAKE_LIST = Object.freeze([
  { id: 'qwen3-4b', name: 'Qwen3 4B', publisher: 'Qwen', size: 2.5 * GB, licence: 'Apache-2.0', tools: true, kvBytesPerToken: 100 * 1024, nativeCtx: 40960 },
  { id: 'qwen3-8b', name: 'Qwen3 8B', publisher: 'Qwen', size: 5 * GB, licence: 'Apache-2.0', tools: true, kvBytesPerToken: 144 * 1024, nativeCtx: 40960 },
  { id: 'ministral-3-3b', name: 'Ministral 3 3B', publisher: 'Mistral AI', size: 2.1 * GB, licence: 'Apache-2.0', tools: false, kvBytesPerToken: 90 * 1024, nativeCtx: 32768 },
  { id: 'granite-4-1-8b', name: 'Granite 4.1 8B', publisher: 'IBM', size: 5 * GB, licence: 'Apache-2.0', tools: true, kvBytesPerToken: 128 * 1024, nativeCtx: 32768 },
  { id: 'gpt-oss-20b', name: 'gpt-oss 20B', publisher: 'OpenAI', size: 12 * GB, licence: 'Apache-2.0', tools: false, kvBytesPerToken: 150 * 1024, nativeCtx: 32768 },
]);

/** The PC the fake mode pretends to be (invented numbers). */
export const FAKE_PC = Object.freeze({ totalRam: 16 * GB, freeRam: 7.1 * GB, freeVram: 8 * GB, vram: 12 * GB, gpu: true, freeDisk: 41 * GB, gpuName: 'Invented graphics card' });

export class LocalError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export function createLocalModels({ dataDir, fake = false, list = FAKE_LIST, pc = () => FAKE_PC, clock = Date.now } = {}) {
  const file = join(dataDir, 'local-models.json');
  /** The saved state: set up or not, the switches, and each model's progress. Never a key or an address. */
  let state = { installed: false, backend: 'cpu', useGpu: true, idleMinutes: 10, models: {}, running: null };
  let loaded = false;
  let setup = null; // { step } while setting up
  let lastError = null;
  /** Fake mode only: which of the plain error states to show, so Design and QA can look at each one. Never saved. */
  let raised = {};
  const timers = new Map();

  async function load() {
    if (loaded) return;
    loaded = true;
    try { state = { ...state, ...JSON.parse(await readFile(file, 'utf8')) }; } catch { /* the first run has no file */ }
    state.running = null; // nothing survives a restart: a model is loaded only by a process this run started
  }
  const save = () => writeFile(file, JSON.stringify({ ...state, running: null }), 'utf8');
  const entry = (id) => list.find((m) => m.id === id) ?? null;
  const need = (id) => { const e = entry(id); if (!e) throw new LocalError('local.unknownModel', 'That model is not on Bunny\'s list.', 404); return e; };

  function view(e) {
    const mine = state.models[e.id] ?? { state: 'none' };
    const gpu = state.installed && state.useGpu && state.backend === 'vulkan';
    const fit = chooseContext(e, { freeRam: pc().freeRam, freeVram: pc().freeVram, gpu });
    return {
      id: e.id, name: e.name, publisher: e.publisher, licence: e.licence, size: e.size,
      fit: fit.fit.result, fitText: fit.fit.text, canDownload: fit.fit.canDownload, ctx: fit.ctx,
      tools: fit.tools, toolsNote: fit.toolsNote,
      state: mine.state, done: mine.done ?? 0,
      error: raised.fingerprint === e.id ? "The download didn't match its fingerprint and was deleted. Nothing was kept. Expected 5c0e…b81d, got 77af…02c4"
        : raised.disk === e.id ? `Needs ${((e.size + 2 * GB) / GB).toFixed(1)} GB free on this drive; 6.1 GB is free. Free some space, then try again.`
          : (mine.error ?? null),
      changedOnHub: raised.hfchanged === e.id, // LM-5d: this model changed on Hugging Face: offered again after an update, Download off
      needFreeDisk: e.size + 2 * GB,
      needBytes: fit.fit.need, availBytes: pc().freeRam + (gpu ? pc().freeVram : 0),
      speedBps: mine.state === 'downloading' ? (fake ? 18 * 1024 * 1024 : null) : null,
      fingerprint: mine.state === 'ready' ? `${e.id.replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)}` : null, // fake mode: the real one is the first 12 hex of the checked sha256
    };
  }

  /** The program-level states of the drawing (section 6): the card and the chat show these; Set up again starts over. */
  function programAlerts() {
    const out = [];
    if (raised.missing) out.push({ kind: 'missing', title: "Bunny local isn't set up on this PC", body: "The program that runs models isn't installed (it may have been removed).", action: 'Set up Bunny local' });
    if (raised.changed) out.push({ kind: 'changed', title: "Bunny local's program changed on disk", body: "Bunny won't start it, in case something else altered it. Set it up again to get a fresh, checked copy. Your downloaded models are kept.", action: 'Set up again' });
    return out;
  }
  async function status() {
    await load();
    const p = pc();
    return {
      fake,
      program: PROGRAM,
      installed: state.installed,
      setup: setup ? { step: setup.step } : null,
      runtime: state.installed ? { backend: state.backend, useGpu: state.useGpu, idleMinutes: state.idleMinutes, idleChoices: IDLE_CHOICES } : null,
      running: state.running ? { id: state.running.id, name: entry(state.running.id)?.name, usedBytes: state.running.usedBytes, lastUsed: state.running.lastUsed } : null,
      pc: { totalRam: p.totalRam, freeRam: p.freeRam, vram: p.vram, freeVram: p.freeVram, freeDisk: p.freeDisk, gpuName: p.gpuName },
      models: fake ? list.map(view) : [],
      modelsDir: join(dataDir, 'models'),
      usedBytes: list.reduce((n, e) => n + (state.models[e.id]?.state === 'ready' ? e.size : 0), 0),
      error: lastError,
      alerts: programAlerts(),
      raised: fake ? Object.keys(raised) : [],
    };
  }

  const readyModels = () => list.filter((e) => state.models[e.id]?.state === 'ready');
  const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); t.unref?.(); });
  const SPEED = fake ? 40 : 1; // fake mode finishes in a blink

  async function setUp() {
    await load();
    if (!fake) throw new LocalError('local.notAvailable', 'Bunny local is not available in this version yet.', 501);
    if (state.installed || setup) return status();
    lastError = null;
    setup = { step: 1 };
    (async () => {
      for (const step of [1, 2, 3, 4]) { if (!setup) return; setup.step = step; await sleep(120 / SPEED * 40); }
      if (!setup) return; // cancelled: nothing is left behind
      state.installed = true; state.backend = pc().gpu ? 'vulkan' : 'cpu'; setup = null;
      await save();
    })();
    return status();
  }

  async function download(id) {
    await load();
    const e = need(id);
    if (!state.installed) throw new LocalError('local.notSetUp', 'Set up Bunny local first.');
    const v = view(e);
    if (!v.canDownload) throw new LocalError('local.tooBig', 'Too big for this PC.');
    if (pc().freeDisk < v.needFreeDisk) { state.models[id] = { state: 'none', error: `Needs ${(v.needFreeDisk / GB).toFixed(1)} GB free on this drive; ${(pc().freeDisk / GB).toFixed(1)} GB is free. Free some space, then try again.` }; await save(); return status(); }
    const mine = state.models[id] = { state: 'downloading', done: state.models[id]?.done ?? 0, error: null };
    clearInterval(timers.get(id));
    const t = setInterval(async () => {
      mine.done = Math.min(e.size, mine.done + e.size / 5);
      if (mine.done >= e.size) { clearInterval(t); timers.delete(id); mine.state = 'ready'; }
      await save();
    }, 150);
    t.unref?.();
    timers.set(id, t);
    return status();
  }
  const stopTimer = (id) => { clearInterval(timers.get(id)); timers.delete(id); };
  async function pause(id) { await load(); need(id); const m = state.models[id]; if (m?.state === 'downloading') { stopTimer(id); m.state = 'paused'; await save(); } return status(); }
  async function resume(id) { await load(); need(id); if (state.models[id]?.state === 'paused') return download(id); return status(); }
  async function cancel(id) { await load(); need(id); stopTimer(id); delete state.models[id]; await save(); return status(); }
  async function remove(id) {
    await load(); need(id); stopTimer(id);
    if (state.running?.id === id) state.running = null; // the real service stops the server first
    delete state.models[id]; await save(); return status();
  }
  async function settings(patch = {}) {
    await load();
    if (Object.hasOwn(patch, 'useGpu')) { if (typeof patch.useGpu !== 'boolean') throw new LocalError('local.bad', 'Use graphics card is on or off.'); state.useGpu = patch.useGpu; }
    if (Object.hasOwn(patch, 'idleMinutes')) { if (!IDLE_CHOICES.includes(patch.idleMinutes)) throw new LocalError('local.bad', 'Choose 5, 10, 30 or 60 minutes, or only when Bunny closes.'); state.idleMinutes = patch.idleMinutes; }
    await save();
    return status();
  }
  async function stopNow() { await load(); state.running = null; return status(); }
  /** The window picked a model or sent a message: in fake mode "start" is instant and marks it running. */
  async function ensure(id, { who = 'window', quick = false } = {}) {
    await load();
    if (fake && raised.device && state.running?.id !== id) who = 'device'; // the device refusal, raised on purpose
    if (raised.missing) throw new LocalError('local.missing', "Bunny local isn't set up on this PC. The program that runs models isn't installed (it may have been removed).", 409);
    if (raised.changed) throw new LocalError('local.changed', "Bunny local's program changed on disk. Bunny won't start it, in case something else altered it. Set it up again to get a fresh, checked copy.", 409);
    if (raised.memory) throw new LocalError('local.memory', `Not enough memory to load ${entry(id)?.name ?? id}. This PC has about ${(pc().freeRam / GB).toFixed(0)} GB free and the model needs about ${(view(entry(id)).needBytes / GB).toFixed(1)} GB. Close other apps or choose a smaller model.`, 409);
    if (who !== 'window' && state.running?.id !== id) throw new LocalError('local.notRunning', 'Bunny local is stopped. Start it from Bunny\'s window on your PC.', 409);
    if (state.models[id]?.state !== 'ready') throw new LocalError('local.notReady', 'That model is not downloaded.', 409);
    state.running = { id, usedBytes: Math.round(entry(id).size * 1.25), lastUsed: clock() };
    return state.running;
  }
  async function cancelSetup() { setup = null; return status(); }
  /** Fake mode: raise (or with kind 'none', clear) one of the plain error states. */
  async function raise(kind, id = null) {
    if (!fake) throw new LocalError('local.notAvailable', 'Only in test mode.', 404);
    if (kind === 'none') { raised = {}; return status(); }
    if (!RAISABLE.includes(kind)) throw new LocalError('local.bad', `Raise one of: ${RAISABLE.join(', ')}.`);
    raised[kind] = ['fingerprint', 'hfchanged', 'disk'].includes(kind) ? (id ?? list[1].id) : true;
    if (kind === 'changed') delete raised.missing;
    if (kind === 'missing') delete raised.changed;
    return status();
  }
  async function removeAll() {
    await load();
    for (const id of [...timers.keys()]) stopTimer(id);
    state = { ...state, installed: false, models: {}, running: null };
    setup = null; await save();
    return status();
  }

  /** What the chat's model menu lists: downloaded models only (LM-3), under the "Bunny local" provider. */
  async function pickerModels() {
    await load();
    if (!state.installed) return [];
    return readyModels().map((e) => {
      const v = view(e);
      return { id: e.id, displayName: e.name, ownedBy: e.publisher, contextLength: v.ctx, providerId: PROVIDER_ID, providerName: 'Bunny local', sizeBytes: e.size, toolsOk: v.tools, fit: v.fit, fitText: v.fitText, note: v.tools ? 'uses tools' : 'chat only' };
    });
  }
  /** The address of the running server, looked up per request (LM-2). Fake mode may point at a stand-in server (BUNNY_FAKE_LOCAL_URL); the real runtime is not built yet. */
  const baseUrl = () => (fake && process.env.BUNNY_FAKE_LOCAL_URL ? process.env.BUNNY_FAKE_LOCAL_URL : '');
  const hasReady = () => loaded && state.installed && readyModels().length > 0;

  return { status, setUp, download, pause, resume, cancel, remove, settings, stopNow, ensure, removeAll, cancelSetup, raise, pickerModels, hasReady, baseUrl, load, view };
}

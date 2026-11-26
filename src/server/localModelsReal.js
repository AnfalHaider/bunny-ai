/**
 * LOCAL-MODELS, the real service (the fake one is localModels.js): Bunny downloads the pinned llama.cpp program and the curated models, and runs them itself.
 * Everything that touches the world is passed in (`fetchImpl`, `launch`, `trial`, `pc`), so the tests use stand-ins and nothing here reaches the network on its own.
 *
 * Rules kept here: a start only after the manifest re-check (localRuntimeInstall), only from the window or the person's typed Quick ask question or a model already running (LM-13, LM-14, LM-18),
 * the list shown is what is on disk (LM-3), the program is never set up from an allow list that is not complete (SP-2).
 */
import { freemem, totalmem } from 'node:os';
import { readFile, realpath, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { GB, chooseContext } from './localFit.js';
import { fetchHop } from './download.js';
import { downloadModel, modelDir, MODEL_HOSTS, DownloadError } from './localDownload.js';
import { createFolderRules, FolderError } from './localFolderRules.js';
import { createPlaces, PlaceError } from './localPlaces.js';
import { createStore, entryDir } from './localStore.js';
import { GgufError } from './ggufHeader.js';
import { checkRuntimePins, downloadRuntimeZip, installFromZip, loadRuntimePins, verifyRuntime, RuntimeError } from './localRuntimeInstall.js';
import { createLocalRuntime, helperLaunch, RuntimeStartError } from './localRuntime.js';
import { createTrial, detectGpu } from './localHardware.js';
import { killTree } from './engines/process.js';
import { createRunnerHelper } from './localRunnerHelper.js';
import { loadLocalList } from '../providers/localList.js';
import { LocalError, PROGRAM, IDLE_CHOICES, QUICK_ASK_STARTING } from './localModels.js';

const PROVIDER_ID = 'bunny-local';
/** Vendors whose graphics cards the Vulkan build was proven on (S-LM1: NVIDIA and Intel on one PC). Others get the CPU build until someone runs it there. */
export const VULKAN_PROVEN = ['nvidia', 'intel'];
/** Security B3: the Vulkan build without ggml-rpc.dll was run on one PC (Low helper, LM-2 argv, one chat, the Vulkan device); with this false every PC gets the CPU build. */
export const VULKAN_RECORDED = true; // run 2026-11-26: docs/spikes/local-models/vulkan-run-2026-11-26.md
/** The smallest graphics card in a --list-devices answer (it runs out of room first), or null. */
export const smallestCard = (devices) => [...devices].filter((d) => d.totalBytes > 0).sort((a, b) => a.totalBytes - b.totalBytes)[0] ?? null;
export const chooseBackend = ({ vendor = null, useGpu = true, vulkanRecorded = VULKAN_RECORDED } = {}) => (vulkanRecorded && useGpu && VULKAN_PROVEN.includes(String(vendor ?? '').toLowerCase()) ? 'vulkan' : 'cpu');

export function createRealLocalModels({
  dataDir, list = loadLocalList(), pins = loadRuntimePins(), fetchImpl = fetchHop, launch = null, helper = null, runtime = null,
  rules = null, places = null, store = null, installDirs = [], home = homedir(), isProtected = () => false, projectFolders = () => [], trial = null, gpuInfo = detectGpu, gpuVendor = null, vulkanRecorded = VULKAN_RECORDED, pc = null, allowIncompletePins = false, clock = Date.now,
} = {}) {
  const file = join(dataDir, 'local-models.json');
  const pin = pins['llama-server'];
  const hubHosts = MODEL_HOSTS;
  let state = { installed: false, backend: 'cpu', useGpu: true, idleMinutes: 10 };
  let loaded = false;
  let setup = null; // { step, ctl }
  let lastError = null;
  let lastRemoval = null;
  const downloads = new Map(); // id -> { ctl, done, startedAt, error, paused }
  const launcher = launch ?? helperLaunch(helper ?? createRunnerHelper({ dataDir }));
  const runner = runtime ?? createLocalRuntime({ dataDir, launch: launcher });
  /** `--version` must end with 0 (and on Vulkan `--list-devices` gives the card's memory): the same Low, job-bound launch as a model run. */
  const tryProgram = trial ?? createTrial({ launch: launcher, dataDir, kill: killTree });
  let freeVramAt = 0; let freeVramNow = null;

  const entry = (id) => list.find((m) => m.id === id) ?? null;
  const need = (id) => { const e = entry(id); if (!e) throw new LocalError('local.unknownModel', "That model is not on Bunny's list.", 404); return e; };
  const runtimeDir = () => join(dataDir, 'runtimes', 'llama.cpp', `${pin.tag}-${state.backend}`);
  const defaultRoot = join(dataDir, 'models');
  let rootNow = defaultRoot; // where a download would go right now (null: the chosen folder is not available)
  const modelFile = (e) => (rootNow ? join(entryDir(rootNow, e), e.file) : null);
  const hardware = pc ?? (async () => {
    let freeDisk = 0; try { const s = await statfs(dataDir); freeDisk = Number(s.bavail) * Number(s.bsize); } catch { /* unknown: none */ }
    const card = state.gpu ?? null;
    const useCard = Boolean(state.installed && state.backend === 'vulkan' && card?.vram > 0);
    // the free graphics memory is asked of the program at most every 30 s, and not while a model runs (the number would only be the model's own)
    if (useCard && typeof tryProgram.devices === 'function' && !runner.running() && clock() - freeVramAt > 30_000) {
      freeVramAt = clock();
      const d = smallestCard(await tryProgram.devices(join(runtimeDir(), pin.entry)).catch(() => []));
      if (d?.freeBytes != null) freeVramNow = d.freeBytes;
    }
    return { totalRam: totalmem(), freeRam: freemem(), vram: useCard ? card.vram : null, freeVram: useCard ? (freeVramNow ?? card.vram) : null, gpu: useCard, freeDisk, gpuName: card?.name ?? null };
  });

  const rulesImpl = rules ?? createFolderRules({ dataDir, installDirs, home, isProtected, projectFolders });
  const curatedTemplates = () => new Map(list.filter((e) => e.template?.sha256).map((e) => [e.template.sha256, e.name]));
  const placesImpl = places ?? createPlaces({ dataDir, rules: rulesImpl, home, curatedTemplates, memory: async () => { const h = await hardware(); return { freeRam: h.freeRam, freeVram: h.freeVram, gpu: Boolean(h.gpu && state.useGpu) }; } });
  const storeImpl = store ?? createStore({ dataDir, places: placesImpl, rules: rulesImpl, freeBytes: async (dir) => { try { const sf = await statfs(dir); return Number(sf.bavail) * Number(sf.bsize); } catch { return 0; } } });
  async function refreshRoot() { try { rootNow = await storeImpl.root(); return true; } catch { rootNow = null; return false; } }
  let moving = null; // { ctl, done, total, result|error }
  const busy = () => moving !== null || [...downloads.values()].some((d) => !d.paused && !d.error) || setup !== null;

  async function load() {
    if (loaded) return;
    loaded = true;
    try { state = { ...state, ...JSON.parse(await readFile(file, 'utf8')) }; } catch { /* the first run has no file */ }
    runner.setIdleMinutes(state.idleMinutes);
    await runner.sweepKeys(); // a crash may have left a key file: it is useless, and goes
  }
  const save = () => writeFile(file, JSON.stringify(state), 'utf8');

  /** Is the model on disk and what the manifest says? (LM-3: the list is what is on disk.) */
  async function onDisk(e) {
    await placesImpl.load();
    let rec = placesImpl.state().downloads[e.id];
    if (!rec) { // a download made before records existed: its manifest in the default folder, adopted once
      try {
        const legacy = join(entryDir(defaultRoot, e), e.file);
        const m = JSON.parse(await readFile(legacy + '.manifest.json', 'utf8'));
        if (m.sha256 === e.sha256 && (await stat(legacy)).size === e.size) rec = await storeImpl.record(e.id, await realpath(legacy), e.sha256);
      } catch { /* none */ }
    }
    if (!rec) return null;
    try { const st2 = await stat(rec.real); return st2.isFile() && st2.size === e.size ? { sha256: rec.sha256, real: rec.real } : { missing: true, sha256: rec.sha256 }; } catch { return { missing: true, sha256: rec.sha256 }; }
  }

  async function view(e, hw, program) {
    const dl = downloads.get(e.id);
    const found = await onDisk(e);
    const manifest = found && !found.missing ? found : null;
    const notFound = Boolean(found?.missing);
    const fit = chooseContext(e, { freeRam: hw.freeRam, freeVram: hw.freeVram ?? null, gpu: Boolean(hw.gpu && state.useGpu) });
    const done = dl ? dl.done : manifest ? e.size : 0;
    const part = !dl && !manifest && modelFile(e) ? await stat(`${modelFile(e)}.part`).then((s) => s.size, () => 0) : 0;
    const status = manifest ? 'ready' : dl ? (dl.paused ? 'paused' : 'downloading') : part > 0 ? 'paused' : 'none';
    const avail = hw.freeRam + (hw.gpu && state.useGpu ? (hw.freeVram ?? 0) : 0);
    return {
      id: e.id, name: e.name, publisher: e.publisher, licence: e.licence, size: e.size,
      fit: fit.fit.result, fitText: fit.fit.text, canDownload: fit.fit.canDownload && Boolean(program), ctx: fit.ctx, tools: fit.tools, toolsNote: fit.toolsNote,
      notFound, state: status, done: status === 'paused' && !dl ? part : done, error: dl?.error ?? null, changedOnHub: false,
      needFreeDisk: e.size + 2 * GB, needBytes: fit.fit.result === 'too-big' ? Math.max(fit.fit.need, avail + 0.1 * GB) : fit.fit.need, availBytes: avail,
      speedBps: dl && !dl.paused && clock() > dl.startedAt + 1500 ? Math.round((dl.done - dl.from) / ((clock() - dl.startedAt) / 1000)) : null,
      fingerprint: manifest ? manifest.sha256.slice(0, 12) : null,
    };
  }

  async function alerts() {
    if (!state.installed) return [];
    const v = await verifyRuntime(runtimeDir());
    if (v.ok) return [];
    return v.missing
      ? [{ kind: 'missing', title: "Bunny local isn't set up on this PC", body: "The program that runs models isn't installed (it may have been removed).", action: 'Set up Bunny local' }]
      : [{ kind: 'changed', title: "Bunny local's program changed on disk", body: "Bunny won't start it, in case something else altered it. Set it up again to get a fresh, checked copy. Your downloaded models are kept.", action: 'Set up again' }];
  }

  async function status() {
    await load();
    const hw = await hardware();
    const running = runner.running();
    const program = checkRuntimePins(pins, { forShip: true }).length === 0 || allowIncompletePins;
    const models = await Promise.all(list.map((e) => view(e, hw, program)));
    return {
      fake: false,
      program: { ...PROGRAM, sizeMB: Math.round(pin.files[chooseBackend({ vendor: null })].size / 1e6), licence: pin.licence, signed: pin.signed === true, tag: pin.tag, available: program },
      installed: state.installed, setup: setup ? { step: setup.step } : null,
      runtime: state.installed ? { backend: state.backend, useGpu: state.useGpu, idleMinutes: state.idleMinutes, idleChoices: IDLE_CHOICES } : null,
      running: running ? { id: running.modelId, name: entry(running.modelId)?.name, usedBytes: Math.round((entry(running.modelId)?.size ?? 0) * 1.25), lastUsed: running.lastUsed } : null,
      pc: { totalRam: hw.totalRam, freeRam: hw.freeRam, vram: hw.vram, freeVram: hw.freeVram, freeDisk: hw.freeDisk, gpuName: hw.gpuName },
      models,
      usedBytes: models.reduce((n, m) => n + (m.state === 'ready' ? m.size : 0), 0),
      error: lastError, alerts: await alerts(), raised: [], removal: lastRemoval ? { removed: lastRemoval.removed, left: lastRemoval.left.length, missing: lastRemoval.missing.length } : null,
    };
  }

  async function setUp() {
    await load();
    if (state.installed && !(await alerts()).length) return status();
    if (setup) return status();
    const problems = checkRuntimePins(pins, { forShip: true });
    if (problems.length && !allowIncompletePins) throw new LocalError('local.notAvailable', 'Bunny local is not available in this version yet.', 501);
    lastError = null;
    const ctl = new AbortController();
    setup = { step: 1, ctl };
    (async () => {
      try {
        const found = gpuVendor ? { vendor: await gpuVendor(), name: null } : (await gpuInfo().catch(() => null));
        const backend = chooseBackend({ vendor: found?.vendor ?? null, useGpu: state.useGpu, vulkanRecorded });
        const zip = join(dataDir, 'runtimes', 'llama.cpp', '.download', pin.files[backend].name);
        await downloadRuntimeZip({ pins, backend, dest: zip, fetchImpl, signal: ctl.signal });
        setup.step = 2; // the fingerprint was checked while it streamed
        setup.step = 3;
        const dir = join(dataDir, 'runtimes', 'llama.cpp', `${pin.tag}-${backend}`);
        await installFromZip({ zip, dir, pins, backend });
        await rm(zip, { force: true });
        setup.step = 4;
        const t = await tryProgram(join(dir, pin.entry), backend);
        if (!(t === true || t?.ok)) throw new RuntimeError('runtime.trial', "The program didn't start on this PC.");
        const vram = smallestCard(t?.devices ?? [])?.totalBytes ?? 0; // the smallest card: the program may spread a model over every card, and the smallest is the one that runs out first
        state = { ...state, installed: true, backend, gpu: found?.name ? { vendor: found.vendor, name: found.name, vram: vram || null } : null }; await save();
        freeVramAt = 0; freeVramNow = null;
      } catch (err) {
        lastError = ctl.signal.aborted ? null : (err.message ?? 'The set-up did not finish.');
        await rm(join(dataDir, 'runtimes', 'llama.cpp', '.download'), { recursive: true, force: true }).catch(() => {});
      } finally { setup = null; }
    })();
    return status();
  }
  async function cancelSetup() { setup?.ctl.abort(); setup = null; return status(); }

  async function download(id) {
    await load();
    const e = need(id);
    if (!state.installed) throw new LocalError('local.notSetUp', 'Set up Bunny local first.');
    if (moving) throw new LocalError('place.busy', 'Wait for the move to finish or cancel it.', 409);
    if (!(await refreshRoot())) throw new LocalError('place.unavailable', "The download folder isn't available. Plug in the drive or choose another folder.", 409);
    const hw = await hardware();
    const v = await view(e, hw, true);
    if (!v.canDownload) throw new LocalError('local.tooBig', 'Too big for this PC.');
    if (downloads.has(id) && !downloads.get(id).paused) return status();
    const ctl = new AbortController();
    const from = await stat(`${modelFile(e)}.part`).then((s) => s.size, () => 0);
    const dl = { ctl, done: from, from, startedAt: clock(), error: null, paused: false };
    downloads.set(id, dl);
    downloadModel({
      dataDir, root: rootNow, writeManifest: false, entry: e, fetchImpl, hosts: hubHosts, signal: ctl.signal,
      freeBytes: async () => { try { const sf = await statfs(rootNow); return Number(sf.bavail) * Number(sf.bsize); } catch { return (await hardware()).freeDisk || Infinity; } },
      onProgress: (p) => { dl.done = p.done; },
    }).then(async (r) => { await storeImpl.record(id, await realpath(r.path), e.sha256); downloads.delete(id); }, (err) => {
      if (dl.paused && err.code === 'local.cancelled') return; // Pause keeps the .part file
      dl.error = err instanceof DownloadError || err instanceof PlaceError ? err.message : (err.message ?? 'The download failed.');
      if (err.code === 'local.cancelled') downloads.delete(id);
    });
    return status();
  }
  async function pause(id) { await load(); need(id); const d = downloads.get(id); if (d && !d.paused) { d.paused = true; d.ctl.abort(); } return status(); }
  async function resume(id) { await load(); need(id); downloads.delete(id); return download(id); }
  async function cancel(id) {
    await load(); const e = need(id); await refreshRoot();
    const d = downloads.get(id); d?.ctl.abort(); downloads.delete(id);
    if (modelFile(e)) { await rm(`${modelFile(e)}.part`, { force: true }); await rm(`${modelFile(e)}.part.json`, { force: true }); }
    return status();
  }
  async function remove(id) {
    await load(); const e = need(id);
    if (runner.running()?.modelId === id) await runner.stop(); // the server goes first
    downloads.get(id)?.ctl.abort(); downloads.delete(id);
    await storeImpl.removeRecorded(id); // only the recorded file, and only if it still is that file; empty folders after it
    return status();
  }
  async function settings(patch = {}) {
    await load();
    if (Object.hasOwn(patch, 'useGpu')) { if (typeof patch.useGpu !== 'boolean') throw new LocalError('local.bad', 'Use graphics card is on or off.'); state.useGpu = patch.useGpu; }
    if (Object.hasOwn(patch, 'idleMinutes')) { if (!IDLE_CHOICES.includes(patch.idleMinutes)) throw new LocalError('local.bad', 'Choose 5, 10, 30 or 60 minutes, or only when Bunny closes.'); state.idleMinutes = patch.idleMinutes; runner.setIdleMinutes(patch.idleMinutes); }
    await save();
    return status();
  }
  async function stopNow() { await load(); await runner.stop(); return status(); }

  /** Who may start: the window and the person's typed Quick ask question (decided by the caller); anyone else only gets a model that already runs (LM-13, LM-14, LM-18). */
  async function ensure(id, { who = 'window' } = {}) {
    await load();
    const ownId = String(id).startsWith('own:') ? String(id).slice(4) : null;
    const e = ownId ? null : need(id);
    const running = runner.running();
    if (who !== 'window' && running?.modelId !== id) throw new LocalError('local.notRunning', "Bunny local is stopped. Start it from Bunny's window on your PC.", 409);
    if (who !== 'window') { runner.touch(); return running; }
    if (!state.installed) throw new LocalError('local.missing', "Bunny local isn't set up on this PC. The program that runs models isn't installed (it may have been removed).", 409);
    let target = e; let file = null; let chatTemplate = null;
    if (ownId) { // a file Bunny did not download: checked again before every start (LF-2); no chat format means the plain one, and never tools
      let v; try { v = await placesImpl.verifyForStart(ownId); } catch (err) { throw translate(err); }
      target = { id, name: v.rec.name, size: v.rec.size, kvBytesPerToken: v.rec.kvBytesPerToken, nativeCtx: v.rec.contextLength ?? 8192, tools: false };
      file = v.real; chatTemplate = v.rec.format === 'none' ? 'chatml' : null;
    } else {
      const found = await onDisk(e);
      if (!found || found.missing) throw new LocalError(found?.missing ? 'local.notFound' : 'local.notReady', found?.missing ? 'Not found' : 'That model is not downloaded.', 409);
      const v = await storeImpl.verify(id, e);
      if (v.state !== 'ok') throw new LocalError(v.state === 'notFound' ? 'local.notFound' : 'local.fileChanged', v.message, 409);
      file = v.real;
    }
    const hw = await hardware();
    const fit = chooseContext(target, { freeRam: hw.freeRam, freeVram: hw.freeVram ?? null, gpu: Boolean(hw.gpu && state.useGpu) });
    if (fit.fit.result === 'too-big') throw new LocalError('local.memory', `Not enough memory to load ${target.name}. This PC has about ${(hw.freeRam / GB).toFixed(1)} GB free and the model needs about ${(fit.fit.need / GB).toFixed(1)} GB. Close other apps or choose a smaller model.`, 409);
    try {
      // layers go to the graphics card only when the whole model and its cache fit there; otherwise the program decides what it can offload
      return await runner.ensure({ runtimeDir: runtimeDir(), modelFile: file, modelId: id, ctx: fit.ctx, gpu: state.backend === 'vulkan' && state.useGpu && fit.fit.result === 'fits-gpu', chatTemplate });
    } catch (err) {
      if (err instanceof RuntimeStartError) throw new LocalError(err.code, err.code === 'local.missing' ? "Bunny local isn't set up on this PC. The program that runs models isn't installed (it may have been removed)." : err.code === 'local.changed' ? "Bunny local's program changed on disk. Bunny won't start it, in case something else altered it. Set it up again to get a fresh, checked copy." : err.message, 409);
      throw err;
    }
  }

  async function removeAll() {
    await load();
    await runner.stop();
    for (const d of downloads.values()) d.ctl.abort();
    downloads.clear(); setup?.ctl.abort(); setup = null;
    await rm(join(dataDir, 'runtimes'), { recursive: true, force: true }); // the program, the helper, the key folder and everything under it (inside the data folder)
    lastRemoval = await storeImpl.removeAllRecorded(); // LF-24: recorded downloads wherever they are, only those that still match
    await rm(join(dataDir, 'models', '.cache'), { recursive: true, force: true }); // the cache lives in the data folder
    await rm(join(dataDir, 'models'), { recursive: false, force: true }).catch(() => {}); // empty, or left alone: never a tree
    await placesImpl.removeAllOwn();
    state = { ...state, installed: false }; await save();
    return status();
  }

  async function pickerModels() {
    await load();
    if (!state.installed) return [];
    const hw = await hardware();
    const out = [];
    for (const e of list) {
      if (!(await onDisk(e))) continue;
      const v = await view(e, hw, true);
      out.push({ id: e.id, displayName: e.name, ownedBy: e.publisher, contextLength: v.ctx, providerId: PROVIDER_ID, providerName: 'Bunny local', sizeBytes: e.size, toolsOk: v.tools, fit: v.fit, fitText: v.fitText, note: v.tools ? 'uses tools' : 'chat only' });
    }
    for (const o of await placesImpl.ownList()) { // the person's own files: tagged so they are never mistaken for ones Bunny checked
      const f = chooseContext({ id: 'own:' + o.id, name: o.name, size: o.size, kvBytesPerToken: o.kvBytesPerToken, nativeCtx: o.contextLength ?? 8192, tools: false }, { freeRam: hw.freeRam, freeVram: hw.freeVram ?? null, gpu: Boolean(hw.gpu && state.useGpu) });
      out.push({ id: 'own:' + o.id, displayName: o.name, ownedBy: 'Your file', contextLength: f.ctx, providerId: PROVIDER_ID, providerName: 'Bunny local', sizeBytes: o.size, toolsOk: o.toolsOn && o.format !== 'none' && f.ctx >= 16384, fit: f.fit.result, fitText: f.fit.text, note: 'Your file' });
    }
    return out;
  }

  /** Errors of the places and the files become the service's own plain errors. */
  function translate(err) {
    if (err instanceof LocalError) return err;
    if (err instanceof PlaceError) return new LocalError(err.code, err.message, err.status ?? 409);
    if (err instanceof FolderError) return new LocalError('place.' + err.code, err.message, 400);
    if (err instanceof GgufError) return new LocalError('gguf.' + err.code, err.message, 400);
    return err;
  }
  const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (err) { throw translate(err); } };
  let lastMove = null;

  /** The window's own view of the places: paths included. Never sent to a device (the route is window-only, LF-1, LF-13). */
  async function placesView() {
    await load(); const ok = await refreshRoot();
    const c = storeImpl.custom();
    const free = await (async () => { try { const sf = await statfs(rootNow ?? dataDir); return Number(sf.bavail) * Number(sf.bsize); } catch { return null; } })();
    return {
      download: { custom: Boolean(c), where: c ? c.real : null, root: ok ? rootNow : null, cloud: Boolean(c?.cloud), available: ok, message: ok ? null : "The download folder isn't available. Plug in the drive or choose another folder.", defaultRoot, freeBytes: free },
      downloads: Object.fromEntries(Object.entries(placesImpl.state().downloads).map(([id, r]) => [id, { where: r.real }])),
      folders: await placesImpl.folders(), own: await placesImpl.ownList(), busy: busy(),
      move: moving ? { done: moving.done, total: moving.total } : null, lastMove, removal: lastRemoval,
    };
  }
  async function startMove() {
    await load();
    if (busy()) throw new LocalError('place.busy', 'Wait for the download to finish or cancel it.', 409);
    if (!(await refreshRoot())) throw new LocalError('place.unavailable', "The download folder isn't available. Plug in the drive or choose another folder.", 409);
    const ctl = new AbortController(); const job = { ctl, done: 0, total: 0 }; moving = job; lastMove = null;
    storeImpl.move({ entries: list, signal: ctl.signal, onProgress: (p) => { job.done = p.done; job.total = p.total; } })
      .then((r) => { lastMove = r; }, (err) => { lastMove = { moved: [], failed: [{ id: '', reason: translate(err).message }], untouched: [] }; })
      .finally(() => { moving = null; });
    return placesView();
  }

  const ready = { value: false };
  async function refreshReady() { ready.value = (await pickerModels()).length > 0; }
  return {
    placesView: guard(placesView), startMove: guard(startMove), cancelMove: async () => { moving?.ctl.abort(); return placesView(); },
    chooseDownloadFolder: guard(async (path) => { await storeImpl.setDownloadFolder(path, { busy: busy() }); await refreshRoot(); return placesView(); }),
    useDefaultDownloadFolder: guard(async () => { await storeImpl.clearDownloadFolder({ busy: busy() }); await refreshRoot(); return placesView(); }),
    addModelFolder: guard(async (path) => { await placesImpl.addModelFolder(path); return placesView(); }),
    removeModelFolder: guard(async (id) => { await placesImpl.removeModelFolder(id); return placesView(); }),
    addLmStudioBack: guard(async () => { await placesImpl.addLmStudioBack(); return placesView(); }),
    inspectFile: guard((args) => placesImpl.inspect(args)),
    addFile: guard(async (token) => { const o = await placesImpl.add(token); await refreshReady(); return { added: o, places: await placesView() }; }),
    removeFile: guard(async (id) => { if (runner.running()?.modelId === 'own:' + id) await runner.stop(); await placesImpl.removeOwn(id); await refreshReady(); return placesView(); }),
    setFileTools: guard(async (id, on) => { await placesImpl.setTools(id, on); await refreshReady(); return placesView(); }),
    protectedPaths: () => storeImpl.protectedPaths(),
    status, setUp, cancelSetup, download, pause, resume, cancel, remove, settings, stopNow, ensure, removeAll, pickerModels, load, view,
    raise: async () => { throw new LocalError('local.notAvailable', 'Only in test mode.', 404); },
    isFake: () => false,
    hasReady: () => ready.value,
    refreshReady,
    baseUrl: () => runner.endpoint()?.baseUrl ?? '',
    apiKey: () => runner.endpoint()?.apiKey ?? null,
    stopAll: () => runner.stop(),
    runner, QUICK_ASK_STARTING,
  };
}

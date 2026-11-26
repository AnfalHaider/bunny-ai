/**
 * LOCAL-MODELS LM-9 to LM-12 and Security's SP-3, SP-5, SP-6: starting, watching and stopping the model runtime (llama-server).
 *
 *  - The exact argv (LM-10), built here and checked here: loopback only, a per-run key FILE, no UI, no slots, no download, no tools, no RPC, no metrics, no props, no --lora.
 *  - The key: 32 random bytes, new for every start, written to <data>/runtimes/run/<id>.key with an owner-only ACL, read by the server once at start, and DELETED the moment /health answers 200
 *    (or the start fails). It then lives only in this process's memory. It is never in the argv, a log, a message or a response.
 *  - The environment: minimalEnv plus exactly two variables, HF_HUB_OFFLINE=1 and LLAMA_CACHE inside the models folder. No provider key, no token, no BUNNY_*, no proxy credentials, no NODE_OPTIONS.
 *  - The process starts by absolute path, hidden, with the models folder as its working directory. Through the model runner helper it is Low integrity and inside a kill-on-close job (SP-6).
 *  - While it runs, its port is registered, so nothing a model, a page or a device names can reach it (LM-17).
 *  - Idle stop, Stop now, quit: the whole tree is killed.
 */
import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';

import { registerRuntimePort, unregisterRuntimePort } from './ownAddress.js';
import { minimalEnv, killTree } from './engines/process.js';
import { verifyRuntime } from './localRuntimeInstall.js';
import { powershellPath } from './safeExec.js';

export const LOG_VERBOSITY = 1; // S-LM4: no prompt text in the log at 1, 3 or 4; 1 is the quietest
export const HEALTH_WAIT_MS = 120_000;
export const IDLE_CHOICES = [5, 10, 30, 60, 0];

/** Flags that must never be on the command line. Matched on the flag name (before any "="). */
export const FORBIDDEN_FLAGS = ['-hf', '--hf-repo', '-hff', '--hf-file', '-hft', '--hf-token', '--tools', '--agent', '--ui-agent', '--mcp', '--mcp-config', '--allow-unauthenticated-tools', '--rpc', '--metrics', '--props',
  '--lora', '--lora-scaled', '--lora-init-without-apply', '--models-dir', '--models-preset', '--api-key', '--webui', '--ui', '--path', '--media-path', '--ssl-key-file', '--ssl-cert-file',
  '--chat-template-file', '--mmproj', '--mmproj-url', '-mm', '-mmu', '-md', '--model-draft', '--slot-save-path']; // LF-9: for a file Bunny did not download, none of these is ever passed

/** The exact argv for one start (LM-10). */
export function buildArgv({ model, port, keyFile, ctx, gpu = false, verbosity = LOG_VERBOSITY, chatTemplate = null }) {
  return ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--api-key-file', keyFile, '--no-ui', '--no-slots', '-c', String(ctx), '--jinja', '--log-verbosity', String(verbosity), ...(gpu ? ['-ngl', '99'] : []), ...(chatTemplate === 'chatml' ? ['--chat-template', 'chatml'] : [])]; // LF-4: only the runner's own plain format, and only for a file with no chat format
}

/** Throws unless the argv is exactly what LM-10 allows. */
export function checkArgv(argv) {
  const flags = argv.filter((a) => /^-/.test(a)).map((a) => a.split('=')[0]);
  for (const f of flags) if (FORBIDDEN_FLAGS.includes(f)) throw new Error(`The model runtime was about to start with ${f}, which Bunny never uses.`);
  for (const need of ['-m', '--host', '--port', '--api-key-file', '--no-ui', '--no-slots', '-c', '--jinja']) if (!flags.includes(need)) throw new Error(`The model runtime's command line has no ${need}.`);
  const ct = argv.indexOf('--chat-template');
  if (ct >= 0 && argv[ct + 1] !== 'chatml') throw new Error('The model runtime may only be given its own plain chat format.');
  if (argv[argv.indexOf('--host') + 1] !== '127.0.0.1') throw new Error('The model runtime may only listen on 127.0.0.1.');
  return argv;
}

/** The environment of the runtime: nothing of Bunny's, two variables of its own. */
export function runtimeEnv({ dataDir, base = process.env }) {
  return { ...minimalEnv(base), NoDefaultCurrentDirectoryInExePath: '1', HF_HUB_OFFLINE: '1', LLAMA_CACHE: join(dataDir, 'models', '.cache') };
}

/** What the last lines of stderr mean, in plain words: never the raw text (LM-9). */
export function plainReason(stderr) {
  const t = String(stderr ?? '');
  if (/out of memory|failed to allocate|cudaMalloc|bad_alloc|unable to allocate|ErrorOutOfDeviceMemory/i.test(t)) return { code: 'local.memory', message: 'There was not enough memory to load that model. Close other apps or choose a smaller model.' };
  if (/failed to load model|error loading model|invalid magic|unexpected end of file|gguf/i.test(t)) return { code: 'local.loadFailed', message: 'The model file could not be loaded. Delete it and download it again.' };
  if (/vulkan|no devices|GPU/i.test(t)) return { code: 'local.gpu', message: "The graphics card couldn't be used. Turn off Use graphics card and try again." };
  return { code: 'local.exited', message: 'The model runtime stopped before it was ready.' };
}

/** A free loopback port, picked at random by the system. */
export const pickPort = () => new Promise((resolve, reject) => { const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });

/** Does anything answer on this PC's own LAN address at that port? (It must not: the server listens on 127.0.0.1 only.) */
export function lanReachable(port, { interfaces = networkInterfaces } = {}) {
  const addrs = Object.values(interfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  return Promise.all(addrs.map((host) => new Promise((resolve) => {
    const s = connect({ host, port, timeout: 1500 });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.once('timeout', () => { s.destroy(); resolve(false); });
  }))).then((all) => all.some(Boolean));
}

const icacls = (file) => new Promise((resolve) => {
  if (process.platform !== 'win32') return resolve(true);
  const user = process.env.USERNAME;
  if (!user) return resolve(false); // no user name: the key file cannot be locked to its owner, so nothing starts (LF L1)
  execFile(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [file, '/inheritance:r', '/grant:r', `${user}:(R,W,D)`], { windowsHide: true }, (err) => resolve(!err));
});

/** The default launch: through the model runner helper (Low, in the job), by absolute path, hidden, no shell. */
export function helperLaunch(helper) {
  return async ({ file, args, cwd, env, capture = false }) => {
    const quote = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
    const wrapped = await helper.wrap({ cwd, commandLine: [file, ...args].map(quote).join(' ') });
    if (!wrapped.ok) throw Object.assign(new Error(`The model runner helper is not available: ${wrapped.why}`), { code: 'local.helper' });
    return spawnTracked(wrapped.file, wrapped.args, { cwd, env, capture });
  };
}

/** Spawn and keep what Bunny needs to watch: the pid, the last stderr, and when it ends. */
export function spawnTracked(file, args, { cwd, env, capture = false }) {
  const child = spawn(file, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  let stderr = '';
  let stdout = '';
  // read and dropped: nothing the server prints is kept (LM-9). Only a short trial (`--version`, `--list-devices`) asks to keep its words (capture), and they are never logged.
  child.stdout.on('data', (c) => { if (capture) stdout = (stdout + c).slice(-8000); });
  child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-4000); });
  const exited = new Promise((resolve) => { child.on('close', (code) => resolve(code)); child.on('error', () => resolve(-1)); });
  return { pid: child.pid, exited, stderr: () => stderr, output: () => `${stdout}
${stderr}` };
}

export class RuntimeStartError extends Error {
  constructor(code, message) { super(message); this.name = 'RuntimeStartError'; this.code = code; }
}

/**
 * @param {object} o
 * @param {string} o.dataDir
 * @param {(args:{file:string,args:string[],cwd:string,env:object})=>Promise<{pid:number,exited:Promise<number>,stderr:()=>string}>} o.launch
 * @param {(url:string, key:string)=>Promise<number>} [o.health]  GET /health, resolves the status (0 when nothing answers)
 */
export function createLocalRuntime({ dataDir, launch, health = httpHealth, port = pickPort, lan = lanReachable, lockKey = icacls, kill = killTree, healthWaitMs = HEALTH_WAIT_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), clock = Date.now, idle = { set: setTimeout, clear: clearTimeout } }) {
  const runDir = join(dataDir, 'runtimes', 'run');
  const modelsDir = join(dataDir, 'models');
  let current = null; // { pid, port, key, modelId, ctx, gpu, startedAt, lastUsed, exited }
  let starting = null;
  let idleMinutes = 10;
  let idleTimer = null;

  const keyPath = (id) => join(runDir, `${id}.key`);
  async function dropKey(path) { if (path) await rm(path, { force: true }).catch(() => {}); }
  /** The next start (and a crash) deletes any key file a dead run left (LM-12). */
  async function sweepKeys() { for (const n of await readdir(runDir).catch(() => [])) if (n.endsWith('.key')) await rm(join(runDir, n), { force: true }).catch(() => {}); }

  let inflight = 0; let drained = [];
  /** A call to the model begins (T1): the server is not stopped by the idle timer, or switched to another model, until every call that began has ended. Returns the function that ends it (once). */
  function begin() {
    inflight += 1; if (current) { current.lastUsed = clock(); } armIdle();
    let ended = false;
    return () => { if (ended) return; ended = true; inflight = Math.max(0, inflight - 1); if (current) current.lastUsed = clock(); if (inflight === 0) { const w = drained; drained = []; for (const r of w) r(); } armIdle(); };
  }
  const waitForCalls = (maxMs = 10 * 60_000) => (inflight === 0 ? Promise.resolve() : new Promise((resolve) => { const t = setTimeout(resolve, maxMs); t.unref?.(); drained.push(() => { clearTimeout(t); resolve(); }); }));
  function armIdle() {
    idle.clear(idleTimer); idleTimer = null;
    if (!current || !idleMinutes) return;
    idleTimer = idle.set(() => { if (inflight > 0) { armIdle(); return; } stop().catch(() => {}); }, idleMinutes * 60_000); // a reply that is still arriving is never cut off by the idle stop
    idleTimer.unref?.();
  }

  async function startOne({ runtimeDir, modelFile, modelId, ctx, gpu, chatTemplate = null }) {
    const ok = await verifyRuntime(runtimeDir);
    if (!ok.ok) throw new RuntimeStartError(ok.missing ? 'local.missing' : 'local.changed', ok.missing ? "Bunny local isn't set up on this PC." : "Bunny local's program changed on disk.");
    await mkdir(runDir, { recursive: true });
    await mkdir(modelsDir, { recursive: true });
    await sweepKeys();
    const id = randomBytes(8).toString('hex');
    const key = randomBytes(32).toString('hex'); // new for every start
    const file = keyPath(id);
    await writeFile(file, key, { mode: 0o600 });
    if ((await lockKey(file)) === false) { await dropKey(file); throw new RuntimeStartError('local.keyLock', "Bunny couldn't lock the key file to your account, so it didn't start the model."); }
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const p = await port();
      const argv = checkArgv(buildArgv({ model: modelFile, port: p, keyFile: file, ctx, gpu, chatTemplate }));
      registerRuntimePort(p); // from here on nothing a model, a page or a device names may reach this port
      let proc;
      // LF-7: the working folder is Bunny's runtime folder, never a model's folder
      try { proc = await launch({ file: ok.exe, args: argv, cwd: runtimeDir, env: runtimeEnv({ dataDir }) }); } catch (err) { unregisterRuntimePort(p); await dropKey(file); throw err; }
      let exitedEarly = null;
      proc.exited.then((code) => { exitedEarly = code; });
      const until = clock() + healthWaitMs;
      let status = 0;
      while (clock() < until && exitedEarly === null) {
        status = await health(`http://127.0.0.1:${p}/health`, key).catch(() => 0);
        if (status === 200) break;
        await sleep(150);
      }
      if (status === 200) {
        await dropKey(file); // SP-5: the server read the key once, at start: the file has done its job
        if (await lan(p)) { await kill(proc.pid); unregisterRuntimePort(p); throw new RuntimeStartError('local.lan', 'The model runtime answered on the network, so Bunny stopped it.'); }
        current = { pid: proc.pid, port: p, key, modelId, ctx, gpu, chatTemplate, startedAt: clock(), lastUsed: clock(), exited: proc.exited };
        proc.exited.then(() => { if (current?.pid === proc.pid) { unregisterRuntimePort(p); current = null; idle.clear(idleTimer); } });
        armIdle();
        return current;
      }
      // not ready: end it, read why, and (for a port that was taken) try again with another port
      await kill(proc.pid);
      unregisterRuntimePort(p);
      lastErr = plainReason(proc.stderr());
      if (exitedEarly === null) lastErr = { code: 'local.timeout', message: 'The model took too long to start.' };
      if (!/address already in use|bind|EADDRINUSE/i.test(proc.stderr())) break;
    }
    await dropKey(file);
    throw new RuntimeStartError(lastErr?.code ?? 'local.exited', lastErr?.message ?? 'The model runtime stopped before it was ready.');
  }

  /** Single flight: two callers asking at once share one start. A different model stops the running one first. */
  async function ensure(opts) {
    if (current && current.modelId === opts.modelId && current.ctx === opts.ctx && current.gpu === opts.gpu && (current.chatTemplate ?? null) === (opts.chatTemplate ?? null)) { current.lastUsed = clock(); armIdle(); return current; }
    if (starting) { await starting.catch(() => {}); if (current?.modelId === opts.modelId) return current; }
    starting = (async () => { if (current) { await waitForCalls(); await stop(); } return startOne(opts); })(); // a switch waits for the reply that is streaming (LM-9)
    try { return await starting; } finally { starting = null; }
  }

  async function stop() {
    idle.clear(idleTimer); idleTimer = null;
    const c = current;
    if (!c) return false;
    current = null;
    unregisterRuntimePort(c.port);
    await kill(c.pid);
    await c.exited.catch(() => {});
    return true;
  }

  return {
    ensure, stop,
    touch: () => { if (current) { current.lastUsed = clock(); armIdle(); } },
    begin, inflight: () => inflight,
    setIdleMinutes: (m) => { if (!IDLE_CHOICES.includes(m)) throw new Error('Choose 5, 10, 30 or 60 minutes, or only when Bunny closes.'); idleMinutes = m; armIdle(); },
    /** Looked up per request (LM-2): never stored anywhere. */
    endpoint: () => (current ? { baseUrl: `http://127.0.0.1:${current.port}/v1`, apiKey: current.key } : null),
    running: () => (current ? { modelId: current.modelId, pid: current.pid, port: current.port, startedAt: current.startedAt, lastUsed: current.lastUsed } : null),
    sweepKeys,
    keyPath,
  };
}

/** GET /health over loopback; resolves the status code, 0 when nothing answers. */
export async function httpHealth(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(2000) }); return r.status; } catch { return 0; }
}

/** Kill any llama-server.exe whose image is under <data>/runtimes/ (a crash of Bunny left it), and only those; returns the PowerShell it ran (so a test can read it). */
export function leftoverCommand(dataDir) {
  const root = join(dataDir, 'runtimes').replace(/'/g, "''");
  return `Get-CimInstance Win32_Process -Filter "Name='llama-server.exe'" | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith('${root}\\', [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
}
export function killLeftovers(dataDir, { run = (cmd) => new Promise((r) => execFile(powershellPath() ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 20_000 }, () => r())) } = {}) {
  return process.platform === 'win32' ? run(leftoverCommand(dataDir)) : Promise.resolve();
}

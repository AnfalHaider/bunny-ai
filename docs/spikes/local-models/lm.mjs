// LOCAL-MODELS spikes: a tiny harness around the pinned llama-server (b12760). Test aid only; nothing here ships.
// Everything stays under one scratch folder; the server binds 127.0.0.1 only, with a per-run key file, and no Hugging Face token is used anywhere.
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

export const ROOT = new URL('.', import.meta.url).pathname.replace(/^\//, '').replace(/\/$/, '');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const freePort = () => new Promise((resolve, reject) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); s.on('error', reject); });

/** The argv of LM-2 / LM-10, exactly. `extra` is for deliberate probes only (it is recorded in the result). */
export function argvFor({ model, port, keyFile, ctx, verbosity = 1, extra = [] }) {
  return ['-m', model, '--host', '127.0.0.1', '--port', String(port), '--api-key-file', keyFile, '--no-ui', '--no-slots', '-c', String(ctx), '--jinja', '--log-verbosity', String(verbosity), ...extra];
}

export function safeEnv(runtimeDir) {
  return { SystemRoot: process.env.SystemRoot, windir: process.env.windir, PATH: `${runtimeDir};${process.env.SystemRoot}\\System32`, TEMP: join(ROOT, 'tmp'), TMP: join(ROOT, 'tmp'), HF_HUB_OFFLINE: '1', LLAMA_CACHE: join(ROOT, 'cache') };
}

export async function startServer({ build, model, ctx = 8192, verbosity = 1, extra = [], tag = build, ngl = null, readyMs = 240_000 }) {
  const runtimeDir = join(ROOT, `rt-${build === 'cpu' ? 'cpu' : 'vulkan'}`);
  mkdirSync(join(ROOT, 'tmp'), { recursive: true }); mkdirSync(join(ROOT, 'cache'), { recursive: true }); mkdirSync(join(ROOT, 'logs'), { recursive: true });
  const port = await freePort();
  const key = randomBytes(32).toString('hex');
  const keyFile = join(ROOT, 'tmp', `${tag}.key`);
  writeFileSync(keyFile, `${key}\n`);
  const args = argvFor({ model, port, keyFile, ctx, verbosity, extra: [...extra, ...(ngl === null ? [] : ['-ngl', String(ngl)])] });
  const logFile = join(ROOT, 'logs', `${tag}.log`);
  const fd = openSync(logFile, 'w');
  const child = spawn(join(runtimeDir, 'llama-server.exe'), args, { cwd: runtimeDir, env: safeEnv(runtimeDir), windowsHide: true, stdio: ['ignore', fd, fd] });
  const t0 = Date.now();
  let exited = null; child.on('exit', (c) => { exited = c; });
  const base = `http://127.0.0.1:${port}`;
  for (;;) {
    if (exited !== null) throw Object.assign(new Error(`server exited ${exited}`), { log: readFileSync(logFile, 'utf8').slice(-3000) });
    if (Date.now() - t0 > readyMs) throw new Error('not ready in time');
    try { const r = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${key}` } }); if (r.status === 200) break; } catch { /* not up yet */ }
    await sleep(500);
  }
  const server = {
    child, port, base, key, keyFile, logFile, args, startMs: Date.now() - t0,
    call: (path, { method = 'GET', body, auth = key, host = '127.0.0.1' } = {}) => fetch(`http://${host}:${port}${path}`, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(300_000) }),
    stop: async () => { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } await sleep(500); closeSync(fd); },
    rss: () => workingSetMB(child.pid),
  };
  return server;
}

/** Working set in MB of one process, from tasklist. */
export function workingSetMB(pid) {
  try {
    const out = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' });
    const m = /"([\d.,]+) K"\s*$/m.exec(out.trim());
    return m ? Math.round(Number(m[1].replace(/[.,]/g, '')) / 1024) : null;
  } catch { return null; }
}

/** Every TCP/UDP endpoint of a pid that is not loopback, from netstat (sampled by the caller). */
export function outbound(pid) {
  const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const rows = [];
  for (const line of out.split(/\r?\n/)) {
    const p = line.trim().split(/\s+/);
    if (p.length < 4 || Number(p[p.length - 1]) !== pid) continue;
    const [proto, local, remote, state] = p;
    rows.push({ proto, local, remote, state: proto === 'UDP' ? '' : state });
  }
  return rows;
}

export const isLoopbackOrWildcard = (a) => /^(127\.|\[::1\]|0\.0\.0\.0|\[::\]|\*)/.test(a);

export async function chat(server, body) {
  const t = Date.now();
  const r = await server.call('/v1/chat/completions', { method: 'POST', body: { stream: false, ...body } });
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j, ms: Date.now() - t };
}

// Usage: node extras.mjs <dll|low|job> <model-file> [build]
// Rev 2 spike checks: loaded DLLs, low integrity through the F13 helper (src/server/confine.js), kill-on-close job object. Test aid only.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, argvFor, chat, freePort, safeEnv, sleep, startServer } from './lm.mjs';

const [, , what, model, build = 'cpu'] = process.argv;
mkdirSync(join(ROOT, 'results'), { recursive: true });
const save = (name, data) => { writeFileSync(join(ROOT, 'results', `${name}.json`), JSON.stringify(data, null, 2)); console.log(JSON.stringify(data, null, 2).slice(0, 5000)); };
const ps = (args) => spawnSync('powershell', ['-NoProfile', '-File', ...args], { encoding: 'utf8', timeout: 120_000 });
const alive = (pid) => execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).includes(`"${pid}"`);
const generic = (p) => p.replace(/\\/g, '/').replace(/^C:\/Users\/[^/]+\/AppData\/Local\/Temp\/claude\/[^/]+\/[^/]+\/scratchpad\/lm/i, '<scratch>');
const listenerPid = (port) => { const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', maxBuffer: 1 << 26 }); const line = out.split(/\r?\n/).find((l) => new RegExp(`127\\.0\\.0\\.1:${port}\\s.*LISTENING`).test(l)); return line ? Number(line.trim().split(/\s+/).pop()) : null; };

if (what === 'dll') {
  const s = await startServer({ build, model, ctx: 4096, tag: `dll-${build}`, ngl: build === 'vulkan' ? 99 : null });
  await chat(s, { messages: [{ role: 'user', content: 'hi' }], max_tokens: 4, temperature: 0 });
  const r = ps([join(ROOT, 'probe.ps1'), '-ProcId', String(s.child.pid), '-What', 'modules']);
  const mods = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rt = join(ROOT, `rt-${build}`).replace(/\\/g, '/').toLowerCase();
  const win = (process.env.SystemRoot ?? 'C:\\Windows').replace(/\\/g, '/').toLowerCase();
  const groups = { runtimeFolder: [], windowsSystem: [], other: [] };
  for (const m of mods) { const l = m.replace(/\\/g, '/').toLowerCase(); (l.startsWith(`${rt}/`) ? groups.runtimeFolder : l.startsWith(`${win}/`) ? groups.windowsSystem : groups.other).push(generic(m)); }
  await s.stop();
  save(`dll-${build}`, { build, totalModules: mods.length, runtimeFolderCount: groups.runtimeFolder.length, windowsSystemCount: groups.windowsSystem.length, otherCount: groups.other.length, other: groups.other, runtimeFolder: groups.runtimeFolder.map((p) => p.split('/').pop()), windowsSystemSample: groups.windowsSystem.slice(0, 80).map((p) => p.split('/').slice(-2).join('/')), stderr: r.stderr.slice(0, 300) });
} else if (what === 'low') {
  const { createConfiner } = await import(pathToFileURL(process.env.CONFINE_JS).href);
  const dataDir = join(ROOT, 'data'); mkdirSync(dataDir, { recursive: true });
  const confiner = createConfiner({ dataDir });
  const helper = await confiner.use();
  const out = { build, helperReady: helper.ok, helperWhy: helper.ok ? null : helper.why };
  if (helper.ok) {
    const runtimeDir = join(ROOT, `rt-${build}`);
    const port = await freePort();
    const key = randomBytes(32).toString('hex');
    const keyFile = join(ROOT, 'tmp', 'low.key'); mkdirSync(join(ROOT, 'tmp'), { recursive: true }); writeFileSync(keyFile, `${key}\n`);
    const exe = join(runtimeDir, 'llama-server.exe');
    const cmd = [`"${exe}"`, ...argvFor({ model, port, keyFile, ctx: 4096, verbosity: 1, extra: [] }).map((a) => (/\s/.test(a) ? `"${a}"` : a)), ...(build === 'vulkan' ? ['-ngl', '99'] : [])].join(' ');
    const logFile = join(ROOT, 'logs', `low-${build}.log`); mkdirSync(join(ROOT, 'logs'), { recursive: true });
    const fd = openSync(logFile, 'w');
    const child = spawn(helper.path, [runtimeDir, cmd], { env: safeEnv(runtimeDir), windowsHide: true, stdio: ['ignore', fd, fd] });
    let exited = null; child.on('exit', (c) => { exited = c; });
    const t0 = Date.now(); let ready = false;
    while (exited === null && Date.now() - t0 < 120_000) { try { const r = await fetch(`http://127.0.0.1:${port}/health`, { headers: { authorization: `Bearer ${key}` } }); if (r.status === 200) { ready = true; break; } } catch { /* not yet */ } await sleep(500); }
    out.startedMs = Date.now() - t0; out.ready = ready; out.helperExit = exited;
    if (ready) {
      const lp = listenerPid(port); out.listenerPid = lp;
      out.integrity = ps([join(ROOT, 'probe.ps1'), '-ProcId', String(lp), '-What', 'integrity']).stdout.trim();
      const r = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ messages: [{ role: 'user', content: 'Write one sentence about rabbits.' }], max_tokens: 60, temperature: 0, chat_template_kwargs: { enable_thinking: false } }) });
      const j = await r.json();
      out.chat = { status: r.status, text: String(j.choices?.[0]?.message?.content ?? '').slice(0, 120), predictedPerSecond: j.timings?.predicted_per_second };
      // does it try to write anywhere it may not? the server logged nothing unusual if it ran; record the first error lines
      out.logErrors = readFileSync(logFile, 'utf8').split(/\r?\n/).filter((l) => /\b E |error|denied|failed/i.test(l)).slice(0, 8).map((l) => generic(l).slice(0, 200));
      try { execFileSync('taskkill', ['/PID', String(lp), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    } else out.logTail = generic(readFileSync(logFile, 'utf8').slice(-1500));
    try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
    closeSync(fd);
  }
  save(`low-${build}`, out);
} else if (what === 'job') {
  const out = { build, runs: [] };
  for (const useJob of [1, 0]) {
    const port = await freePort();
    const key = randomBytes(32).toString('hex');
    const keyFile = join(ROOT, 'tmp', `job${useJob}.key`); mkdirSync(join(ROOT, 'tmp'), { recursive: true }); writeFileSync(keyFile, `${key}\n`);
    const runtimeDir = join(ROOT, `rt-${build}`);
    const argLine = argvFor({ model, port, keyFile, ctx: 4096, verbosity: 1, extra: [] }).join(' ') + (build === 'vulkan' ? ' -ngl 99' : '');
    const r = ps([join(ROOT, 'jobtest.ps1'), '-Exe', join(runtimeDir, 'llama-server.exe'), '-ArgLine', argLine, '-Cwd', runtimeDir, '-UseJob', String(useJob), '-HoldMs', '9000']);
    const pid = Number(/server pid: (\d+)/.exec(r.stdout)?.[1]);
    await sleep(2500);
    const row = { useJob: Boolean(useJob), script: r.stdout.trim().split(/\r?\n/), stderr: r.stderr.trim().slice(0, 300), serverPid: pid, aliveAfterParentEnded: pid ? alive(pid) : null };
    if (pid && row.aliveAfterParentEnded) { try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
    out.runs.push(row);
  }
  save(`job-${build}`, out);
}
process.exit(0);

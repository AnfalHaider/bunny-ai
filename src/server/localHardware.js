/**
 * LOCAL-MODELS: what this PC has, and whether the downloaded program runs on it.
 *  - the graphics card's maker and name from Windows (Win32_VideoController), read before the program exists, to choose the CPU or the Vulkan build;
 *  - the card's memory from the program's own `--list-devices` (Windows' number caps at 4 GB, so it is not used);
 *  - the trial: `--version` must end with 0, run the same way a model is run (the Low helper, a kill-on-close job, the two-variable environment).
 * Everything that touches the PC is passed in, so the tests use stand-ins.
 */
import { execFile } from 'node:child_process';
import { powershellPath } from './safeExec.js';
import { minimalEnv } from './engines/process.js';

const KNOWN = [['nvidia', 'NVIDIA'], ['intel', 'Intel'], ['amd', 'AMD'], ['advanced micro', 'AMD'], ['ati', 'AMD'], ['qualcomm', 'Qualcomm']];
const VIRTUAL = /microsoft basic|remote display|virtual|vmware|hyper-v|parsec|citrix|displaylink/i;

/** The JSON of Get-CimInstance Win32_VideoController (one object or a list) -> { vendor, name } of the best real card, or null. */
export function parseVideoControllers(raw) {
  let rows; try { rows = JSON.parse(String(raw ?? '')); } catch { return null; }
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  const cards = rows.map((r) => {
    const text = `${r?.AdapterCompatibility ?? ''} ${r?.Name ?? ''}`.toLowerCase();
    const vendor = KNOWN.find(([k]) => text.includes(k))?.[1] ?? null;
    return { vendor, name: String(r?.Name ?? '').trim(), virtual: VIRTUAL.test(String(r?.Name ?? '')) };
  }).filter((c) => c.name && !c.virtual);
  // a separate NVIDIA/AMD card is preferred to the processor's own graphics
  const rank = (c) => (c.vendor === 'NVIDIA' ? 3 : c.vendor === 'AMD' ? 2 : c.vendor === 'Intel' ? 1 : 0);
  const best = cards.sort((a, b) => rank(b) - rank(a))[0];
  return best ? { vendor: best.vendor, name: best.name } : null;
}

const exec = (file, args, { timeout = 15_000, env } = {}) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout, env, maxBuffer: 1 << 20 }, (err, stdout) => resolve({ ok: !err, stdout: String(stdout ?? '') }));
});

/** { vendor, name } of this PC's graphics card, or null (not Windows, no real card, or the question failed). */
export async function detectGpu({ run = exec, powershell = powershellPath() } = {}) {
  if (!powershell) return null;
  const r = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility | ConvertTo-Json -Compress']);
  return r.ok ? parseVideoControllers(r.stdout) : null;
}

/** The text of `llama-server --list-devices`: "  Vulkan0: NVIDIA GeForce RTX 3060 (12288 MiB, 11000 MiB free)" -> [{ name, totalBytes, freeBytes }]. */
export function parseListDevices(text) {
  const out = [];
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*[A-Za-z]+\d+:\s*(.+?)\s*\((\d+)\s*MiB(?:,\s*(\d+)\s*MiB free)?\)\s*$/.exec(line);
    if (m) out.push({ name: m[1], totalBytes: Number(m[2]) * 1024 * 1024, freeBytes: m[3] === undefined ? null : Number(m[3]) * 1024 * 1024 });
  }
  return out;
}

/**
 * The trial and the card's memory, through the same launcher as a model run. `launch({ file, args, cwd, env, capture })` returns { exited, output(), pid }.
 * Resolves { ok, devices } and never throws; a program that does not end in 20 s counts as not working.
 */
export function createTrial({ launch, env = () => ({ ...minimalEnv(process.env), HF_HUB_OFFLINE: '1' }), timeoutMs = 20_000, kill = null } = {}) {
  async function one(exe, args, cwd) {
    let child;
    try { child = await launch({ file: exe, args, cwd, env: env(), capture: true }); } catch { return { ok: false, text: '' }; }
    let timer;
    const code = await Promise.race([child.exited, new Promise((r) => { timer = setTimeout(() => r('timeout'), timeoutMs); })]);
    clearTimeout(timer);
    if (code === 'timeout') { try { await kill?.(child.pid); } catch { /* it is gone or cannot be reached */ } return { ok: false, text: child.output?.() ?? '' }; }
    return { ok: code === 0, text: child.output?.() ?? '' };
  }
  const trial = async (exe, backend = 'cpu') => {
    const cwd = exe.replace(/[\/][^\/]+$/, '');
    const v = await one(exe, ['--version'], cwd);
    if (!v.ok) return { ok: false, devices: [] };
    const devices = backend === 'vulkan' ? parseListDevices((await one(exe, ['--list-devices'], cwd)).text) : [];
    return { ok: true, devices };
  };
  trial.devices = async (exe) => parseListDevices((await one(exe, ['--list-devices'], exe.replace(/[\/][^\/]+$/, ''))).text);
  return trial;
}

/**
 * check_environment: which runtimes are installed, which the project asks for,
 * and plain advice when they do not match. Read-only: it never installs anything.
 * The command runner is injectable so tests need no real tools.
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CAP = 3000;
const TIMEOUT_MS = 5000;

/** Real runner: fixed arguments only, never a shell string. Resolves { ok, out }, never rejects. */
export function defaultRunner(cmd, args) {
  return new Promise((done) => {
    // npm, pnpm and yarn are .cmd files on Windows: cmd.exe starts them (fixed words only).
    const win = process.platform === 'win32' && ['npm', 'pnpm', 'yarn'].includes(cmd);
    const [file, fileArgs] = win ? ['cmd.exe', ['/d', '/s', '/c', cmd, ...args]] : [cmd, args];
    try {
      execFile(file, fileArgs, { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 100_000 }, (err, stdout, stderr) => {
        done(err ? { ok: false, out: '' } : { ok: true, out: `${stdout}${stderr}`.trim() });
      });
    } catch { done({ ok: false, out: '' }); }
  });
}

const isX = (s) => s === undefined || s === '' || /^[xX*]$/.test(s);
const num = (s) => (isX(s) ? null : Number(s));

/** "v18.17.0" -> [18,17,0]; a partial or x version keeps null for the unknown parts. */
export function parseVersion(text) {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+].*)?$/.exec(String(text).trim());
  if (!m) return null;
  return [num(m[1]), num(m[2]), num(m[3])];
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
const fill = (v) => [v[0] ?? 0, v[1] ?? 0, v[2] ?? 0];
// The first version above every version the partial `lo` (with `given` parts spelled out) matches.
const bump = (lo, pivot) => lo.map((p, k) => (k < pivot ? p : k === pivot ? p + 1 : 0));

/** One comparator such as ">=20", "^18.2", "~3.8", "20.x" or "3.11.4". true / false / null (cannot tell). */
function satisfiesOne(have, token) {
  const m = /^(>=|<=|>|<|=|\^|~=|~)?(.+)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? '';
  if (/^[xX*]$/.test(m[2])) return true;
  const want = parseVersion(m[2]);
  if (!want || want[0] === null) return null;
  const lo = fill(want);
  const unknownAt = want.findIndex((p) => p === null);
  const given = unknownAt === -1 ? 3 : unknownAt;   // how many parts the range spelled out
  switch (op) {
    case '>=': return cmp(have, lo) >= 0;
    case '>': return cmp(have, bump(lo, given - 1)) >= 0;
    case '<=': return cmp(have, bump(lo, given - 1)) < 0;
    case '<': return cmp(have, lo) < 0;
    case '^': {
      const i = lo.findIndex((p) => p !== 0);
      const pivot = i === -1 || i >= given ? given - 1 : i;
      return cmp(have, lo) >= 0 && cmp(have, bump(lo, pivot)) < 0;
    }
    case '~': case '~=': {
      // ~ keeps the minor (~18.17 -> <18.18); Python's ~= drops the last part (~=3.8 -> <4).
      const pivot = op === '~=' ? Math.max(given - 2, 0) : (given >= 2 ? 1 : 0);
      return cmp(have, lo) >= 0 && cmp(have, bump(lo, pivot)) < 0;
    }
    default: // exact, or an x-range such as "20" / "20.x" / "3.11"
      return cmp(have, lo) >= 0 && cmp(have, bump(lo, given - 1)) < 0;
  }
}

/**
 * Does the installed version satisfy the range? true, false, or null when the range cannot be understood.
 * Handles >=, >, <=, <, ^, ~, ~=, x-ranges, exact, "a b" (and), "a, b" (and) and "a || b" (or).
 */
export function satisfies(installed, range) {
  const have = parseVersion(installed);
  if (!have || have[0] === null) return null;
  const h = fill(have);
  const text = String(range ?? '').trim();
  if (!text) return null;
  let sawUnknown = false;
  for (const alt of text.split('||')) {
    const tokens = alt.replace(/(>=|<=|>|<|=|\^|~=|~)\s+/g, '$1').split(/[\s,]+/).filter(Boolean);
    if (!tokens.length || tokens.includes('-')) { sawUnknown = true; continue; }
    const results = tokens.map((t) => satisfiesOne(h, t));
    if (results.includes(null)) { sawUnknown = true; continue; }
    if (results.every(Boolean)) return true;
  }
  return sawUnknown ? null : false;
}

const TOOLS = [
  { id: 'node', label: 'Node', cmds: [['node', ['--version']]] },
  { id: 'npm', label: 'npm', cmds: [['npm', ['--version']]] },
  { id: 'git', label: 'Git', cmds: [['git', ['--version']]] },
  { id: 'python', label: 'Python', cmds: [['python', ['--version']], ['py', ['--version']]] },
  { id: 'pnpm', label: 'pnpm', cmds: [['pnpm', ['--version']]], optional: true },
  { id: 'yarn', label: 'Yarn', cmds: [['yarn', ['--version']]], optional: true },
];

async function probe(tool, run) {
  for (const [cmd, args] of tool.cmds) {
    try {
      const r = await run(cmd, args);
      const m = r?.ok && /(\d+\.\d+(?:\.\d+)?)/.exec(String(r.out ?? ''));
      if (m) return m[1];
    } catch { /* a runner that throws counts as not installed */ }
  }
  return null;
}

const read = async (folder, name) => { try { return await readFile(join(folder, name), 'utf8'); } catch { return null; } };

/** The requirements a folder states: [{ tool, range, source }]. */
export async function readRequirements(folder) {
  const found = [];
  const add = (tool, range, source) => { if (range) found.push({ tool, range: String(range).trim(), source }); };
  const pkg = await read(folder, 'package.json');
  if (pkg) {
    try {
      const engines = JSON.parse(pkg).engines ?? {};
      add('node', engines.node, 'package.json');
      add('npm', engines.npm, 'package.json');
    } catch { /* an unreadable package.json states nothing */ }
  }
  for (const f of ['.nvmrc', '.node-version']) add('node', (await read(folder, f))?.split(/\r?\n/)[0], f);
  add('python', (await read(folder, '.python-version'))?.split(/\r?\n/)[0], '.python-version');
  const pyproject = await read(folder, 'pyproject.toml');
  if (pyproject) add('python', /^\s*requires-python\s*=\s*["']([^"']+)["']/m.exec(pyproject)?.[1], 'pyproject.toml');
  const runtime = await read(folder, 'runtime.txt');
  if (runtime) add('python', /^\s*python-(\S+)/m.exec(runtime)?.[1], 'runtime.txt');
  const tv = await read(folder, '.tool-versions');
  if (tv) {
    for (const line of tv.split(/\r?\n/)) {
      const [name, ver] = line.trim().split(/\s+/);
      if (name === 'nodejs' || name === 'node') add('node', ver, '.tool-versions');
      else if (name === 'python') add('python', ver, '.tool-versions');
    }
  }
  return found;
}

/** "Node 20 or newer" for ">=20", otherwise the range as written. */
function describeRange(label, range) {
  const m = /^>=\s*v?(\d+(?:\.\d+){0,2})$/.exec(range);
  if (m) return `${label} ${m[1]} or newer`;
  if (/^v?\d+(\.\d+){0,2}$/.test(range)) return `${label} ${range.replace(/^v/, '')}`;
  return `${label} ${range}`;
}

const INSTALL_HELP = {
  node: 'Install the current Node LTS from nodejs.org, then reopen Bunny.',
  python: 'Install a matching Python from python.org, then reopen Bunny.',
  npm: 'Updating Node from nodejs.org also updates npm; then reopen Bunny.',
};

/** Build the report. `run(cmd, args)` resolves { ok, out } and must not throw. */
export async function checkEnvironment({ folder, run = defaultRunner } = {}) {
  const versions = {};
  const rows = [];
  await Promise.all(TOOLS.map(async (t) => { versions[t.id] = await probe(t, run); }));
  for (const t of TOOLS) {
    if (versions[t.id]) rows.push(`${t.label}: ${versions[t.id]}`);
    else if (!t.optional) rows.push(`${t.label}: not installed`);
  }
  const reqs = folder ? await readRequirements(folder) : [];
  const advice = [];
  for (const r of reqs) {
    const label = TOOLS.find((t) => t.id === r.tool)?.label ?? r.tool;
    const need = describeRange(label, r.range);
    const have = versions[r.tool];
    if (!have) {
      advice.push(`This project needs ${need} (from ${r.source}), but ${label} is not installed. ${INSTALL_HELP[r.tool] ?? ''}`.trim());
      continue;
    }
    const ok = satisfies(have, r.range);
    if (ok === null) advice.push(`This project asks for ${need} (from ${r.source}); you have ${have}. Could not compare them, so check by hand.`);
    else if (!ok) advice.push(`This project needs ${need}; you have ${have}. ${INSTALL_HELP[r.tool] ?? ''}`.trim());
  }
  if (!versions.git) advice.push('Git is not installed, so Bunny cannot track changes in this project. Install it from git-scm.com, then reopen Bunny.');
  if (!versions.node && !reqs.some((r) => r.tool === 'node')) advice.push('Node is not installed; most web projects need it. Install the current Node LTS from nodejs.org, then reopen Bunny.');
  const out = [
    'Installed:', ...rows.map((r) => `- ${r}`), '',
    'Project requirements:', ...(reqs.length ? reqs.map((r) => `- ${r.source}: ${r.tool} ${r.range}`) : ['- none found']), '',
    'Advice:', ...(advice.length ? advice.map((a) => `- ${a}`) : ['- Everything the project asks for is installed. Nothing to change.']),
  ].join('\n');
  return out.length > CAP ? `${out.slice(0, CAP - 20)}\n[shortened]` : out;
}

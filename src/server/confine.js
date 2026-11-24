/**
 * F13 (v0.1.15): "Confine commands to the project folder", option A: the low-integrity helper (Tech Lead's spec, Security's F13-1 to F13-5; the owner: "Yes, add it").
 *
 * Windows only. A command is run by a small helper (confineHelper.js, compiled once into Bunny's data folder) with a Low integrity token and no privileges. Windows then refuses its WRITES to anything
 * that is not labelled Low: so the project folder gets a one-time Low label (icacls ... /setintegritylevel (OI)(CI)L), asked per folder. Reads and the network are NOT stopped, and the help says so.
 *
 *   F13-1  the label goes only on the workspace folder: never a drive root, the home folder, Desktop / Documents / Downloads, Windows or Program Files, or any folder that holds Bunny's data or key
 *          folders; the folder's current label is recorded first and "Remove the label" puts exactly that back (no label at all when there was none).
 *   F13-2  the compiled helper's sha256 is checked before EVERY use (a Medium process can write the data folder); a changed or missing helper is rebuilt, and until then the command is not run
 *          confined: the caller shows the "Couldn't confine this command" card, never a silent unconfined run.
 *   F13-3  a Low token only: all privileges removed, a new hidden console, and the environment is safeEnv plus the cache variables.
 *   F13-4  NOT_COVERED is the list the help text carries word for word.
 *   F13-5  caches live in <folder>/.bunny/tmp, git-ignored, and are removed with the label.
 */
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, realpath, lstat } from 'node:fs/promises';
import { join, parse, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { powershellPath, safeEnv } from './safeExec.js';
import { HELPER_SOURCE } from './confineHelper.js';

/** What confinement does NOT cover: this exact list is in the help (F13-4, F13B-5). */
export const NOT_COVERED = [
  'Reading files: a confined command can still read everything you can, Bunny\'s own data folder included. Files encrypted with your Windows account can be decrypted by any program running as you, so confinement limits writes, not the reading of secrets.',
  'The network: a confined command can still reach the internet.',
  'File tools: they are kept inside the project folder by their own checks, not by this.',
  'Connectors, the browser and computer use.',
  'Engines: Codex has its own sandbox, and Claude Code on Windows has none.',
];

export const CONFINE_VALUES = ['off', 'auto', 'always'];
export const LOW_SID = 'S-1-16-4096';
const exeFile = (name) => join(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows', 'System32', name);
const norm = (p) => resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase();
const inside = (child, parent) => child === parent || child.startsWith(`${parent}${sep}`);

/** Why the label may NOT go on this folder (F13-1), or null. `protect` are folders that must stay outside it (Bunny's data folder, key folders, an engine home). */
export function labelRefusal(root, { protect = [], allowInside = [], home = process.env.USERPROFILE || homedir() } = {}) {
  const r = norm(root);
  if (parse(resolve(String(root))).root.toLowerCase().replace(/[\\/]+$/, '') === r) return 'a whole drive';
  const h = norm(home);
  if (r === h) return 'your home folder';
  for (const name of ['Desktop', 'Documents', 'Downloads']) if (r === norm(join(home, name))) return `your ${name} folder`;
  const windir = norm(process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows');
  if (inside(r, windir)) return 'a Windows system folder';
  for (const pf of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData]) if (pf && inside(r, norm(pf))) return 'a program folder';
  for (const p of protect.filter(Boolean)) {
    if (inside(norm(p), r)) return "a folder that holds Bunny's own data or key folders";
    // and nothing INSIDE a protected folder either (the data folder keeps keys and chats), except where Bunny keeps a chat's own copy of a project: strictly inside <data>/worktrees
    if (inside(r, norm(p)) && !allowInside.some((a) => r !== norm(a) && inside(r, norm(a)))) return "a folder inside Bunny's own data or key folders";
  }
  // a folder above your home folder (Users, the drive's top) is just as wide as the home folder itself
  if (inside(h, r)) return 'a folder that holds your home folder';
  return null;
}

/** The mandatory label in `icacls <folder>` output: { level: 'Low' | 'Medium' | ... | null, flags: '(OI)(CI)(NW)' }. */
export function parseLabel(text) {
  const m = /Mandatory Label\\(\w+) Mandatory Level:((?:\([A-Z]+\))*)/.exec(String(text ?? ''));
  return m ? { level: m[1], flags: m[2] } : { level: null, flags: '' };
}

const run = (file, args, { timeout = 60_000, env } = {}) => new Promise((resolveRun) => {
  execFile(file, args, { timeout, windowsHide: true, shell: false, maxBuffer: 1 << 20, env: safeEnv({}, env ?? process.env) }, (err, stdout, stderr) => resolveRun({ ok: !err, code: err?.code ?? 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
});

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** @param {{ dataDir: string, windows?: boolean }} opts */
export function createConfiner({ dataDir, windows = process.platform === 'win32' } = {}) {
  const dir = join(dataDir, 'confine');
  const exe = join(dir, 'bunny-confine.exe');
  let expected = null; // the sha256 of the exe this server compiled
  let building = null;

  async function compile() {
    await mkdir(dir, { recursive: true });
    await rm(exe, { force: true });
    // the source goes in through the environment, never through a file another process could change before it is compiled
    const script = `Add-Type -TypeDefinition $env:BUNNY_CONFINE_SOURCE -OutputType ConsoleApplication -OutputAssembly '${exe.replace(/'/g, "''")}'`;
    const r = await run(powershellPath() ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 120_000, env: { ...process.env, BUNNY_CONFINE_SOURCE: HELPER_SOURCE } });
    if (!r.ok) throw new Error(`the helper could not be built: ${(r.stderr || r.stdout).slice(0, 200)}`);
    expected = sha256(await readFile(exe));
  }
  /** (Re)build the helper; one build at a time. */
  const rebuild = () => { building ??= compile().finally(() => { building = null; }); return building; };

  /** F13-2: is the helper on disk the one this server compiled? Checked before every command. */
  async function verify() {
    if (!windows) return { ok: false, why: 'Confinement is for Windows.' };
    if (!expected) return { ok: false, why: 'The helper has not been built yet.' };
    try { return sha256(await readFile(exe)) === expected ? { ok: true, path: exe } : { ok: false, why: 'The helper file changed.', changed: true }; } catch { return { ok: false, why: 'The helper file is missing.', changed: true }; }
  }
  /** The helper, ready to use: built on first use, checked every time. A bad one is rebuilt and the command it was for is NOT run confined (the caller asks). */
  async function use() {
    if (!windows) return { ok: false, why: 'Confinement is for Windows.' };
    if (!expected) { try { await rebuild(); } catch (err) { return { ok: false, why: err.message }; } }
    const v = await verify();
    if (v.ok) return v;
    rebuild().catch(() => {}); // rebuilt for the next command
    return v;
  }

  async function readLabel(root) {
    const r = await run(exeFile('icacls.exe'), [root]);
    return { ...parseLabel(r.stdout), raw: r.stdout };
  }
  /**
   * <root>/.bunny/tmp, made safely. A confined command may create folders and junctions anywhere in the project, so before Bunny (a Medium process) writes or deletes through .bunny or .bunny/tmp it
   * looks at each with lstat: a link, or anything that is not a plain folder, is removed (the link only, never what it points at) and made again, and the real path must still be inside the real project folder.
   * Returns the tmp folder, or null when that cannot be made sure of (nothing is then written or deleted).
   */
  async function scratch(root, { create = true } = {}) {
    const bunny = join(root, '.bunny'); const tmp = join(bunny, 'tmp');
    const plain = async (p) => {
      let st = null; try { st = await lstat(p); } catch { /* not there */ }
      if (!st) return create ? 'make' : 'absent';
      if (st.isSymbolicLink() || !st.isDirectory()) { // the link itself goes (never what it points at); if it will not, refuse
        await rm(p, { force: true, recursive: false }).catch(() => {});
        try { await lstat(p); return null; } catch { return create ? 'make' : 'absent'; }
      }
      return 'ok';
    };
    for (const p of [bunny, tmp]) {
      const state = await plain(p);
      if (state === null || state === 'absent') return null;
      if (state === 'make') await mkdir(p).catch(() => {});
    }
    try {
      const realRoot = norm(await realpath(root)); const realTmp = norm(await realpath(tmp));
      if (!inside(realTmp, realRoot) || realTmp === realRoot) return null;
    } catch { return null; }
    return tmp;
  }
  async function ignoreFile(root) {
    const tmp = await scratch(root);
    if (!tmp) return null;
    await writeFile(join(root, '.bunny', '.gitignore'), '*\n', 'utf8').catch(() => {}); // F13-5: Bunny's scratch is never committed
    return tmp;
  }

  /** Put the one-time Low label on the folder. Returns { ok, before } (the label it had), or { ok: false, why }. */
  async function label(root, { protect = [] } = {}) {
    if (!windows) return { ok: false, why: 'Confinement is for Windows.' };
    let real; try { real = await realpath(root); } catch { return { ok: false, why: 'That folder is not there.' }; }
    const refused = labelRefusal(real, { protect: [dataDir, ...protect], allowInside: [join(dataDir, 'worktrees')] });
    if (refused) return { ok: false, why: `Bunny will not label ${refused}.`, refused: true };
    const before = await readLabel(real);
    const set = await run(exeFile('icacls.exe'), [real, '/setintegritylevel', '(OI)(CI)L']);
    if (!set.ok) return { ok: false, why: `The label could not be set: ${(set.stderr || set.stdout).trim().slice(0, 200)}` };
    await ignoreFile(real);
    return { ok: true, folder: real, before: { level: before.level, flags: before.flags } };
  }

  /** "Remove the label": the recorded label goes back, exactly (none at all when there was none), and the caches go with it. */
  async function unlabel(root, before) {
    if (!windows) return { ok: false, why: 'Confinement is for Windows.' };
    let real; try { real = await realpath(root); } catch { return { ok: false, why: 'That folder is not there.' }; }
    const had = before && typeof before === 'object' ? before : { level: null, flags: '' };
    if (had.level && /^(Low|Medium|High)$/.test(had.level)) {
      const flags = /^(?:\([A-Z]+\))+$/.test(had.flags ?? '') ? had.flags.replace(/\(NW\)|\(NR\)|\(NX\)/g, '') : '(OI)(CI)';
      const set = await run(exeFile('icacls.exe'), [real, '/setintegritylevel', `${flags}${had.level[0]}`]);
      if (!set.ok) return { ok: false, why: `The label could not be put back: ${(set.stderr || set.stdout).trim().slice(0, 200)}` };
    } else {
      const v = await use();
      if (!v.ok) return { ok: false, why: `The helper that removes the label is not available: ${v.why}` };
      const r = await run(v.path, ['--unlabel', real]);
      if (!r.ok) return { ok: false, why: `The label could not be removed: ${(r.stderr || r.stdout).trim().slice(0, 200)}` };
    }
    const tmp = await scratch(real, { create: false }); // only a plain folder inside the project is ever deleted, never through a link
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
    return { ok: true };
  }

  /**
   * What to start instead of PowerShell: { file, args, env }. `script` is the whole PowerShell script (prelude and command), `extraEnv` the usual command environment (NON_INTERACTIVE).
   * Nothing the model wrote is ever part of a path or an option: it is only the base64 of the script (or a file in <folder>/.bunny/tmp for a long one).
   */
  async function wrap({ root, cwd, script, extraEnv = {} }) {
    const v = await use();
    if (!v.ok) return { ok: false, why: v.why };
    const tmp = await ignoreFile(root);
    if (!tmp) return { ok: false, why: 'The scratch folder inside the project could not be made safely.' };
    const ps = powershellPath() ?? 'powershell.exe';
    const encoded = Buffer.from(String(script), 'utf16le').toString('base64');
    let commandLine;
    if (encoded.length <= 24_000) commandLine = `"${ps}" -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
    else {
      const file = join(tmp, `cmd-${randomBytes(6).toString('hex')}.ps1`);
      await writeFile(file, `\ufeff${script}`, 'utf8');
      commandLine = `"${ps}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${file}"`;
    }
    const caches = { TEMP: tmp, TMP: tmp, npm_config_cache: join(tmp, 'npm'), PIP_CACHE_DIR: join(tmp, 'pip'), YARN_CACHE_FOLDER: join(tmp, 'yarn') };
    return { ok: true, file: v.path, args: [cwd, commandLine], env: safeEnv({ ...extraEnv, ...caches }) };
  }

  return { dir, exe, use, verify, rebuild, readLabel, label, unlabel, wrap, helperSha: () => expected };
}

/** The setting: 'off', 'auto' (confine while the chat is in Auto) or 'always'. Anything else is 'off'. */
export const confineMode = (settings) => (CONFINE_VALUES.includes(settings?.confineCommands) ? settings.confineCommands : 'off');
export const confineApplies = (settings, permissionMode) => { const m = confineMode(settings); return m === 'always' || (m === 'auto' && permissionMode === 'auto'); };

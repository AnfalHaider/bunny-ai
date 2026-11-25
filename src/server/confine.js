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
 *   F13-5  caches live in <data folder>/confine/tmp/<project hash> (not in the project: nothing for git to ignore, nothing a confined command can swap under Bunny), and are removed with the label.
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
  'Custom tools you made (each runs its own PowerShell script after you approve it), local connectors, other connectors, the browser and computer use.',
  'Engines: Codex has its own sandbox, and Claude Code on Windows has none.',
  'While the label is on, other low-rights programs on this PC can also write in this folder. Remove the label when you no longer need it.',
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
   * The scratch folder of one project: <data folder>/confine/tmp/<hash of the project path>. It holds the TEMP and package caches of confined commands, so it carries the Low label itself; it is NOT inside the
   * project, so a confined command can never swap a path that Bunny (a Medium process) later writes or deletes through (an automated review's finding: the first version kept it in <project>/.bunny/tmp, where a
   * junction planted by a still-running command could have redirected Bunny's write or its recursive delete). Every parent of it is Medium-only: Low cannot change them. Long scripts are written to <data>/confine/cmd,
   * also Medium-only (the Low child may read them; reads are not stopped).
   */
  const scratchPath = (root) => join(dir, 'tmp', sha256(Buffer.from(norm(root))).slice(0, 16));
  async function scratch(root) {
    const tmp = scratchPath(root);
    let st = null; try { st = await lstat(tmp); } catch { /* new */ }
    if (st && !st.isDirectory()) return null; // not a plain folder (nothing of Low's can be here: only Bunny makes this path)
    if (!st) {
      await mkdir(tmp, { recursive: true });
      const set = await run(exeFile('icacls.exe'), [tmp, '/setintegritylevel', '(OI)(CI)L']);
      if (!set.ok) { await rm(tmp, { recursive: true, force: true }).catch(() => {}); return null; }
    }
    return tmp;
  }
  async function purgeOldScripts() {
    const cmdDir = join(dir, 'cmd');
    await mkdir(cmdDir, { recursive: true });
    const { readdir, stat } = await import('node:fs/promises');
    for (const name of await readdir(cmdDir).catch(() => [])) { const f = join(cmdDir, name); if (Date.now() - (await stat(f).catch(() => ({ mtimeMs: Date.now() }))).mtimeMs > 86_400_000) await rm(f, { force: true }).catch(() => {}); }
    return cmdDir;
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
    await rm(scratchPath(real), { recursive: true, force: true }).catch(() => {}); // the project's scratch folder goes with its label (a junction inside it is unlinked, never followed)
    return { ok: true };
  }

  /**
   * What to start instead of PowerShell: { file, args, env }. `script` is the whole PowerShell script (prelude and command), `extraEnv` the usual command environment (NON_INTERACTIVE).
   * Nothing the model wrote is ever part of a path or an option: it is only the base64 of the script (or a file in <data>/confine/cmd for a long one).
   */
  async function wrap({ root, cwd, script, extraEnv = {} }) {
    const v = await use();
    if (!v.ok) return { ok: false, why: v.why };
    const tmp = await scratch(root);
    if (!tmp) return { ok: false, why: 'The scratch folder could not be made.' };
    const ps = powershellPath() ?? 'powershell.exe';
    const encoded = Buffer.from(String(script), 'utf16le').toString('base64');
    let commandLine;
    if (encoded.length <= 24_000) commandLine = `"${ps}" -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
    else {
      const file = join(await purgeOldScripts(), `cmd-${randomBytes(6).toString('hex')}.ps1`);
      await writeFile(file, `\ufeff${script}`, 'utf8');
      commandLine = `"${ps}" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${file}"`;
    }
    const caches = { TEMP: tmp, TMP: tmp, npm_config_cache: join(tmp, 'npm'), PIP_CACHE_DIR: join(tmp, 'pip'), YARN_CACHE_FOLDER: join(tmp, 'yarn') };
    return { ok: true, file: v.path, args: [cwd, commandLine], env: safeEnv({ ...extraEnv, ...caches }) };
  }

  return { dir, exe, use, verify, rebuild, readLabel, label, unlabel, wrap, scratchPath, helperSha: () => expected };
}

/** The setting: 'off', 'auto' (confine while the chat is in Auto) or 'always'. Anything else is 'off'. */
export const confineMode = (settings) => (CONFINE_VALUES.includes(settings?.confineCommands) ? settings.confineCommands : 'auto'); // not set: on in Auto (the label card still asks first); a person's saved choice is kept
export const confineApplies = (settings, permissionMode) => { const m = confineMode(settings); return m === 'always' || (m === 'auto' && permissionMode === 'auto'); };

/**
 * IA-12 (Security): downloaded code must never run before the person says yes. Every program Bunny starts during an install (npm, git, python, pip) is found as an ABSOLUTE path BEFORE anything is downloaded,
 * is started without a shell, with NoDefaultCurrentDirectoryInExePath=1, and from a working folder that is NOT inside the downloaded or unpacked files, so a git.cmd, npm.cmd or python.bat that a package or
 * repository ships can never be picked up.
 */
import { existsSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { findOnPath, gitPath } from './safeExec.js';

const windows = process.platform === 'win32';

/** Is `inner` the same as, or inside, `outer`? */
export const isInside = (inner, outer) => { const r = relative(resolve(outer), resolve(inner)); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };

/** The environment for an install child: nothing searched in the current folder. In the installed app process.execPath is Bunny's own Electron program, which only acts as node with ELECTRON_RUN_AS_NODE=1. */
export const installEnv = (extra = {}, { electron = Boolean(process.versions?.electron) } = {}) => ({ ...extra, NoDefaultCurrentDirectoryInExePath: '1', ...(electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) });

/** Refuse a program that lives inside `workDir` (the places downloads go). */
function outside(program, workDir, what) {
  if (!program || !isAbsolute(program)) throw new Error(`${what} could not be found, so Bunny will not install this.`);
  if (workDir && isInside(program, workDir)) throw new Error(`${what} is inside the install folder, which is refused.`);
  return program;
}

/** git as an absolute path found before any download, outside workDir. */
export function gitProgram(workDir) { return outside(gitPath(), workDir, 'git'); }

/** npm as [node.exe, npm-cli.js], both absolute: node is this program itself, and npm-cli.js is found next to it or next to the npm on PATH. */
export function npmProgram(workDir, { execPath = process.execPath, pathText = process.env.PATH ?? process.env.Path ?? '' } = {}) {
  const candidates = [join(dirname(execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')];
  const onPath = findOnPath(windows ? ['npm.cmd'] : ['npm'], pathText);
  if (onPath) {
    let real = onPath; try { real = realpathSync(onPath); } catch { /* keep */ }
    candidates.push(join(dirname(onPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(real), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), join(dirname(real), '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
  }
  const cli = candidates.map((c) => resolve(c)).find((c) => existsSync(c));
  if (!cli) throw new Error('Packages from npm need Node.js installed on this computer, and Bunny could not find it. Install Node.js (nodejs.org), then ask again.');
  outside(cli, workDir, 'npm'); outside(execPath, workDir, 'node');
  return [execPath, cli];
}

/** python as an absolute path found before any download, outside workDir. */
export function pythonProgram(workDir, { pathText = process.env.PATH ?? process.env.Path ?? '' } = {}) {
  const found = findOnPath(windows ? ['python.exe', 'python3.exe'] : ['python3', 'python'], pathText);
  if (!found) throw new Error('Packages from PyPI need Python installed on this computer, and Bunny could not find it. Install Python (python.org), then ask again.');
  return outside(found, workDir, 'python');
}

/** Run an absolute program with no shell. `cwd` must not be inside the downloaded files (the caller passes the work folder). */
export function execAbsolute(program, args, { cwd, env, timeout = 300_000, electron } = {}) {
  return new Promise((ok, bad) => {
    if (!isAbsolute(program)) { bad(new Error('A program must be started by its full path.')); return; }
    execFile(program, args, { cwd, env: installEnv(env, electron === undefined ? undefined : { electron }), windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, shell: false }, (err, out, errText) => (err ? bad(new Error(String(errText || err.message).slice(0, 400))) : ok(String(out))));
  });
}

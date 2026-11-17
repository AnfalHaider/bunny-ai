/**
 * W29-1 (Security): programs Bunny starts are found as ABSOLUTE paths, never by a bare name.
 *
 * On Windows a program started by bare name from a folder is looked up in that folder first, so a git.exe or powershell.exe planted in a project the person opens would run
 * the moment Bunny asked git a question there. Here a program is looked up once in the PATH folders only (absolute entries, never the current folder), system programs
 * come from the Windows folder, and every child gets NoDefaultCurrentDirectoryInExePath=1 as well, so even a program that searches by itself skips the current folder.
 */
import { statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

/** The first file called one of `names` in an absolute PATH folder, or null. */
export function findOnPath(names, pathText = process.env.PATH ?? process.env.Path ?? '') {
  for (const dir of String(pathText).split(delimiter)) {
    if (!dir || !isAbsolute(dir)) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      try { if (statSync(candidate).isFile()) return candidate; } catch { /* not here */ }
    }
  }
  return null;
}

const windows = process.platform === 'win32';
const cache = new Map();
const once = (key, find) => { if (!cache.has(key)) cache.set(key, find()); return cache.get(key); };
const systemRoot = () => process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows';

/** git as an absolute path (found once), or null. */
export const gitPath = () => once('git', () => findOnPath(windows ? ['git.exe'] : ['git']));
/** gh (the GitHub command line), or null. */
export const ghPath = () => once('gh', () => findOnPath(windows ? ['gh.exe'] : ['gh']));
/** Windows PowerShell by its full path (Windows folder), else null (other systems have none). */
export const powershellPath = () => (windows ? join(systemRoot(), 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : null);
/** taskkill by its full path. */
export const taskkillPath = () => (windows ? join(systemRoot(), 'System32', 'taskkill.exe') : null);

/** The environment for a child: the current one plus the switch that stops the current folder being searched for programs. */
export function safeEnv(extra = {}, base = process.env) {
  return { ...base, NoDefaultCurrentDirectoryInExePath: '1', ...extra };
}

/** Forget what was found (tests). */
export function resetSafeExecCache() { cache.clear(); }

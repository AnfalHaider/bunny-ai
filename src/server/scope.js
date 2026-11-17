/**
 * W6-16: a skill, a connector or a plugin can be limited to some folders. `folders` is a list of real folder paths; an empty or
 * missing list means everywhere (so data saved before this existed behaves as it did).
 */
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const MAX_SCOPE_FOLDERS = 20;

/** A tidy list of folder paths from whatever a page sent: strings only, no repeats, at most 20. */
export function cleanFolders(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const path = entry.trim().slice(0, 500);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= MAX_SCOPE_FOLDERS) break;
  }
  return out;
}

/** Is `chatFolder` one of the folders, or inside one? Compared as paths, never as text: D:\app does not contain D:\app2. */
export function inScope(folders, chatFolder) {
  if (!Array.isArray(folders) || !folders.length) return true; // everywhere
  if (!chatFolder) return false; // a chat with no folder gets only what is for everywhere
  const here = resolve(chatFolder);
  return folders.some((f) => {
    const rel = relative(resolve(f), here);
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
  });
}

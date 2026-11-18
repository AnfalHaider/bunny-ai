import { existsSync, writeFileSync } from 'node:fs';

/**
 * Security's LOW (web app): 0.1.9 and 0.1.10 registered a service worker inside Bunny's own window (and on old ports) that kept index.html.
 * On the first start of the version that replaces it, clear service workers and their caches ONCE, behind a flag file. Returns true when it ran.
 */
export async function clearOldWorkersOnce({ session, flagFile, fs = { existsSync, writeFileSync } }) {
  if (fs.existsSync(flagFile)) return false;
  try {
    await session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] });
    fs.writeFileSync(flagFile, new Date().toISOString());
    return true;
  } catch {
    return false; // not marked done, so the next start tries again
  }
}

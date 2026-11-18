import { existsSync, writeFileSync } from 'node:fs';

/**
 * Security's LOW (web app): 0.1.9 and 0.1.10 registered a service worker inside Bunny's own window (and on old ports) that kept index.html.
 * On the first start of the version that replaces it, clear service workers and their caches ONCE, behind a flag file. Returns true when it ran.
 */
export async function clearOldWorkersOnce({ session, flagFile, fs = { existsSync, writeFileSync }, timeoutMs = 3000 }) {
  if (fs.existsSync(flagFile)) return false;
  let timer;
  try {
    // A clear that never finishes must not hold anything up: after timeoutMs this gives up, and without the flag the next start tries again.
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); });
    await Promise.race([session.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }), timeout]);
    fs.writeFileSync(flagFile, new Date().toISOString());
    return true;
  } catch {
    return false; // not marked done, so the next start tries again
  } finally {
    clearTimeout(timer);
  }
}

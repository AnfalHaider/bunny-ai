/**
 * SEARCH-PC SP-6: what Bunny looked at, for the person to read in Settings. Each search ("Searched this PC · N results") and each read ("Read N files", with each file's
 * name and folder). Never file text, never the question (at most a 40-character label, and none in a private chat). Kept like the device action log: the last 500
 * entries or 30 days, read from the file before anything is written to it, so a restart never writes over what is saved.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const ACTIVITY_MAX_ENTRIES = 500;
export const ACTIVITY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const LABEL_CHARS = 40;

export function createPcActivity({ file = null, now = () => Date.now() } = {}) {
  let entries = [];
  let loading = null;
  // One writer at a time, and a burst of entries is ONE write of the latest state (it was one write per entry, queued: 530 writes that could land after a later write of the same file).
  let writing = null;
  let again = false;
  const prune = () => {
    const t = now();
    entries = entries.filter((e) => t - Date.parse(e.at) <= ACTIVITY_MAX_AGE_MS).slice(-ACTIVITY_MAX_ENTRIES);
  };
  const load = () => {
    loading ??= (async () => {
      if (!file) return;
      try { const saved = JSON.parse(await readFile(file, 'utf8')); if (Array.isArray(saved)) entries = saved.concat(entries); } catch { /* none yet */ }
      prune();
    })();
    return loading;
  };
  if (file) load().catch(() => {});

  const text = (v, n) => String(v ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);

  /** @param {{ who: string, kind: 'search', results: number, label?: string } | { who: string, kind: 'read', files: Array<{ name: string, folder: string }> }} entry */
  function log(entry) {
    const clean = { at: new Date(now()).toISOString(), who: text(entry.who, 60), kind: entry.kind === 'read' ? 'read' : 'search' };
    if (clean.kind === 'search') {
      clean.results = Math.max(0, Math.floor(Number(entry.results) || 0));
      if (entry.label) clean.label = text(entry.label, LABEL_CHARS);
    } else clean.files = (Array.isArray(entry.files) ? entry.files : []).slice(0, 3).map((f) => ({ name: text(f?.name, 200), folder: text(f?.folder, 260) }));
    entries.push(clean);
    prune();
    if (file) persist();
  }

  function persist() {
    if (writing) { again = true; return; }
    writing = (async () => {
      do {
        again = false;
        await load();
        prune();
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(entries));
      } while (again);
    })().catch(() => {}).finally(() => { writing = null; });
  }

  return { log, async list() { await load(); prune(); return [...entries].reverse(); }, async flush() { while (writing) await writing; } };
}

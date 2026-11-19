/**
 * Codex's unelevated Windows sandbox makes a capability SID for each CODEX_HOME the first time a command runs, and grants it access (CPU-bound: 3 to 4 minutes on the owner's PC, measured; the
 * second command and a second run in the same home take 1 to 2 seconds). Every chat has its own fresh CODEX_HOME, so every chat paid it, and each chat left another SID's grants on the project folder.
 *
 * The seed: the two files that hold that identity (`cap_sid` and `.sandbox_migration`, no credential, no chat data) are kept once under the engine's own folder and copied into each new chat home
 * before the run. A seeded fresh home ran its first command in 2 s (measured). Nothing else of a home is shared: config, state, logs and sign-in stay per chat (CE-3). The seed is made from the
 * first run's home after it ends, and goes with the engine when it is removed.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const SEED_FILES = Object.freeze(['cap_sid', '.sandbox_migration']);
export const seedDirOf = (dataDir) => join(dataDir, 'engines', 'codex', 'sandbox-seed');

const has = (p) => stat(p).then((s) => s.isFile(), () => false);

/** Copy the seed (when there is one) into a chat's CODEX_HOME. Returns true when it was copied. Never throws: no seed is just the slow first run. */
export async function seedHome({ dataDir, codexHome }) {
  const seed = seedDirOf(dataDir);
  try {
    if (!(await has(join(seed, 'cap_sid')))) return false;
    await mkdir(codexHome, { recursive: true });
    for (const f of SEED_FILES) if (await has(join(seed, f))) await copyFile(join(seed, f), join(codexHome, f));
    return true;
  } catch { return false; }
}

/** After a run: if there is no seed yet and the home made one, keep it. Returns true when a seed was kept. */
export async function keepSeed({ dataDir, codexHome }) {
  const seed = seedDirOf(dataDir);
  try {
    if (await has(join(seed, 'cap_sid'))) return false;
    if (!(await has(join(codexHome, 'cap_sid')))) return false;
    await mkdir(seed, { recursive: true });
    for (const f of SEED_FILES) if (await has(join(codexHome, f))) await copyFile(join(codexHome, f), join(seed, f));
    return true;
  } catch { return false; }
}

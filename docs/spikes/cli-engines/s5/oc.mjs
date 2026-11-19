// S5 helper (not Bunny code): run the pinned opencode.exe with a fake home. node oc.mjs <args...>
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const sp = dirname(fileURLToPath(import.meta.url));
const home = join(sp, 'home');
const env = {
  PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: join(sp, 'tmp'), TMP: join(sp, 'tmp'),
  USERPROFILE: home, HOME: home, APPDATA: join(home, 'AppData/Roaming'), LOCALAPPDATA: join(home, 'AppData/Local'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'), XDG_STATE_HOME: join(home, '.local/state'),
  OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', OPENCODE_DISABLE_LSP_DOWNLOAD: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_PURE: '1', OPENCODE_DISABLE_DEFAULT_PLUGINS: '1', OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
};
const r = spawnSync(join(sp, 'engine/opencode.exe'), process.argv.slice(2), { env, encoding: 'utf8', timeout: 30000, cwd: join(sp, 'proj') });
process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}\n[exit ${r.status} ${r.error?.message ?? ''}]\n`);

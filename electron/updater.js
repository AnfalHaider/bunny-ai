/**
 * Updates from GitHub Releases.
 *
 * A few seconds after start, and every few hours, the app asks GitHub for the latest
 * release. When it is newer than this copy, the installer is downloaded in the
 * background and checked against the SHA-512 the release publishes (latest.yml).
 * Nothing is installed behind the person's back: the window offers "Restart to
 * update", and an update that is ready is also installed when the app quits.
 *
 * BUNNY_UPDATE_FEED points the check somewhere else (tests use a local server that
 * answers like GitHub's API).
 */
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';

export const RELEASES_FEED = 'https://api.github.com/repos/AnfalHaider/bunny-ai/releases/latest';
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** -1, 0 or 1, comparing dotted versions (a leading v is ignored). */
export function compareVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/i, '').split(/[.-]/).map((p) => Number(p) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The installer and its published SHA-512, from a GitHub release. */
export async function readRelease(release, fetchImpl = globalThis.fetch) {
  const version = String(release?.tag_name ?? '').replace(/^v/i, '');
  const assets = release?.assets ?? [];
  const installer = assets.find((a) => /setup.*\.exe$/i.test(a.name));
  const manifest = assets.find((a) => a.name === 'latest.yml');
  if (!version || !installer) return null;
  let sha512 = null;
  if (manifest) {
    const yml = await (await fetchImpl(manifest.browser_download_url)).text();
    sha512 = /^sha512:\s*(\S+)/m.exec(yml)?.[1] ?? null;
  }
  return { version, notes: String(release.body ?? '').slice(0, 4000), url: installer.browser_download_url, size: installer.size, name: installer.name, sha512 };
}

export function createUpdater({ currentVersion, feed = process.env.BUNNY_UPDATE_FEED || RELEASES_FEED, enabled = () => true, onStatus = () => {}, fetchImpl = globalThis.fetch, downloadDir = join(tmpdir(), 'bunny-ai-update') }) {
  let status = { state: 'idle', current: currentVersion };
  let ready = null; // { path, version }
  let busy = null;
  let timer = null;
  const set = (patch) => { status = { ...status, ...patch, current: currentVersion }; onStatus(status); };

  async function download(release) {
    await mkdir(downloadDir, { recursive: true });
    const target = join(downloadDir, release.name);
    // Already downloaded and checked on an earlier run: use it.
    if (ready?.version === release.version) return ready.path;
    const res = await fetchImpl(release.url);
    if (!res.ok || !res.body) throw new Error(`GitHub answered ${res.status} for the installer`);
    const hash = createHash('sha512');
    const out = createWriteStream(target);
    let got = 0;
    let lastShown = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      const pct = release.size ? Math.floor((got / release.size) * 100) : 0;
      if (pct !== lastShown) { lastShown = pct; set({ state: 'downloading', progress: pct }); }
    }
    await new Promise((r, j) => out.end((err) => (err ? j(err) : r())));
    const digest = hash.digest('base64');
    if (release.sha512 && digest !== release.sha512) {
      await rm(target, { force: true });
      throw new Error('The downloaded installer did not match its published checksum, so it was thrown away.');
    }
    if (release.size && (await stat(target)).size !== release.size) {
      await rm(target, { force: true });
      throw new Error('The downloaded installer is incomplete.');
    }
    return target;
  }

  /** Ask GitHub, and download a newer version if there is one. */
  function check({ manual = false } = {}) {
    if (busy) return busy;
    busy = (async () => {
      if (!manual && !enabled()) return status;
      set({ state: 'checking', message: null });
      try {
        const res = await fetchImpl(feed, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Bunny-AI-updater' } });
        if (res.status === 404) { set({ state: 'none', latest: currentVersion, message: 'No releases are published yet.' }); return status; }
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const release = await readRelease(await res.json(), fetchImpl);
        if (!release || compareVersions(release.version, currentVersion) <= 0) {
          set({ state: 'none', latest: release?.version ?? currentVersion, message: `You have the latest version (${currentVersion}).` });
          return status;
        }
        set({ state: 'downloading', latest: release.version, notes: release.notes, progress: 0, message: null });
        const path = await download(release);
        ready = { path, version: release.version };
        set({ state: 'ready', latest: release.version, progress: 100, message: `Bunny AI ${release.version} is ready. Restart to update.` });
      } catch (err) {
        set({ state: 'error', message: `The update check failed: ${err.message}` });
      }
      return status;
    })().finally(() => { busy = null; });
    return busy;
  }

  /**
   * Run the downloaded installer silently. relaunch: start the new version when it is done
   * (Restart to update); without it, the update simply waits for the next start (on quit).
   */
  function install({ relaunch = true } = {}) {
    if (!ready) return false;
    const args = ['/S', '--updated', ...(relaunch ? ['--force-run'] : [])];
    const child = spawn(ready.path, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    ready = null;
    return true;
  }

  function start({ firstCheckMs = 15_000 } = {}) {
    setTimeout(() => check(), firstCheckMs).unref?.();
    timer = setInterval(() => check(), CHECK_EVERY_MS);
    timer.unref?.();
  }

  return { check, install, start, status: () => status, hasUpdate: () => Boolean(ready), stop: () => clearInterval(timer) };
}

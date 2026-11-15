import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdater, compareVersions, readRelease } from '../electron/updater.js';

/** A stand-in for GitHub: the latest release, its installer and its latest.yml. */
function fakeGithub({ version, installer = Buffer.from('pretend installer bytes'), sha512 }) {
  const digest = sha512 ?? createHash('sha512').update(installer).digest('base64');
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.endsWith('/releases/latest')) {
      return new Response(JSON.stringify({
        tag_name: `v${version}`, body: 'What changed',
        assets: [
          { name: `Bunny-AI-Setup-${version}.exe`, size: installer.length, browser_download_url: 'https://dl/setup.exe' },
          { name: 'latest.yml', size: 100, browser_download_url: 'https://dl/latest.yml' },
        ],
      }), { status: 200 });
    }
    if (url === 'https://dl/latest.yml') return new Response(`version: ${version}\npath: x.exe\nsha512: ${digest}\n`, { status: 200 });
    if (url === 'https://dl/setup.exe') return new Response(installer, { status: 200 });
    return new Response('', { status: 404 });
  };
  return { fetchImpl, asked, installer };
}

test('versions compare as numbers, with or without a v', () => {
  assert.equal(compareVersions('v0.1.10', '0.1.9'), 1);
  assert.equal(compareVersions('0.2.0', '0.2.0'), 0);
  assert.equal(compareVersions('0.1.0', 'v0.1.1'), -1);
});

test('a newer release is downloaded, checked against its fingerprint, and offered for a restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = fakeGithub({ version: '0.2.0' });
  const seen = [];
  const updater = createUpdater({ currentVersion: '0.1.0', feed: 'https://api/releases/latest', fetchImpl: gh.fetchImpl, downloadDir: dir, onStatus: (s) => seen.push(s.state) });
  const status = await updater.check();
  assert.equal(status.state, 'ready');
  assert.equal(status.latest, '0.2.0');
  assert.match(status.message, /0\.2\.0 is ready/);
  assert.ok(updater.hasUpdate());
  assert.deepEqual([...new Set(seen)], ['checking', 'downloading', 'ready']);
  assert.deepEqual(await readFile(join(dir, 'Bunny-AI-Setup-0.2.0.exe')), gh.installer);
});

test('an installer that does not match its fingerprint is thrown away', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = fakeGithub({ version: '0.2.0', sha512: 'not-the-real-hash' });
  const updater = createUpdater({ currentVersion: '0.1.0', feed: 'https://api/releases/latest', fetchImpl: gh.fetchImpl, downloadDir: dir });
  const status = await updater.check();
  assert.equal(status.state, 'error');
  assert.match(status.message, /did not match its published checksum/);
  assert.equal(updater.hasUpdate(), false);
});

test('the same or an older release downloads nothing; switched off, only a manual check runs', async () => {
  const gh = fakeGithub({ version: '0.1.0' });
  const same = createUpdater({ currentVersion: '0.1.0', feed: 'https://api/releases/latest', fetchImpl: gh.fetchImpl });
  assert.equal((await same.check()).state, 'none');
  assert.ok(!gh.asked.includes('https://dl/setup.exe'));
  const off = createUpdater({ currentVersion: '0.0.9', feed: 'https://api/releases/latest', fetchImpl: gh.fetchImpl, enabled: () => false, downloadDir: join(tmpdir(), 'bunny-update-off') });
  assert.equal((await off.check()).state, 'idle', 'automatic checks respect the switch');
  assert.equal((await off.check({ manual: true })).state, 'ready', 'Check for updates still works');
  await rm(join(tmpdir(), 'bunny-update-off'), { recursive: true, force: true });
});

test('a release without an installer is not offered', async () => {
  assert.equal(await readRelease({ tag_name: 'v1.0.0', assets: [{ name: 'notes.txt' }] }), null);
});

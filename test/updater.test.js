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
  const gh = fakeGithub({ version: '0.2.0', sha512: `${'A'.repeat(86)}==` });
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

// S-UPD (Security): no checksum, no install; and a release with a suffix is older than the plain one.
const noChecksum = (variant) => {
  const installer = Buffer.from('pretend installer bytes');
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(url);
    if (url.endsWith('/releases/latest')) {
      const assets = [{ name: 'Bunny-AI-Setup-0.2.0.exe', size: installer.length, browser_download_url: 'https://dl/setup.exe' }];
      if (variant !== 'no-file') assets.push({ name: 'latest.yml', size: 10, browser_download_url: 'https://dl/latest.yml' });
      return new Response(JSON.stringify({ tag_name: 'v0.2.0', body: '', assets }), { status: 200 });
    }
    if (url === 'https://dl/latest.yml') return new Response(variant === 'no-sha' ? 'version: 0.2.0\npath: x.exe\n' : 'version: 0.2.0\nsha512:\n', { status: 200 });
    if (url === 'https://dl/setup.exe') return new Response(installer, { status: 200 });
    return new Response('', { status: 404 });
  };
  return { fetchImpl, asked };
};

for (const variant of ['no-file', 'no-sha', 'empty-sha']) {
  test(`S-UPD: a release with ${variant === 'no-file' ? 'no latest.yml' : variant === 'no-sha' ? 'a latest.yml without sha512' : 'an empty sha512'} is not downloaded or installed`, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'bunny-update-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const gh = noChecksum(variant);
    const updater = createUpdater({ currentVersion: '0.1.0', feed: 'https://api/releases/latest', fetchImpl: gh.fetchImpl, downloadDir: dir });
    const status = await updater.check();
    assert.equal(status.state, 'error');
    assert.match(status.message, /no published checksum/);
    assert.ok(!gh.asked.includes('https://dl/setup.exe'), 'the installer was never fetched');
    assert.equal(updater.hasUpdate(), false);
    assert.equal(await updater.install(), false, 'nothing to install');
  });
}

test('S-UPD: pre-release suffixes are compared like semver', () => {
  const order = ['0.1.9-alpha', '0.1.9-alpha.1', '0.1.9-alpha.beta', '0.1.9-beta', '0.1.9-beta.2', '0.1.9-beta.11', '0.1.9-rc.1', '0.1.9', '0.1.10-rc.1', '0.1.10'];
  for (let i = 0; i < order.length - 1; i += 1) {
    assert.equal(compareVersions(order[i], order[i + 1]), -1, `${order[i]} < ${order[i + 1]}`);
    assert.equal(compareVersions(order[i + 1], order[i]), 1, `${order[i + 1]} > ${order[i]}`);
  }
  assert.equal(compareVersions('v0.1.9-rc.1', '0.1.9-rc.1'), 0);
  assert.equal(compareVersions('0.1.9+build5', '0.1.9'), 0, 'build metadata is ignored');
  assert.equal(compareVersions('0.1.9', '0.1.9-rc.1'), 1);
});

test('S-UPD: a release candidate is not offered to a copy that is already on the plain version', async () => {
  const gh = fakeGithub({ version: '0.1.9-rc.1' });
  const updater = createUpdater({ currentVersion: '0.1.9', feed: 'https://api/releases/latest', fetchImpl: gh.fetchImpl });
  assert.equal((await updater.check()).state, 'none');
  assert.ok(!gh.asked.includes('https://dl/setup.exe'));
});

// SUPD-1 and SUPD-2 (Security, LOW)
test('SUPD-1: an empty "sha512:" line does not take the next key as the checksum, and a value that is not a SHA-512 digest is refused', async () => {
  const release = { tag_name: 'v0.2.0', assets: [{ name: 'Bunny-AI-Setup-0.2.0.exe', size: 1, browser_download_url: 'https://dl/setup.exe' }, { name: 'latest.yml', browser_download_url: 'https://dl/latest.yml' }] };
  const yml = (text) => async () => new Response(text, { status: 200 });
  assert.equal((await readRelease(release, yml('version: 0.2.0\nsha512:\nsize: 123\n'))).sha512, null, 'next line is not the value');
  assert.equal((await readRelease(release, yml('sha512: size:\n'))).sha512, null);
  assert.equal((await readRelease(release, yml('sha512: abc\n'))).sha512, null, 'too short to be a digest');
  assert.equal((await readRelease(release, yml(`sha512: ${'A'.repeat(86)}== extra\n`))).sha512, null, 'nothing after the value');
  const good = `${'B'.repeat(86)}==`;
  assert.equal((await readRelease(release, yml(`version: 0.2.0\nsha512: ${good}\n`))).sha512, good);
  assert.equal((await readRelease(release, yml(`sha512:\t${good}  \n`))).sha512, good, 'spaces and tabs on the same line are fine');
});

test('SUPD-2: the installer is saved by its file name only, whatever path the asset name carries', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const installer = Buffer.from('pretend installer bytes');
  const digest = createHash('sha512').update(installer).digest('base64');
  const fetchImpl = async (url) => {
    if (url.endsWith('/releases/latest')) {
      return new Response(JSON.stringify({ tag_name: 'v0.2.0', assets: [
        { name: '../../escape-Setup.exe', size: installer.length, browser_download_url: 'https://dl/setup.exe' },
        { name: 'latest.yml', browser_download_url: 'https://dl/latest.yml' }] }), { status: 200 });
    }
    if (url === 'https://dl/latest.yml') return new Response(`sha512: ${digest}\n`, { status: 200 });
    if (url === 'https://dl/setup.exe') return new Response(installer, { status: 200 });
    return new Response('', { status: 404 });
  };
  const updater = createUpdater({ currentVersion: '0.1.0', feed: 'https://api/releases/latest', fetchImpl, downloadDir: join(dir, 'updates') });
  assert.equal((await updater.check()).state, 'ready');
  assert.deepEqual(await readFile(join(dir, 'updates', 'escape-Setup.exe')), installer);
  await assert.rejects(readFile(join(dir, 'escape-Setup.exe')), 'nothing was written above the update folder');
});

test('v0.1.10 (QA 4c-7): a quoted sha512 value is accepted, a hex one is not', async () => {
  const release = { tag_name: 'v0.2.0', assets: [{ name: 'Bunny-AI-Setup-0.2.0.exe', size: 1, browser_download_url: 'https://dl/setup.exe' }, { name: 'latest.yml', browser_download_url: 'https://dl/latest.yml' }] };
  const yml = (text) => async () => new Response(text, { status: 200 });
  const good = `${'C'.repeat(86)}==`;
  assert.equal((await readRelease(release, yml(`sha512: "${good}"\n`))).sha512, good, 'double quotes');
  assert.equal((await readRelease(release, yml(`sha512: '${good}'\n`))).sha512, good, 'single quotes');
  assert.equal((await readRelease(release, yml(`sha512: "${good}\n`))).sha512, null, 'an unclosed quote is not a value');
  assert.equal((await readRelease(release, yml(`sha512: ${'a1'.repeat(64)}\n`))).sha512, null, 'hex is not base64');
});

test('v0.1.10 (QA 4c-14): the release notes are kept whole, beyond the old 4,000-character cut', async () => {
  const body = 'N'.repeat(4107) + '\nend of notes';
  const release = { tag_name: 'v0.2.0', body, assets: [{ name: 'Bunny-AI-Setup-0.2.0.exe', size: 1, browser_download_url: 'https://dl/setup.exe' }] };
  const got = await readRelease(release, async () => new Response('', { status: 200 }));
  assert.equal(got.notes, body);
});

test('S-7 (v0.1.10): an installer swapped after the check is thrown away at install time, never run', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-update-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gh = fakeGithub({ version: '0.2.0' });
  const updater = createUpdater({ currentVersion: '0.1.0', feed: 'https://api/releases/latest', fetchImpl: gh.fetchImpl, downloadDir: dir });
  assert.equal((await updater.check()).state, 'ready');
  const { writeFile, readdir } = await import('node:fs/promises');
  const [name] = await readdir(dir);
  await writeFile(join(dir, name), 'not the installer that was checked');
  assert.equal(await updater.install(), false, 'nothing was started');
  assert.equal(updater.hasUpdate(), false);
  assert.deepEqual(await readdir(dir), [], 'the swapped file was removed');
  assert.match(updater.status().message, /changed after it was checked/);
});

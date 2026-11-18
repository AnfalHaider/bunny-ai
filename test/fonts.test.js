import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { startApp } from './helpers.js';

// v0.1.13 FONTS: 13 bundled fonts (SIL OFL 1.1, unmodified Latin woff2) with a manifest and the licence texts.
const ROOT = new URL('../src/ui/fonts/', import.meta.url);
const PASS = 'correct horse battery staple';
const manifest = JSON.parse(await readFile(new URL('manifest.json', ROOT), 'utf8'));

function lan(url, { path = '/', method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test('the manifest lists 13 fonts; every file is a real woff2 on disk with its version, source and a licence text that is the OFL', async () => {
  assert.equal(manifest.fonts.length, 13);
  let total = 0;
  for (const f of manifest.fonts) {
    assert.match(f.licence, /Open Font License/);
    assert.ok(f.files.length >= 1 && f.files.every((x) => /^v\d+$/.test(x.version) && x.source.startsWith('https://fonts.gstatic.com/')), f.name);
    for (const x of f.files) {
      const bytes = await readFile(new URL(x.file, ROOT));
      assert.equal(bytes.subarray(0, 4).toString(), 'wOF2', x.file);
      assert.equal(bytes.length, x.bytes, `${x.file} is exactly the file that was fetched`);
      total += bytes.length;
    }
    const text = await readFile(new URL(f.licenceFile, ROOT), 'utf8');
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1/, f.name);
  }
  assert.equal(total, manifest.totalBytes);
  assert.ok(total < 520_000, `about half a megabyte in all (${total})`);
  const onDisk = (await readdir(ROOT)).filter((n) => n.endsWith('.woff2'));
  assert.equal(onDisk.length, manifest.fonts.reduce((n, f) => n + f.files.length, 0), 'no file without a manifest entry');
});

test('the style sheet names every font file, and every dropdown choice has a font stack (the names start with "Bunny ")', async () => {
  const css = await readFile(new URL('../app.css', ROOT), 'utf8');
  const api = await readFile(new URL('../api.js', ROOT), 'utf8');
  const settings = await readFile(new URL('../settings.html', ROOT), 'utf8');
  for (const f of manifest.fonts) {
    for (const x of f.files) assert.ok(css.includes(`fonts/${x.file}`), x.file);
    assert.ok(css.includes(`font-family: "Bunny ${f.name}"`), f.name);
    assert.ok(api.includes(`'${f.id}': '"Bunny ${f.name}"`), `FONTS has ${f.id}`);
    assert.equal(settings.split(`value="${f.id}"`).length - 1, 2, `${f.id} is in both dropdowns`);
  }
  for (const keep of ['system', 'match', 'sans', 'serif', 'mono']) assert.ok(settings.includes(`value="${keep}"`), keep);
  assert.ok(settings.indexOf('value="match"') < settings.indexOf('<optgroup', settings.indexOf('value="match"')), '"Match interface" stays first');
});

test('the window serves the fonts and licence texts with the right types', async (t) => {
  const { base } = await startApp(t);
  const f = manifest.fonts[0];
  const res = await fetch(`${base}/src/ui/fonts/${f.files[0].file}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'font/woff2');
  assert.equal((await res.arrayBuffer()).byteLength, f.files[0].bytes);
  const lic = await fetch(`${base}/src/ui/fonts/${f.licenceFile}`);
  assert.equal(lic.status, 200);
  assert.match(lic.headers.get('content-type'), /^text\/plain/);
});

test('a signed-in Chats device gets every font file and licence text; a device not signed in gets none', async (t) => {
  const started = await startApp(t, { lanAddress: '127.0.0.1' });
  const on = await (await fetch(`${started.base}/api/remote`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) })).json();
  assert.ok(on.url);
  t.after(() => started.app.remote.disable());
  const url = on.url.replace(/\/$/, '');
  const host = new URL(url).host;
  const first = manifest.fonts[0].files[0].file;
  const before = await lan(url, { path: `/src/ui/fonts/${first}`, headers: { host } });
  assert.equal(before.status, 302, 'not signed in: sent to the sign-in page');
  const signed = await lan(url, { method: 'POST', path: '/api/remote/signin', headers: { host, origin: `http://${host}` }, body: { passcode: PASS } });
  assert.equal(signed.status, 200);
  const cookie = String(signed.headers['set-cookie']?.[0] ?? '').split(';')[0];
  for (const f of manifest.fonts) {
    for (const x of f.files) {
      const r = await lan(url, { path: `/src/ui/fonts/${x.file}`, headers: { host, cookie } });
      assert.equal(r.status, 200, x.file);
      assert.equal(r.headers['content-type'], 'font/woff2');
      assert.equal(r.bytes.length, x.bytes);
    }
    const lic = await lan(url, { path: `/src/ui/fonts/${f.licenceFile}`, headers: { host, cookie } });
    assert.equal(lic.status, 200, f.licenceFile);
  }
  assert.equal((await lan(url, { path: '/src/ui/fonts/manifest.json', headers: { host, cookie } })).status, 200);
});

test('the web app keeps the font files in its static cache (the service worker rule matches /src/ui/fonts/*.woff2)', async () => {
  const sw = await readFile(new URL('../bunny-sw.js', ROOT), 'utf8');
  const m = /return (\/\^[^;]+?\$\/)\.test\(url\.pathname\)/.exec(sw);
  assert.ok(m, 'the static-file rule is found');
  const re = new RegExp(m[1].slice(1, -1));
  for (const f of manifest.fonts) for (const x of f.files) assert.ok(re.test(`/src/ui/fonts/${x.file}`), x.file);
  assert.ok(!re.test('/src/ui/fonts/licenses/inter-OFL.txt'));
});

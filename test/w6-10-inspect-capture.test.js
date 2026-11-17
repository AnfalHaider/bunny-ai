/**
 * W6-10: browser_inspect (looks at a page: html, css, network, fonts) and browser_capture (saves a copy of a page into the chat's folder).
 * The page script runs here against a fake page object; the capture runs against a real local web server and a real folder.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pageScript } from '../electron/browserAgent.js';
import { browserToolDefinitions, BROWSER_TOOL_RISK, inspectedText, describeBrowserTool } from '../src/server/browserTools.js';
import { capturePage, captureFolderName, isLocalHost } from '../src/server/capture.js';
import { fetchLimited } from '../src/server/download.js';
import { createWorkspace } from '../src/server/workspace.js';

// ---------------------------------------------------------------- the page script, on a fake page
function withPage(fake, fn) {
  const saved = {};
  for (const key of Object.keys(fake)) { saved[key] = globalThis[key]; globalThis[key] = fake[key]; }
  try { return fn(); } finally { for (const key of Object.keys(fake)) { if (saved[key] === undefined) delete globalThis[key]; else globalThis[key] = saved[key]; } }
}
const fakePage = (over = {}) => ({
  document: {
    documentElement: { outerHTML: '<html><body>hi</body></html>' },
    title: 'A page',
    querySelector: (sel) => (sel === '.hero' ? { tagName: 'DIV' } : sel === 'throws' ? (() => { throw new Error('bad'); })() : null),
    querySelectorAll: () => [],
    fonts: { forEach: (fn) => { fn({ status: 'loaded', family: '"Inter"', weight: '400', style: 'normal' }); fn({ status: 'unloaded', family: 'Ghost', weight: '400', style: 'normal' }); } },
    ...(over.document ?? {}),
  },
  getComputedStyle: () => ({ getPropertyValue: (name) => ({ display: 'flex', color: 'rgb(1, 2, 3)', 'font-size': '16px', position: 'static', 'margin-top': '0px', width: 'auto' }[name] ?? '') }),
  performance: { getEntriesByType: () => over.entries ?? [{ name: 'https://x.test/a.css', initiatorType: 'link', transferSize: 1200, duration: 12.4 }] },
  location: { href: 'https://x.test/page' },
  ...(over.globals ?? {}),
});

test('W6-10: inspect html returns the page as it is now, cut at 200 KB with a note', () => {
  const small = withPage(fakePage(), () => pageScript('inspect', { what: 'html' }));
  assert.equal(small.text, '<html><body>hi</body></html>');
  const big = withPage(fakePage({ document: { documentElement: { outerHTML: 'x'.repeat(250_000) } } }), () => pageScript('inspect', { what: 'html' }));
  assert.ok(big.text.length < 200_100);
  assert.match(big.text, /\[cut: 50000 more characters\]$/);
});

test('W6-10: inspect css gives the computed style of the element, only values that are not the default, at most 60', () => {
  const got = withPage(fakePage(), () => pageScript('inspect', { what: 'css', selector: '.hero' }));
  assert.equal(got.tag, 'div');
  assert.deepEqual(got.props, [['display', 'flex'], ['color', 'rgb(1, 2, 3)'], ['font-size', '16px']], 'the defaults (static, 0px, auto) are left out');
  assert.match(inspectedText(got), /Computed style of \.hero \(<div>\)/);
  assert.match(withPage(fakePage(), () => pageScript('inspect', { what: 'css', selector: '.none' })).error, /No element matches/);
  assert.match(withPage(fakePage(), () => pageScript('inspect', { what: 'css', selector: 'throws' })).error, /not a valid selector/);
  assert.match(withPage(fakePage(), () => pageScript('inspect', { what: 'css' })).error, /needs a selector/);
  const many = withPage({ ...fakePage(), getComputedStyle: () => ({ getPropertyValue: (name) => `v-${name}` }) }, () => pageScript('inspect', { what: 'css', selector: '.hero' }));
  assert.ok(many.props.length > 50 && many.props.length <= 60, 'capped at 60 (the list of properties it looks at holds 59)');
});

test('W6-10: inspect network lists the files the page loaded, at most 300, and fonts lists the ones in use', () => {
  const net = withPage(fakePage(), () => pageScript('inspect', { what: 'network' }));
  assert.deepEqual(net.entries, [{ url: 'https://x.test/a.css', type: 'link', size: 1200, ms: 12 }]);
  const entries = Array.from({ length: 400 }, (_, i) => ({ name: `https://x.test/f${i}.js`, initiatorType: 'script', transferSize: 1, duration: 1 }));
  const many = withPage(fakePage({ entries }), () => pageScript('inspect', { what: 'network' }));
  assert.equal(many.entries.length, 300);
  assert.equal(many.total, 400);
  assert.match(inspectedText(many), /^400 requests \(the first 300 are listed\):/);
  const fonts = withPage(fakePage(), () => pageScript('inspect', { what: 'fonts' }));
  assert.deepEqual(fonts.fonts, [{ family: 'Inter', weight: '400', style: 'normal' }]);
  assert.match(withPage(fakePage(), () => pageScript('inspect', { what: 'script' })).error, /html, css, network or fonts/);
});

test('W6-10: capture asks the page for its html and the addresses it names (http and https only, at most 300, no repeats)', () => {
  const els = (list) => list.map(([raw, url]) => ({ getAttribute: () => raw, src: url, href: url, currentSrc: url }));
  const doc = {
    querySelectorAll: (sel) => (sel === 'img[src]' ? els([['a.png', 'https://x.test/a.png'], ['a.png', 'https://x.test/a.png'], ['data.gif', 'data:image/gif;base64,AA'], ['b.png', 'file:///C:/b.png']])
      : sel === 'link[rel~=stylesheet][href]' ? els([['s.css', 'https://x.test/s.css']]) : sel === 'script[src]' ? els([['m.js', 'https://x.test/m.js']]) : []),
  };
  const got = withPage(fakePage({ document: doc }), () => pageScript('capture', {}));
  assert.equal(got.url, 'https://x.test/page');
  assert.deepEqual(got.resources.map((r) => [r.kind, r.url]), [['image', 'https://x.test/a.png'], ['style', 'https://x.test/s.css'], ['script', 'https://x.test/m.js']]);
  assert.equal(got.truncated, false);
});

// ---------------------------------------------------------------- the tools and their risks
test('W6-10: browser_inspect only looks (read); browser_capture writes files (edit): Plan mode has neither the write nor the offer', () => {
  assert.equal(BROWSER_TOOL_RISK.browser_inspect, 'read');
  assert.equal(BROWSER_TOOL_RISK.browser_capture, 'edit');
  const plan = browserToolDefinitions(['read']).map((d) => d.function.name);
  assert.ok(plan.includes('browser_inspect'));
  assert.ok(!plan.includes('browser_capture'), 'Plan mode refuses capture');
  assert.ok(browserToolDefinitions(['read', 'edit']).some((d) => d.function.name === 'browser_capture'));
  assert.ok(!browserToolDefinitions(['read', 'edit']).some((d) => /eval|script|run/i.test(d.function.name)), 'no script-running tool');
  assert.equal(describeBrowserTool('browser_inspect', { what: 'css', selector: '.hero' }), 'Inspect the page (css .hero)');
  assert.equal(describeBrowserTool('browser_capture'), 'Save a copy of the page');
});

// ---------------------------------------------------------------- capture: a real local site, a real folder
async function site(t) {
  const hits = [];
  const FONT = Buffer.from('FONTBYTES');
  const PNG = Buffer.from('PNGBYTES');
  const server = createServer((req, res) => {
    hits.push(req.url);
    const send = (type, body) => { res.writeHead(200, { 'content-type': type }); res.end(body); };
    if (req.url === '/css/site.css') return send('text/css', '@font-face { font-family: Z; src: url(../fonts/z.woff2); }\nbody { background: url("/img/bg.png") }\n.x { background: url(data:image/gif;base64,AA) }');
    if (req.url === '/fonts/z.woff2') return send('font/woff2', FONT);
    if (req.url === '/img/bg.png' || req.url === '/img/logo.png') return send('image/png', PNG);
    if (req.url === '/js/app.js') return send('text/javascript', 'console.log("hi")');
    if (req.url === '/secret') return send('text/plain', 'SECRET');
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections?.(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const info = {
    url: `${base}/index.html`, title: 'Test site',
    html: '<!doctype html><html><head><link rel="stylesheet" href="css/site.css"><style>.h { background: url(/img/logo.png) }</style></head><body><img src="/img/logo.png"><script src="js/app.js"></script></body></html>',
    resources: [
      { raw: 'css/site.css', url: `${base}/css/site.css`, kind: 'style' },
      { raw: '/img/logo.png', url: `${base}/img/logo.png`, kind: 'image' },
      { raw: 'js/app.js', url: `${base}/js/app.js`, kind: 'script' },
    ],
  };
  return { base, info, hits, FONT, PNG, server };
}
const folderOf = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-w610-'));
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  return dir;
};

test('W6-10: capture of a local site saves index.html and every file it names, with the links changed so it opens offline', async (t) => {
  const s = await site(t);
  const dir = await folderOf(t);
  const checkpointed = [];
  const workspace = createWorkspace(dir, { beforeWrite: async (abs) => { checkpointed.push(abs); } });
  const done = await capturePage({ info: s.info, workspace, fetchLimited, now: new Date(2026, 10, 17, 14, 5) });
  assert.match(done.folder, /^captures\/127\.0\.0\.1-\d+-20261117-1405$/);
  const root = join(dir, done.folder);
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const css = (await readdir(join(root, 'assets'))).filter((f) => f.endsWith('site.css'))[0];
  const cssText = await readFile(join(root, 'assets', css), 'utf8');
  // the server is gone: what is saved must open without it
  await new Promise((r) => s.server.close(r));
  for (const text of [html.split('\n').slice(1).join('\n'), cssText]) assert.doesNotMatch(text, /127\.0\.0\.1|https?:\/\//, 'no address of the site is left (apart from the note on the first line), so it opens offline');
  assert.match(html, /<link rel="stylesheet" href="assets\/\d+-site\.css">/);
  assert.match(html, /<img src="assets\/\d+-logo\.png">/);
  assert.match(html, /<script src="assets\/\d+-app\.js">/);
  assert.match(html, /<style>\.h \{ background: url\(assets\/\d+-logo\.png\) \}<\/style>/, 'a style block in the page is rewritten too');
  assert.match(cssText, /url\(\d+-z\.woff2\)/, 'the font the CSS names is saved next to it');
  assert.match(cssText, /url\("\d+-bg\.png"\)/);
  assert.match(cssText, /url\(data:image\/gif;base64,AA\)/, 'inline data is left alone');
  // every relative link points at a file that exists
  for (const m of html.matchAll(/(?:src|href)="(assets\/[^"]+)"/g)) assert.ok(existsSync(join(root, m[1])), m[1]);
  for (const m of cssText.matchAll(/url\("?(\d+-[^")]+)"?\)/g)) assert.ok(existsSync(join(root, 'assets', m[1])), m[1]);
  assert.equal((await readFile(join(root, 'assets', (await readdir(join(root, 'assets'))).find((f) => f.endsWith('z.woff2'))))).toString(), 'FONTBYTES', 'bytes are kept as they were');
  assert.ok(checkpointed.length >= 5, 'every file went through the workspace write (checkpoints)');
  assert.match(done.text, /Saved a copy of .* \(\d+ files, \d+ KB\)/);
  assert.equal(done.skipped.length, 0);
});

test('W6-10: a public page that names a private address is refused for that file; a page on this PC may name files on this PC', async (t) => {
  const s = await site(t);
  const dir = await folderOf(t);
  const workspace = createWorkspace(dir);
  const info = { url: 'https://example.com/index.html', html: `<img src="${s.base}/secret">`, resources: [{ raw: `${s.base}/secret`, url: `${s.base}/secret`, kind: 'image' }] };
  const done = await capturePage({ info, workspace, fetchLimited });
  assert.equal(done.skipped.length, 1);
  assert.match(done.skipped[0].why, /private network|this computer/);
  assert.ok(!s.hits.includes('/secret'), 'the private address was never asked');
  const saved = await readdir(join(dir, done.folder));
  assert.deepEqual(saved, ['index.html'], 'nothing else was written');
  assert.match(await readFile(join(dir, done.folder, 'index.html'), 'utf8'), new RegExp(s.base.replace(/[.]/g, '\\.')), 'the link is left as it was');
  assert.match(done.text, /Not saved \(1\)/);
  assert.equal(isLocalHost('127.0.0.1'), true);
  assert.equal(isLocalHost('192.168.1.5'), true);
  assert.equal(isLocalHost('example.com'), false);
  assert.equal(isLocalHost('8.8.8.8'), false);
});

test('W6-10: at most the given number of files and bytes are saved, the rest is listed as not saved', async (t) => {
  const s = await site(t);
  const dir = await folderOf(t);
  const workspace = createWorkspace(dir);
  const few = await capturePage({ info: s.info, workspace, fetchLimited, maxFiles: 2 });
  assert.ok(few.skipped.some((x) => /more than 2 files/.test(x.why)));
  const dir2 = await folderOf(t);
  const small = await capturePage({ info: s.info, workspace: createWorkspace(dir2), fetchLimited, maxBytes: 100 });
  assert.ok(small.skipped.some((x) => /MB in all/.test(x.why) || /MB/.test(x.why)), 'a byte limit is applied');
});

test('W6-10: with no folder for the chat nothing is saved ("Choose a folder for this chat first.")', async () => {
  await assert.rejects(capturePage({ info: { url: 'https://example.com/', html: '', resources: [] }, workspace: null, fetchLimited }), /Choose a folder for this chat first\./);
  await assert.rejects(capturePage({ info: { url: 'file:///C:/x.html', html: '', resources: [] }, workspace: {}, fetchLimited }), /Only http and https pages can be saved/);
  assert.match(captureFolderName('https://Example.COM:8080/a', new Date(2026, 0, 2, 3, 4)), /^captures\/example\.com-8080-20260102-0304$/i);
});

test('W6-10: the files go through the workspace: nothing is written outside the chat folder, nothing into .git, and a refused path writes nothing at all', async (t) => {
  const dir = await folderOf(t);
  const workspace = createWorkspace(dir);
  await mkdir(join(dir, '.git'), { recursive: true });
  await assert.rejects(workspace.writeFiles([{ path: 'captures/a/index.html', bytes: Buffer.from('x') }, { path: '../outside.txt', bytes: Buffer.from('x') }]), /outside|inside/i);
  assert.equal(existsSync(join(dir, 'captures')), false, 'a refused path means nothing was written');
  await assert.rejects(workspace.writeFiles([{ path: '.git/hooks/pre-commit', bytes: Buffer.from('x') }]), /inside \.git/);
  assert.equal(await workspace.writeFiles([{ path: 'captures/a/index.html', bytes: Buffer.from('ok') }]), 1);
  assert.equal(await readFile(join(dir, 'captures', 'a', 'index.html'), 'utf8'), 'ok');
  assert.equal(workspace.has('writeFiles'), false, 'not a tool the model can call');
});

// ---------------------------------------------------------------- Security's findings on W6-10 (W610-1, W610-2 and the automated notes)
import { registerOwnPort, ownPorts, isOwnServer } from '../src/server/ownAddress.js';
import { authorizeWrites } from '../src/server/capture.js';

async function bunnyStandIn(t) {
  const hits = [];
  const server = createServer((req, res) => { hits.push(req.url); res.writeHead(200, { 'content-type': 'text/html' }); res.end('<script>window.token = "bunny-token-SECRET"</script>'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = String(server.address().port);
  registerOwnPort(port);
  t.after(() => { ownPorts.delete(port); server.closeAllConnections?.(); server.close(); });
  return { port, hits, base: `http://127.0.0.1:${port}` };
}

test('W610-1: Bunny\'s own server is never fetched, whatever allowLoopback says, in any spelling, after a redirect, or by a name that points at it', async (t) => {
  const own = await bunnyStandIn(t);
  assert.equal(isOwnServer(`${own.base}/`), true);
  for (const url of [`${own.base}/`, `http://localhost:${own.port}/`, `http://[::1]:${own.port}/`, `http://127.1.2.3:${own.port}/`, `http://[::ffff:127.0.0.1]:${own.port}/`, `http://0.0.0.0:${own.port}/`]) {
    await assert.rejects(fetchLimited(url, { allowLoopback: true }), /will not fetch its own server/, url);
    await assert.rejects(fetchLimited(url, { allowLoopback: () => true }), /will not fetch its own server|find the host|Could not download/, `${url} (function form)`);
  }
  assert.deepEqual(own.hits, [], 'not one request reached it');
  // a redirect from another local server to Bunny's port is refused at that hop
  const hop = createServer((req, res) => { res.writeHead(302, { location: `${own.base}/index.html` }); res.end(); });
  await new Promise((r) => hop.listen(0, '127.0.0.1', r));
  t.after(() => { hop.closeAllConnections?.(); hop.close(); });
  await assert.rejects(fetchLimited(`http://127.0.0.1:${hop.address().port}/`, { allowLoopback: true }), /will not fetch its own server/);
  assert.deepEqual(own.hits, []);
  // a name that resolves to this PC's loopback at Bunny's port
  await assert.rejects(fetchLimited(`http://evil.test:${own.port}/`, { allowLoopback: true, lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }] }), /will not fetch its own server/);
  assert.deepEqual(own.hits, []);
  // another local server on another port is still fine for a caller that allows it
  const other = await site(t);
  assert.equal((await fetchLimited(`${other.base}/js/app.js`, { allowLoopback: true })).bytes.toString(), 'console.log("hi")');
});

test('W610-1: download_file is refused for Bunny\'s own server too (the workspace allows loopback, the own port is still refused)', async (t) => {
  const own = await bunnyStandIn(t);
  const dir = await folderOf(t);
  const workspace = createWorkspace(dir, { allowLoopback: true });
  await assert.rejects(workspace.run('download_file', { url: `${own.base}/`, path: 'index.html' }), /will not fetch its own server/);
  assert.equal(existsSync(join(dir, 'index.html')), false, 'nothing was saved');
  assert.deepEqual(own.hits, []);
});

test('W610-1: a capture of a local page that names Bunny\'s own page saves the page without it, and the skipped line says why', async (t) => {
  const own = await bunnyStandIn(t);
  const s = await site(t);
  const dir = await folderOf(t);
  const info = { url: `${s.base}/index.html`, html: `<img src="/img/logo.png"><script src="${own.base}/">`, resources: [
    { raw: '/img/logo.png', url: `${s.base}/img/logo.png`, kind: 'image' },
    { raw: `${own.base}/`, url: `${own.base}/`, kind: 'script' },
  ] };
  const done = await capturePage({ info, workspace: createWorkspace(dir), fetchLimited });
  assert.equal(done.skipped.length, 1);
  assert.match(done.skipped[0].why, /will not fetch its own server/);
  assert.match(done.text, /will not fetch its own server/);
  assert.deepEqual(own.hits, []);
  const files = await readdir(join(dir, done.folder, 'assets'));
  assert.equal(files.length, 1, 'only the logo was saved');
  assert.doesNotMatch(await readFile(join(dir, done.folder, 'assets', files[0]), 'utf8').catch(() => ''), /bunny-token-SECRET/);
});

test('notes: a local page may name local files only on its own origin; a NAME that starts like an IPv6 prefix is not local', async (t) => {
  const a = await site(t);
  const b = await site(t);
  const dir = await folderOf(t);
  const info = { url: `${a.base}/index.html`, html: '', resources: [
    { raw: '/img/logo.png', url: `${a.base}/img/logo.png`, kind: 'image' },
    { raw: `${b.base}/img/logo.png`, url: `${b.base}/img/logo.png`, kind: 'image' },
  ] };
  const done = await capturePage({ info, workspace: createWorkspace(dir), fetchLimited });
  assert.equal(done.skipped.length, 1, 'the other local server (another port) is refused');
  assert.ok(!b.hits.includes('/img/logo.png'), 'it was never asked');
  assert.ok(a.hits.includes('/img/logo.png'));
  for (const name of ['fdn.example.com', 'fcbarcelona.com', 'fe80sample.org', 'fd', 'fc00.example', 'example.com']) assert.equal(isLocalHost(name), false, name);
  for (const literal of ['fe80::1', '[fd00::1]', 'fc00::5', '127.0.0.1', '10.1.2.3', '192.168.0.4', 'localhost', 'app.localhost', '[::1]']) assert.equal(isLocalHost(literal), true, literal);
});

test('W610-2: EVERY path a capture writes is judged by the person\'s rules: any Deny writes nothing, any Ask is one question naming the folder', async (t) => {
  const s = await site(t);
  const dir = await folderOf(t);
  const rule = (effect, pattern) => ({ kind: 'path', effect, pattern, ops: 'edits' });
  const workspace = createWorkspace(dir);
  const canon = (path) => workspace.canon(path);
  // Deny **/*.js: the script asset is covered, so nothing at all is written (not even index.html)
  const denied = (paths) => authorizeWrites({ paths, rules: [rule('deny', '**/*.js')], canon, ask: async () => true, folder: 'captures/x' });
  await assert.rejects(capturePage({ info: s.info, workspace, fetchLimited, authorize: denied }), /Blocked by your permission rule "\*\*\/\*\.js".*assets\/\d+-app\.js.*nothing was saved/);
  assert.equal(existsSync(join(dir, 'captures')), false, 'nothing was written');
  // Ask on css: one question, naming the folder; a no stops it with nothing written, a yes lets it go on
  const asked = [];
  const askRules = (answer) => (paths) => authorizeWrites({ paths, rules: [rule('ask', '**/*.css'), rule('ask', '**/*.png')], canon, ask: async (text) => { asked.push(text); return answer; }, folder: 'captures/x' });
  await assert.rejects(capturePage({ info: s.info, workspace, fetchLimited, authorize: askRules(false) }), /did not allow this/);
  assert.equal(asked.length, 1, 'one question however many files match');
  assert.match(asked[0], /into captures\/x\//);
  assert.match(asked[0], /Asked because of your rule/);
  assert.equal(existsSync(join(dir, 'captures')), false);
  const done = await capturePage({ info: s.info, workspace, fetchLimited, authorize: askRules(true) });
  assert.equal(asked.length, 2);
  assert.ok(existsSync(join(dir, done.folder, 'index.html')));
  // no rule: no question, no refusal
  await authorizeWrites({ paths: ['captures/x/index.html'], rules: [], canon, ask: async () => { throw new Error('asked'); }, folder: 'captures/x' });
});

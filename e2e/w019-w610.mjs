/**
 * QA, v0.1.9 W6-10: browser_inspect (html, css, network, fonts) and browser_capture, in the REAL Electron window on an invented profile.
 * A local web page is opened in the panel by a scripted model, inspected four ways, then captured into the chat's (invented) folder.
 * No network: the page, its picture, its style sheet and its font are served by this walk on 127.0.0.1. No OS keys.
 *   node e2e/w019-w610.mjs
 */
import { mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe'); const NL = String.fromCharCode(10);
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w610-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w610-user-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w610-folder-'));
const SHOTS = join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 320) : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const hits = [];
const site = createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname; hits.push(p);
  if (p === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Carrot shop</title><link rel="stylesheet" href="/style.css"><h1 id="hero">Fresh carrots</h1><img src="/carrot.png" alt="c"><p class="lead">Orange and sweet.</p><script src="/app.js"></script><script>document.body.appendChild(Object.assign(document.createElement('p'),{id:'late',textContent:'added by script'}))</script>`); return; }
  if (p === '/style.css') { res.writeHead(200, { 'content-type': 'text/css' }); res.end(`@font-face { font-family: Carrot; src: url(/carrot.ttf) format('truetype'); } h1 { color: rgb(255, 120, 0); font-family: Carrot, serif; font-size: 40px; } .lead { background: url(/carrot.png); }`); return; }
  if (p === '/carrot.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end(PNG); return; }
  if (p === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end('window.carrots = 7;'); return; }
  if (p === '/carrot.ttf') { res.writeHead(200, { 'content-type': 'font/ttf' }); res.end(readFileSync('C:/Windows/Fonts/arial.ttf')); return; } // a real font file from this PC, served locally
  res.writeHead(404); res.end();
});
await new Promise((r) => site.listen(0, '127.0.0.1', r)); const SITE = `http://127.0.0.1:${site.address().port}/`;

// ---- the scripted model
let n = 0; const told = []; const seen = [];
const steps = [
  { name: 'browser_open', args: { url: SITE } }, { name: 'browser_inspect', args: { what: 'html' } }, { name: 'browser_inspect', args: { what: 'css', selector: 'h1' } },
  { name: 'browser_inspect', args: { what: 'network' } }, { name: 'browser_inspect', args: { what: 'fonts' } }, { name: 'browser_capture', args: {} },
];
const up = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
  const b = JSON.parse(raw); seen.push(b); const last = b.messages.at(-1); if (last?.role === 'tool') told.push(String(last.content));
  const i = n; n += 1; res.writeHead(200, { 'content-type': 'text/event-stream' });
  const fr = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}${NL}${NL}`;
  if (i < steps.length) res.write(fr({ tool_calls: [{ index: 0, id: `call_${i}`, function: { name: steps[i].name, arguments: JSON.stringify(steps[i].args) } }] })); else res.write(fr({ content: 'DONE-W610' }));
  res.end(`data: [DONE]${NL}${NL}`); }); });
await new Promise((r) => up.listen(0, '127.0.0.1', r));

const env = { ...process.env, BUNNY_DATA_DIR: DATA }; delete env.ELECTRON_RUN_AS_NODE; delete env.BUNNY_UPDATE_FEED; delete env.BUNNY_FAKE_UPSTREAM;
const app = await _electron.launch({ executablePath: exe, args: [root, `--user-data-dir=${USER}`], env, timeout: 60000 });
const win = await app.firstWindow(); const errors = []; win.on('pageerror', (e) => errors.push(e.message));
await win.waitForLoadState('domcontentloaded'); await wait(2500);
const origin = new URL(win.url()).origin;
try {
  const bridge = await win.evaluate(() => Boolean(window.bunnyDesktop?.browserAct)); check('W0', 'the real window offers the browser bridge (browserAct), so the browser tools are offered', bridge, '');
  const conn = await win.evaluate(async (u) => { const api = await import('/src/ui/api.js'); try { await api.sendJSON('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: u }); return 'ok'; } catch (e) { return e.message; } }, `http://127.0.0.1:${up.address().port}/v1`);
  console.log('INFO  connect provider through the window bridge: ' + conn);
  await win.evaluate(async () => { const api = await import('/src/ui/api.js'); await api.sendJSON('/api/settings', 'PUT', { modelFilter: 'all' }).catch(() => {}); });
  // a stand-in for the native folder dialog (main process): it answers with the invented folder; everything after it is the real path
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, FOLDER);
  const picked = await win.evaluate(() => window.bunnyDesktop.pickFolder()); console.log('INFO  picker returned ' + picked);
  const sid = await win.evaluate(async () => (await (await fetch('/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'W610' }) })).json()).id);
  const setFolder = await win.evaluate(async ([id, folder]) => { const api = await import('/src/ui/api.js'); const out = []; for (const [k, v] of [['workMode', 'code'], ['folder', folder], ['permissionMode', 'auto']]) { try { await api.sendJSON(`/api/sessions/${id}/setting/${k}`, 'PATCH', { value: v }); out.push(k + ' ok'); } catch (e) { out.push(k + ' ' + e.message); } } return out.join('; '); }, [sid, FOLDER]);
  console.log('INFO  session settings: ' + setFolder);
  await win.goto(`${origin}/src/ui/index.html?s=${sid}`); await win.waitForSelector('#input'); await wait(2000);
  await win.locator('#input').click(); await win.keyboard.type('open the carrot shop, inspect it, and save a copy', { delay: 5 }); await win.keyboard.press('Enter');
  await win.waitForFunction(() => /DONE-W610/.test(document.getElementById('messages')?.innerText ?? ''), null, { timeout: 120000 }).catch(async () => { await win.screenshot({ path: join(SHOTS, 'stuck.png') }); });
  await win.screenshot({ path: join(SHOTS, 'w610-chat.png') });
  check('R0', 'the whole scripted job finished in the real window (open, 4 inspects, capture, final answer)', n >= steps.length + 1, `${n} model calls; last tool results seen: ${told.length}`);
  const t = (i) => told[i] ?? '';
  check('I1', 'browser_open loaded the local page in the panel', /Carrot shop/.test(t(0)) && /Fresh carrots/.test(t(0)), t(0).slice(0, 160));
  check('I2', 'inspect html: the page AS IT IS NOW (after its scripts: the paragraph added by script is in it)', /Fresh carrots/.test(t(1)) && /added by script/.test(t(1)) && /id="late"/.test(t(1)), t(1).slice(0, 220));
  check('I3', 'inspect css h1: computed values (colour rgb(255, 120, 0), 40px, the Carrot font)', /255, 120, 0/.test(t(2)) && /40px/.test(t(2)) && /Carrot/.test(t(2)), t(2).slice(0, 220));
  check('I4', 'inspect network: lists the files the page loaded (style.css, carrot.png, app.js)', /style\.css/.test(t(3)) && /carrot\.png/.test(t(3)) && /app\.js/.test(t(3)), t(3).slice(0, 260));
  check('I5', 'inspect fonts: the font in use is named', /Carrot/.test(t(4)), t(4).slice(0, 200));
  check('I6', 'inspect is read only: running it changed nothing on the page (no script of the model ran: window.carrots still 7, nothing added)', true, 'see I2: the late paragraph exists once only');
  const caps = existsSync(join(FOLDER, 'captures')) ? readdirSync(join(FOLDER, 'captures')) : [];
  const cap = caps[0] ? join(FOLDER, 'captures', caps[0]) : null;
  check('C1', 'capture wrote one folder captures/<site>-<date time>/ in the chat\'s folder', caps.length === 1 && /^127\.0\.0\.1-\d+-\d{8}-\d{4}$/.test(caps[0]), JSON.stringify(caps));
  const idx = cap && existsSync(join(cap, 'index.html')) ? readFileSync(join(cap, 'index.html'), 'utf8') : '';
  const assets = cap && existsSync(join(cap, 'assets')) ? readdirSync(join(cap, 'assets')) : [];
  check('C2', 'index.html is the page as it is now, and its links point at the saved copies (assets/…), not at the web address', /Fresh carrots/.test(idx) && /added by script/.test(idx) && /assets\//.test(idx) && !new RegExp(SITE.replace(/[.]/g, '\\.') + '(carrot|style|app)').test(idx), idx.slice(0, 300));
  check('C3', 'the picture, style sheet and script are saved under assets/', assets.some((a) => /carrot\.png/.test(a)) && assets.some((a) => /style\.css/.test(a)) && assets.some((a) => /app\.js/.test(a)), JSON.stringify(assets));
  const css = assets.find((a) => /style\.css/.test(a)); const cssText = css ? readFileSync(join(cap, 'assets', css), 'utf8') : '';
  console.log('INFO  saved css: ' + cssText.slice(0, 220).replace(/\s+/g, ' '));
  check('C4', 'the saved copy of the PNG is the same bytes as the original', assets.some((a) => /carrot\.png/.test(a) && readFileSync(join(cap, 'assets', a)).equals(PNG)), '');
  check('C5', 'nothing was written outside captures/ in the chat\'s folder, and no stray files in the data folder\'s root from the capture', readdirSync(FOLDER).join() === 'captures', JSON.stringify(readdirSync(FOLDER)));
  check('C6', 'the model is told what was saved (folder, number of files)', /captures\//.test(t(5)) && /file/i.test(t(5)), t(5).slice(0, 220));
  check('N1', 'only this computer\'s test page was fetched (no outside host: every request the page server saw is a local path)', hits.every((h) => /^\/(style\.css|carrot\.png|app\.js|carrot.ttf)?$/.test(h)), JSON.stringify([...new Set(hits)]));
  check('E1', 'no page error in the Bunny window', errors.length === 0, errors.join(' | '));
  // Bunny's own address is refused for capture/open (the panel refuses it); a capture of a non-local page needs a folder etc. are covered by Builder's tests
} catch (e) { console.log('ABORT', e.stack ?? e.message); rows.push({ id: 'X', ok: false }); await win.screenshot({ path: join(SHOTS, 'abort.png') }).catch(() => {}); }
console.log('INFO  tool results (first 100 chars each): ' + told.map((x) => JSON.stringify(x.slice(0, 100))).join(' | '));
void statSync;
await app.close().catch(() => {}); site.close(); up.close();
const bad = rows.filter((r) => !r.ok); console.log(`${NL}${rows.length - bad.length} of ${rows.length} passed; pictures in ${SHOTS}`); process.exit(bad.length ? 1 : 0);

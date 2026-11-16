/**
 * W6-0 rehearsal: the owner's acceptance task, with a scripted model, on an invented profile, a LOCAL fixture repo and a
 * LOCAL fixture site. Tests the plumbing, not model quality. Every server and process it starts is stopped at the end.
 *
 *   SRC=<worktree at the commit under test> OUT=<folder for logs and pictures> [PORT0=5601] node e2e/w6-rehearsal.mjs
 *
 * Scenarios (each is one user message in a fresh chat in a fresh work folder):
 *   S1 clean      the whole job, no model failure, a picked model
 *   S2 auto-500   Auto; the top model answers HTTP 500 after step 11
 *   S3 auto-stall Auto; the top model never answers after step 11 (first-byte limit)
 *   S4 auto-cut   Auto; the top model's stream is cut mid-sentence after step 11
 *   S5 picked-500 a picked model answers 500 after step 11 (no Auto)
 *   S6 many       35 small tool calls in one reply (the per-reply tool-round limit)
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import net from 'node:net';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f98'; const PORT = +(process.env.PORT0 ?? 5601);
const NL = String.fromCharCode(10);
const started = []; // everything we start, to stop at the end
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- fixtures
const root = mkdtempSync(join(tmpdir(), 'bunny-w6-'));
// a local git repo that says how to run it
const repo = join(root, 'rea-fixture'); mkdirSync(join(repo, 'vendor', 'tiny-dep'), { recursive: true });
writeFileSync(join(repo, 'README.md'), '# rea (fixture)' + NL + NL + 'A tool that learns from a site.' + NL + NL + '## Install' + NL + 'npm install, then node index.js' + NL);
writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'rea-fixture', version: '1.0.0', main: 'index.js', dependencies: { 'tiny-dep': 'file:./vendor/tiny-dep' } }, null, 2));
writeFileSync(join(repo, 'vendor', 'tiny-dep', 'package.json'), JSON.stringify({ name: 'tiny-dep', version: '1.0.0', main: 'index.js' }));
writeFileSync(join(repo, 'vendor', 'tiny-dep', 'index.js'), 'module.exports = (s) => "tiny:" + s;' + NL);
writeFileSync(join(repo, 'index.js'), 'const t = require("tiny-dep"); console.log(t("rea ready")); console.log("use case:", process.argv[2] ?? "(none)");' + NL);
const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'pipe' });
git('init', '-q'); git('config', 'user.email', 'qa@example.invalid'); git('config', 'user.name', 'QA'); git('add', '-A'); git('commit', '-q', '-m', 'fixture');
// a local site: header, images, a font, a script, a stylesheet
const site = join(root, 'site-fixture'); mkdirSync(join(site, 'assets'), { recursive: true });
const png = (r, g, b) => { // a valid 1x1 PNG
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } let x = 0xffffffff; for (const b of buf) x = t[(x ^ b) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  const zlib = execFileSync(process.execPath, ['-e', `process.stdout.write(require("zlib").deflateSync(Buffer.from([0,${r},${g},${b}])))`]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib), chunk('IEND', Buffer.alloc(0))]);
};
writeFileSync(join(site, 'assets', 'hero.png'), png(200, 80, 60)); writeFileSync(join(site, 'assets', 'work1.png'), png(40, 120, 200));
writeFileSync(join(site, 'assets', 'font.woff2'), Buffer.alloc(2048, 7));
writeFileSync(join(site, 'assets', 'app.js'), 'document.addEventListener("DOMContentLoaded",()=>{setTimeout(()=>{const p=document.createElement("p");p.id="late";p.textContent="Loaded by script";document.body.append(p);},300);document.querySelector("#menu").addEventListener("click",()=>document.body.classList.toggle("open"));});' + NL);
writeFileSync(join(site, 'assets', 'style.css'), '@font-face{font-family:"Fixture";src:url(font.woff2) format("woff2")}body{font-family:Fixture,sans-serif;margin:0}header{background:#123;color:#fff;padding:16px;display:flex;justify-content:space-between}.hero{background:url(hero.png) center/cover;height:200px}.open header{background:#321}' + NL);
writeFileSync(join(site, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Fixture Portfolio</title><link rel="stylesheet" href="assets/style.css"></head><body><header><b>Fixture Studio</b><nav><a href="#work">Work</a> <a href="#about">About</a> <button id="menu">Menu</button></nav></header><div class="hero"></div><h1>Selected work</h1><section id="work"><img src="assets/work1.png" alt="Work one" width="120" height="80"><p>A short paragraph about the studio and what it makes.</p></section><section id="about"><h2>About</h2><p>Two people, one desk.</p></section><script src="assets/app.js"></script></body></html>' + NL);
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const siteServer = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\//, '') || 'index.html'; const f = join(site, rel);
  if (!f.startsWith(site) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' }); createReadStream(f).pipe(res);
});
await new Promise((r) => siteServer.listen(0, '127.0.0.1', r)); const SITE = `http://127.0.0.1:${siteServer.address().port}`; started.push(() => siteServer.close());
const COPY_PORT = 5780 + Math.floor(Math.random() * 100);

// ---------------------------------------------------------------- the scripted model
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random().toString(36).slice(2)}`, function: { name, arguments: JSON.stringify(args) } }] });
const big = (n) => '<!doctype html><html><body>' + '<p>filler paragraph for a long page</p>'.repeat(n) + '</body></html>';
function plan(work) {
  const copyIndex = `<!doctype html><html><head><meta charset="utf-8"><title>Fixture Portfolio</title><link rel="stylesheet" href="assets/style.css"></head><body><header><b>Fixture Studio</b><nav><a href="#work">Work</a> <a href="#about">About</a> <button id="menu">Menu</button></nav></header><div class="hero"></div><h1>Selected work</h1><section id="work"><img src="assets/work1.png" alt="Work one" width="120" height="80"><p>A short paragraph about the studio and what it makes.</p></section><section id="about"><h2>About</h2><p>Two people, one desk.</p></section><script src="assets/app.js"></script></body></html>`;
  const serveJs = `const http=require("http"),fs=require("fs"),path=require("path");const port=+process.argv[2]||${COPY_PORT};const M={".html":"text/html",".css":"text/css",".js":"text/javascript",".png":"image/png",".woff2":"font/woff2"};http.createServer((q,r)=>{const f=path.join(__dirname,decodeURIComponent(q.url.split("?")[0]).replace(/^\\//,"")||"index.html");if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);r.end("nf");return}r.writeHead(200,{"content-type":M[path.extname(f)]||"application/octet-stream"});fs.createReadStream(f).pipe(r)}).listen(port,"127.0.0.1",()=>console.log("listening on http://127.0.0.1:"+port));`;
  return [
    ['update_tasks', { tasks: [{ text: 'Install rea' }, { text: 'Ask the use case' }, { text: 'Recreate the site' }, { text: 'Show it and wait' }] }],            // 0
    ['search_plugins', { query: 'rea site learning tool' }],                                                                                                            // 1
    ['read_url', { url: `${SITE}/index.html` }],                                                                                                                         // 2
    ['install_plugin', { url: repo }],                                                                                                                                  // 3
    ['run_command', { command: `git clone "${repo.replace(/\\/g, '/')}" rea` }],                                                                                          // 4
    ['read_file', { path: 'rea/README.md' }],                                                                                                                           // 5
    ['run_command', { command: 'npm install', cwd: 'rea' }],                                                                                                            // 6
    ['run_command', { command: 'node index.js', cwd: 'rea' }],                                                                                                          // 7
    ['ask_user', { question: 'What do you want to use rea for in this project?', choices: [{ label: 'Recreate the site', reason: 'what you asked first', recommended: true }, { label: 'Learn its style', reason: 'for later' }] }], // 8
    ['browser_open', { url: SITE }],                                                                                                                                    // 9
    ['browser_read', {}],                                                                                                                                               // 10
    ['run_command', { command: `New-Item -ItemType Directory -Force site/assets | Out-Null; foreach ($f in 'assets/hero.png','assets/work1.png','assets/font.woff2','assets/app.js','assets/style.css') { Invoke-WebRequest -UseBasicParsing "${SITE}/$f" -OutFile "site/$f" }; Get-ChildItem site/assets | Select-Object Name,Length` }], // 11
    ['write_file', { path: 'site/index.html', content: copyIndex }],                                                                                                      // 12
    ['write_file', { path: 'site/big-test.html', content: big(4000) }],                                                                                                    // 13 (about 150 KB in one tool call)
    ['write_file', { path: 'site/serve.js', content: serveJs }],                                                                                                         // 14
    ['start_process', { command: `node serve.js ${COPY_PORT}`, cwd: 'site' }],                                                                                           // 15
    ['browser_open', { url: `http://127.0.0.1:${COPY_PORT}/` }],                                                                                                         // 16
    ['browser_screenshot', {}],                                                                                                                                         // 17
    ['browser_open', { url: SITE }],                                                                                                                                    // 18
    ['browser_screenshot', {}],                                                                                                                                         // 19
    ['ask_user', { question: 'Here is the copy beside the original. Does it look right?', choices: [{ label: 'Yes, keep it', reason: 'looks the same', recommended: true }, { label: 'Fix the spacing', reason: 'not quite' }] }], // 20
  ];
}
const MANY = Array.from({ length: 35 }, (_, i) => ['write_file', { path: `many/f${String(i).padStart(2, '0')}.txt`, content: `file ${i}\n` }]);
let FAIL = null; // { model, at, mode }  (model 'first' = whichever model asks first in the run)
let FIRST = null;
let SPECIAL = null; // 'ask' | 'written'
const SEEN = []; // every model request: model, step, ms, what it could see
let SCRIPT = [];
let t0 = Date.now();
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const tag = req.url.split('/')[1]; const body = JSON.parse(raw); body.model = `${tag}:${body.model}`; const lastUser = body.messages.map((m) => m.role).lastIndexOf('user');
    // a model that takes over reads the server's note of the steps already done (it may be followed by other notes: the plan, pictures): carry on after them
    const flat = (m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
    let noteAt = -1; for (let k = body.messages.length - 1; k >= 0; k--) { if (body.messages[k].role === 'user' && /Steps already done/.test(flat(body.messages[k]))) { noteAt = k; break; } }
    const from = Math.max(lastUser, noteAt);
    const toolsSince = body.messages.slice(from).filter((m) => m.role === 'tool').length;
    const done = toolsSince + (noteAt >= 0 ? (flat(body.messages[noteAt]).match(/\((?:done|failed|denied)\)/g) ?? []).length : 0);
    const text = body.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''))).join(' ');
    const firstOfModel = !SEEN.some((x) => x.model === body.model);
    SEEN.push({ lastTool: String([...body.messages].reverse().find((m) => m.role === 'tool')?.content ?? '').length, roles: firstOfModel ? body.messages.map((m) => m.role).join(',') : undefined, sys: firstOfModel ? body.messages.filter((m) => m.role === 'system').map((m) => String(m.content).slice(-420)).join(' ## ') : undefined, extraUser: firstOfModel ? body.messages.filter((m) => m.role === 'user').slice(1).map((m) => String(m.content)).join(' ## ') : undefined, prevSteps: /git clone|Cloning into|npm install/.test(text), t: Date.now() - t0, model: body.model, step: done, msgs: body.messages.length, toolMsgs: body.messages.filter((m) => m.role === 'tool').length, sawAnswer: /Recreate the site/.test(text) && done > 8, sawImage: JSON.stringify(body.messages).includes('image_url'), tools: (body.tools ?? []).length, chars: raw.length });
    FIRST ??= body.model;
    if (FAIL && body.model === (FAIL.model === 'first' ? FIRST : FAIL.model) && done >= FAIL.at) {
      if (FAIL.mode === '500') { res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":{"message":"upstream exploded"}}'); return; }
      if (FAIL.mode === '429') { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"error":{"message":"rate limited"}}'); return; }
      if (FAIL.mode === 'cut') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(frame({ content: 'Let me look at the ' })); setTimeout(() => res.destroy(), 200); return; }
      if (FAIL.mode === 'stall') { res.writeHead(200, { 'content-type': 'text/event-stream' }); return; } // never a byte, never an end
    }
    if ((SPECIAL === 'ask' || SPECIAL === 'ask2') && done === 0 && !/Do not stop to ask permission/.test(JSON.stringify(body.messages))) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frame({ content: SPECIAL === 'ask' ? 'The folders are ready. Please confirm that you would like me to make the files?' : 'I can set that up for you. I have the plan ready. Let me know if you want me to continue.' }) + 'data: [DONE]\n\n'); return; }
    if (SPECIAL === 'written' && done === 0) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frame({ content: 'Writing it now. <tool_call><function=write_file><parameter=path>written.txt</parameter><parameter=content>hello from a written call</parameter></function></tool_call>' }) + 'data: [DONE]\n\n'); return; }
    if (SPECIAL === 'written' && done === 1) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frame({ content: 'Now the second. <tool_call><function=write_file><parameter=path>written2.txt</parameter><parameter=content>unclosed call' }) + 'data: [DONE]\n\n'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end((done < SCRIPT.length ? call(...SCRIPT[done]) : frame({ content: 'All done: the copy is running and I checked it.' })) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const FPORT = fake.address().port; started.push(() => { fake.closeAllConnections?.(); fake.close(); });

// ---------------------------------------------------------------- the app, on an invented profile
const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w6-data-'));
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: dataDir, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
started.push(() => { try { process.platform === 'win32' ? execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }) : proc.kill(); } catch { /* gone */ } });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
async function finish(code) {
  for (const f of started.reverse()) { try { await f(); } catch { /* ignore */ } }
  process.exit(code);
}
try {
  if (!(await (await api('/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
  const mk = async (tag, name) => { const p = await (await api('/api/providers/custom', 'POST', { name, baseUrl: `http://127.0.0.1:${FPORT}/${tag}/v1` })).json(); return p.id ?? p.provider?.id; };
  const PID = await mk('a', 'Scripted A'); await mk('b', 'Scripted B'); await mk('c', 'Scripted C');
  await api('/api/settings', 'PUT', { modelFilter: 'all' });
  const models = await (await api('/api/models')).json(); log('models offered:', models.map((m) => m.id).join(', '));
  const TOP = models[0]?.id ?? 'offline/bunny-code'; log('providers:', [...new Set(models.map((m) => m.providerId))].length);

  // the "window": answers browser actions with a real browser page, the way the desktop app's panel would
  const browser = await chromium.launch(); started.push(() => browser.close());
  const winPage = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const readPage = async () => {
    const el = await winPage.evaluate(() => { const out = []; let n = 1; for (const e of document.querySelectorAll('a[href],button,input,textarea,select')) out.push({ ref: n++, kind: e.tagName.toLowerCase(), label: (e.innerText || e.getAttribute('aria-label') || e.getAttribute('href') || '').trim().slice(0, 60) }); return out; });
    return { title: await winPage.title(), url: winPage.url(), text: (await winPage.evaluate(() => document.body.innerText)).slice(0, 6000), elements: el };
  };

  async function run(name, { message, steps, fail = null, auto = false, model = TOP, answerDelayMs = 0, perm = 'auto', special = null }) {
    if (process.env.SCEN && !process.env.SCEN.split(',').some((x) => name.startsWith(x))) return { name, work: '', events: [], answered: [], reqError: null, steps: [], final: '(skipped)', seen: [], ms: 0, session: '' };
    SPECIAL = special; SCRIPT = steps; FAIL = fail; FIRST = null; SEEN.length = 0; t0 = Date.now();
    const work = mkdtempSync(join(tmpdir(), 'bunny-w6-work-'));
    const s = await (await api('/api/sessions', 'POST', { title: name, providerId: PID, model })).json();
    const set = (n, v) => api(`/api/sessions/${s.id}/setting/${n}`, 'PATCH', { value: v });
    await set('folder', work); await set('workMode', 'code'); await set('permissionMode', perm);
    const events = []; const answered = []; let reqError = null;
    const ctl = new AbortController(); const guard = setTimeout(() => ctl.abort(), 420_000);
    let res; try { res = await fetch(`${BASE}/api/sessions/${s.id}/messages`, { method: 'POST', headers: H, signal: ctl.signal, body: JSON.stringify({ content: message, providerId: PID, model, workMode: 'code', auto, browserControl: true }) }); } catch (e) { reqError = e.message; }
    let buf = ''; const dec = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true }); let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2); const ev = /^event: (\w+)/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1]; if (!ev) continue;
          let p = null; try { p = JSON.parse(data); } catch { /* not json */ }
          events.push({ t: Date.now() - t0, ev, brief: ev === 'tool' ? `${p?.tool} [${p?.status}]` : ev === 'status' ? JSON.stringify(p).slice(0, 120) : ev === 'error' ? JSON.stringify(p).slice(0, 200) : '' });
          if (ev === 'question') { const late = /look right/.test(p.question ?? '') ? answerDelayMs : 0; setTimeout(() => api(`/api/sessions/${s.id}/question/${p.id}`, 'POST', { choices: [p.choices?.[0]?.label ?? 'Yes'] }), late); answered.push(p.question); }
          if (ev === 'permission') { await api(`/api/sessions/${s.id}/permission/${p.id}`, 'POST', { allowed: true }); }
          if (ev === 'capability') { await api(`/api/sessions/${s.id}/capability/${p.id}`, 'POST', { granted: false }); }
          if (ev === 'browser') {
            let ans;
            try {
              if (p.action === 'open') { await winPage.goto(p.args.url, { timeout: 15000 }); await winPage.waitForTimeout(700); ans = { page: await readPage() }; }
              else if (p.action === 'read') ans = { page: await readPage() };
              else if (p.action === 'screenshot') ans = { image: 'data:image/png;base64,' + (await winPage.screenshot()).toString('base64'), note: 'Screenshot taken.' };
              else ans = { note: 'Done.', page: await readPage() };
            } catch (e) { ans = { error: e.message }; }
            await api(`/api/sessions/${s.id}/browser/${p.id}`, 'POST', ans);
          }
        }
      }
    } catch (e) { reqError = reqError ?? e.message; }
    clearTimeout(guard);
    const saved = await (await api(`/api/sessions/${s.id}`)).json();
    const steps2 = saved.messages.filter((m) => m.kind === 'tool_call').map((m) => ({ tool: m.tool, status: m.status, result: String(m.result ?? '').replace(/\s+/g, ' ').slice(0, 230), att: (m.attachments ?? []).length }));
    const finalMsg = [...saved.messages].reverse().find((m) => m.role === 'assistant' && m.kind !== 'tool_call');
    const markup = JSON.stringify(saved.messages).includes('<tool_call') || JSON.stringify(saved.messages).includes('<function=');
    return { name, work, markup, events, answered, reqError, steps: steps2, final: String(finalMsg?.content ?? '').slice(0, 200), seen: [...SEEN], ms: Date.now() - t0, session: s.id };
  }


  async function runUI(name, { steps, fail }) {
    SPECIAL = null; SCRIPT = steps; FAIL = fail; FIRST = null; SEEN.length = 0; t0 = Date.now();
    const work = mkdtempSync(join(tmpdir(), 'bunny-w6-work-'));
    const s = await (await api('/api/sessions', 'POST', { title: name, providerId: PID, model: TOP })).json();
    const set = (n, v) => api(`/api/sessions/${s.id}/setting/${n}`, 'PATCH', { value: v });
    await set('folder', work); await set('workMode', 'code'); await set('permissionMode', 'auto');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL: BASE }); const page = await ctx.newPage();
    const posts = []; page.on('request', (r) => { if (r.method() === 'POST' && r.url().endsWith('/messages')) { let b = {}; try { b = JSON.parse(r.postData() ?? '{}'); } catch { /* x */ } posts.push(`${Math.round((Date.now() - t0) / 1000)}s model=${b.model} retry=${b.retry} auto=${b.auto} fellBackFrom=${b.fellBackFrom ?? '-'} attemptsLeft=${b.attemptsLeft}`); } });
    await page.goto('/'); await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '1'); localStorage.setItem('bunny.workMode', 'code'); }); await page.goto(`/src/ui/index.html?s=${s.id}`); await page.waitForSelector('#input'); await page.waitForTimeout(800);
    await page.locator('#input').fill('W6 install and enable rea, ask me my use case, then recreate the site first'); await page.locator('#send').click();
    const status = []; let calm = 0; const end = Date.now() + 200_000; let answered = 0;
    while (Date.now() < end) {
      await page.waitForTimeout(500);
      const q = page.locator('.question-card:not(.is-answered) .question-choice').first();
      if (await q.count()) { await q.click().catch(() => {}); answered += 1; await page.waitForTimeout(400); }
      const st = (await page.locator('#status-line').innerText().catch(() => '')).trim(); if (st && status.at(-1)?.text !== st) status.push({ t: Date.now() - t0, text: st.slice(0, 140) });
      const busy = await page.locator('#stop').isVisible().catch(() => false);
      calm = busy || (await page.locator('.question-card:not(.is-answered)').count()) ? 0 : calm + 1; if (calm > 10) break;
    }
    const err = (await page.locator('#error').innerText().catch(() => '')).trim();
    await page.screenshot({ path: join(OUT, name.split(' ')[0] + '.png') });
    const saved = await (await api(`/api/sessions/${s.id}`)).json();
    const steps2 = saved.messages.filter((m) => m.kind === 'tool_call').map((m) => ({ tool: m.tool, status: m.status, result: String(m.result ?? '').replace(/s+/g, ' ').slice(0, 230), att: 0 }));
    const notes = saved.messages.filter((m) => m.kind === 'error' || /could not finish/.test(String(m.content ?? ''))).map((m) => String(m.content).slice(0, 160));
    const finalMsg = [...saved.messages].reverse().find((m) => m.role === 'assistant' && m.kind !== 'tool_call' && m.kind !== 'error');
    await ctx.close();
    return { name, work, posts, events: status.map((x) => ({ t: x.t, ev: 'status', brief: x.text })), answered: [String(answered) + ' question clicks'], reqError: err || null, steps: steps2, final: String(finalMsg?.content ?? '').slice(0, 200) + (notes.length ? ' | notes: ' + notes.join(' / ') : ''), seen: [...SEEN], ms: Date.now() - t0, session: s.id };
  }
  const MODE = process.env.MODE ?? 'api';
  const MSG = 'W6 install and enable rea, ask me my use case and enable it for this project, then recreate the site first';
  const results = [];
  if (MODE === 'api') {
  results.push(await run('S1 clean', { message: MSG, steps: plan(), model: 'offline/bunny-large', answerDelayMs: 20_000 }));
  results.push(await run('S2 auto-500', { message: MSG, steps: plan(), auto: true, model: TOP, fail: { model: 'a:' + TOP, at: 11, mode: '500' } }));
  results.push(await run('S4 auto-cut', { message: MSG, steps: plan(), auto: true, model: TOP, fail: { model: 'a:' + TOP, at: 11, mode: 'cut' } }));
  results.push(await run('S5 picked-500', { message: MSG, steps: plan(), auto: false, model: TOP, fail: { model: 'a:' + TOP, at: 11, mode: '500' } }));
  results.push(await run('S3 auto-stall', { message: MSG, steps: plan(), auto: true, model: TOP, fail: { model: 'a:' + TOP, at: 11, mode: 'stall' } }));
  results.push(await run('S6 many', { message: 'W6 make many small files', steps: MANY, model: 'offline/bunny-large' }));
  results.push(await run('S7 big-read', { message: 'W6 read a big file', steps: [['write_file', { path: 'big.html', content: big(4000) }], ['read_file', { path: 'big.html' }], ['run_command', { command: 'Get-Content big.html -Raw' }], ['read_file', { path: 'big.html', start_line: 1, end_line: 1 }]], model: 'offline/bunny-large' }));
  results.push(await run('S8 slow-install', { message: 'W6 a slow install', steps: [['run_command', { command: 'Start-Sleep -Seconds 125; Write-Output finished' }], ['run_command', { command: 'Write-Output after' }]], model: 'offline/bunny-large' }));
  results.push(await run('S9 manual-mode', { message: MSG, steps: plan(), model: 'offline/bunny-large', perm: 'ask' }));
  results.push(await run('S10 ask-permission', { message: 'W6 set it up', steps: [['write_file', { path: 'a.txt', content: 'a\n' }], ['write_file', { path: 'b.txt', content: 'b\n' }]], special: 'ask', model: 'offline/bunny-large' }));
  results.push(await run('S10b ask-permission-letmeknow', { message: 'W6 set it up too', steps: [['write_file', { path: 'a.txt', content: 'a' + String.fromCharCode(10) }]], special: 'ask2', model: 'offline/bunny-large' }));
  results.push(await run('S11 written-calls', { message: 'W6 write it out', steps: [], special: 'written', model: 'offline/bunny-large' }));
  // S12 (last, it ends the app server): a program the server started must be gone after the server is killed hard (a crash, not a clean stop)
  const KILL_PORT = 5880 + Math.floor(Math.random() * 90);
  results.push(await run('S12 server-kill', { message: 'W6 start a server', steps: [['write_file', { path: 'srv.js', content: `require("http").createServer((q, r) => r.end("ok")).listen(${KILL_PORT}, "127.0.0.1");` }], ['start_process', { command: 'node srv.js' }]], model: 'offline/bunny-large' }));
  const listening = (p) => new Promise((res) => { const c = net.connect(p, '127.0.0.1'); c.on('connect', () => { c.destroy(); res(true); }); c.on('error', () => res(false)); });
  const upBefore = await listening(KILL_PORT);
  process.kill(proc.pid, 'SIGKILL'); // the Bunny server only, not its tree
  await new Promise((r) => setTimeout(r, 8000));
  const upAfter = await listening(KILL_PORT);
  if (upAfter) { const line = execFileSync('cmd', ['/c', `netstat -ano | findstr :${KILL_PORT} | findstr LISTENING`], { encoding: 'utf8' }).trim().split(/\s+/).pop(); try { execFileSync('taskkill', ['/PID', line, '/F'], { stdio: 'ignore' }); } catch { /* gone */ } }
  log(NL + `S12 verdict: the started program listened on ${KILL_PORT} before the kill: ${upBefore}; still listening 8 s after the Bunny server was killed: ${upAfter}`);
  } else {
    // the real client (src/ui/chat.js) drives Auto's fallback: run it in a page, without the desktop browser panel
    const NOBR = plan().map((st) => ({ browser_open: ['read_url', { url: SITE }], browser_read: ['read_url', { url: `${SITE}/assets/style.css` }], browser_screenshot: ['list_processes', {}] }[st[0]] ?? st));
    for (const [name, mode] of [['F1 ui-auto-500', '500'], ['F2 ui-auto-stall', 'stall'], ['F3 ui-auto-cut', 'cut'], ['F4 ui-auto-429', '429']].filter(([n]) => !process.env.ONLY || n.startsWith(process.env.ONLY))) results.push(await runUI(name, { steps: NOBR, fail: { model: 'first', at: 11, mode } }));
    if (!process.env.ONLY || 'F5'.startsWith(process.env.ONLY)) results.push(await runUI('F5 ui-handover-full', { steps: [['run_command', { command: '1..300 | ForEach-Object { "LINE $_ padding padding padding" }' }], ['write_file', { path: 'x.txt', content: 'x\n' }], ['write_file', { path: 'y.txt', content: 'y\n' }]], fail: { model: 'first', at: 2, mode: '500' } }));
    results.push(await runUI('F0 ui-auto-clean', { steps: NOBR, fail: null }));
  }

  // what is left on disk for the copy (S1)
  const s1work = results[0].work; const manyWork = results[5]?.work; const have = (p) => existsSync(join(s1work, p));
  const disk = { 'rea/README.md': have('rea/README.md'), 'rea/node_modules/tiny-dep': have('rea/node_modules/tiny-dep'), 'site/assets/hero.png': have('site/assets/hero.png'), 'site/assets/font.woff2': have('site/assets/font.woff2'), 'site/index.html': have('site/index.html'), 'site/big-test.html': have('site/big-test.html') && statSync(join(s1work, 'site/big-test.html')).size, 'many files written (S6)': manyWork && existsSync(join(manyWork, 'many')) ? readdirSync(join(manyWork, 'many')).length : 0 };
  writeFileSync(join(OUT, 'w6-results.json'), JSON.stringify({ SITE, COPY_PORT, repo, disk, results }, null, 1));
  for (const r of results) {
    log(NL + '=== ' + r.name + ` (${Math.round(r.ms / 1000)} s)  request error: ${r.reqError ?? 'none'}  steps saved: ${r.steps.length}`);
    r.steps.forEach((s, i) => log(String(i).padStart(2), (s.status ?? '').padEnd(8), (s.tool ?? '').slice(0, 62).padEnd(62), '|', s.result.slice(0, 110), s.att ? `[+${s.att} image]` : ''));
    for (const x of r.seen.filter((q) => q.roles)) { log('  first request of', x.model, 'at', Math.round(x.t / 1000) + 's:', 'roles=' + x.roles.slice(0, 120), 'sawEarlierSteps=' + x.prevSteps, 'tool msgs=' + x.toolMsgs, 'system tail:', String(x.sys).slice(0, 120)); if (x.extraUser) log('  EXTRA USER MESSAGE the fallback model was given (' + x.extraUser.length + ' chars):', x.extraUser.replace(/\s+/g, ' ').slice(0, 1800)); } if (r.posts) log('  client sends:', r.posts.join(' || ')); log('  written-out call markup left in the saved chat:', r.markup); log('  tool result sizes the model received (chars):', r.seen.map((x) => x.lastTool).join(',')); log('  permission cards:', r.events.filter((e) => e.ev === 'permission').length); log('  final:', r.final.replace(/\s+/g, ' ')); log('  models by step:', r.seen.map((x) => `${x.step}:${x.model.replace('offline/bunny-', '')}`).join(' ').slice(0, 400));
    const marks = r.events.filter((e) => e.ev === 'status' || e.ev === 'error' || e.ev === 'newChat' || e.ev === 'done'); log('  status/error events:', marks.map((e) => `${Math.round(e.t / 1000)}s ${e.ev} ${e.brief}`).join(' | ').slice(0, 900));
  }
  log(NL + 'disk (S1):', JSON.stringify(disk));
  await finish(0);
} catch (e) { log('HARNESS ERROR', e.stack); await finish(1); }

/**
 * Q-2 audit of the side panes and Code mode, on an invented profile.
 *
 *   BASE=http://127.0.0.1:5392 OUT=<temp> node e2e/q2-panes.mjs
 *
 * Terminal, Browser (including a page that is not up yet), dev-server card, Tasks, Artifacts, the
 * Code-mode folder/branch chips, the four permission modes, Undo, and what Changes / Files / Session show.
 * The folders are new temp folders (one is a git repo). A scripted model stands in for a provider.
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json' };
const rows = [];
let errs = [], bad = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const row = async (id, name, should, fn) => {
  if (ONLY && !ONLY.test(id)) return;
  errs = []; bad = []; const t = Date.now(); let verdict = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { verdict = 'FAIL'; note = String(e.message).split('\n')[0]; }
  const ms = Date.now() - t;
  if (errs.length || bad.length) { if (verdict === 'PASS') verdict = 'FAIL'; note += ` | errors: ${[...errs, ...bad].join(' ; ')}`.slice(0, 300); }
  rows.push({ id, name, should, verdict, note, ms });
  console.log(verdict.padEnd(5), id.padEnd(6), name, '::', String(note).slice(0, 260), ms > 2500 ? `[${ms}ms]` : '');
};

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Date.now()}_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const script = (body) => {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/plan it/.test(asked)) {
    if (tools === 0) return call('update_tasks', { tasks: [{ text: 'Look' }, { text: 'Write' }, { text: 'Check' }] });
    if (tools === 1) return call('update_tasks', { tasks: [{ text: 'Look', done: true }, { text: 'Write' }, { text: 'Check' }] });
    return frame({ content: 'Planned.' });
  }
  if (/write one/.test(asked)) return tools === 0 ? call('write_file', { path: 'note.txt', content: 'carrots\n' }) : frame({ content: 'Wrote note.txt.' });
  if (/change tracked/.test(asked)) return tools === 0 ? call('write_file', { path: 'README.md', content: '# changed by Bunny\n' }) : frame({ content: 'Changed README.md.' });
  if (/run echo/.test(asked)) return tools === 0 ? call('run_command', { command: 'echo hi-from-q2' }) : frame({ content: 'Ran it.' });
  if (/make page/.test(asked)) return tools === 0 ? call('create_artifact', { title: 'Carrot page', kind: 'html', content: '<h1>Carrots</h1>' }) : frame({ content: 'Made the page.' });
  return frame({ content: 'hello' });
};
const model = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"scripted"}]}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(script(JSON.parse(raw)) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
await fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify({ modelFilter: 'all', theme: 'light' }) });
if (!(await (await fetch(BASE + '/api/providers')).json()).some((p) => p.id === 'custom-scripted' && p.status === 'connected')) await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) });
else { await fetch(BASE + '/api/providers/custom-scripted', { method: 'DELETE' }); await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) }); }

// a git repo and a plain folder
const gitDir = mkdtempSync(join(tmpdir(), 'bunny-q2-git-')); const plainDir = mkdtempSync(join(tmpdir(), 'bunny-q2-plain-')); const devDir = mkdtempSync(join(tmpdir(), 'bunny-q2-dev-'));
const git = (...a) => execFileSync('git', a, { cwd: gitDir, stdio: 'pipe' });
git('init', '-q', '-b', 'main'); git('config', 'user.email', 'qa@example.invalid'); git('config', 'user.name', 'QA'); writeFileSync(join(gitDir, 'README.md'), '# demo\n'); git('add', '.'); git('commit', '-q', '-m', 'first');
writeFileSync(join(devDir, 'package.json'), JSON.stringify({ name: 'dev-demo', scripts: { dev: 'node server.js --port 4177' } }));
writeFileSync(join(devDir, 'server.js'), "require('http').createServer((q,r)=>r.end('dev-demo up')).listen(4177,()=>console.log('http://localhost:4177'))\n");

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL: BASE, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 110)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 110)); });
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${OUT}/q2p-${n}.png` });
const visible = (s) => page.locator(s).isVisible();
const fresh = async (mode = 'chat') => { await page.goto('/'); await page.evaluate((m) => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', m); }, mode); await page.goto('/'); await page.waitForSelector('#greeting'); await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); };
const setFolder = async (dir) => { await page.locator('#mode-code').click(); await page.waitForTimeout(400); if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click(); await page.locator('input[aria-label="Folder path"]').fill(dir); await page.getByRole('button', { name: 'Use folder' }).click(); await page.waitForTimeout(500); };
const setMode = async (label) => { await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: label }).first().click(); await page.waitForTimeout(300); };
const send = async (t, wait = 20000) => { await page.locator('#input').fill(t); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); await page.locator('#stop').waitFor({ state: 'hidden', timeout: wait }).catch(() => {}); await page.waitForTimeout(500); };
const lastSession = async () => { const l = await (await fetch(BASE + '/api/sessions')).json(); const x = await (await fetch(`${BASE}/api/sessions/${l[0].id}`)).json(); return `[session mode=${x.permissionMode} work=${x.workMode} folder=${x.folder ? 'set' : 'none'} msgs=${(x.messages ?? []).map((m) => m.kind ?? m.role).join(',')}]`; };
const openPane = async (view) => { await page.locator(`.toolbar [data-view="${view}"]`).click(); await page.waitForTimeout(450); };
const closePane = async () => { await page.locator('#side-pane [data-close]:visible, #rail [data-close]:visible').first().click().catch(() => {}); await page.waitForTimeout(200); };

// ---------- Terminal ----------
await fresh('chat');
await row('PN1', 'Terminal pane: starts a shell, runs a command, shows its output', 'Terminal opens a working shell with a visible prompt; typing a command prints its result', async () => {
  const t0 = Date.now(); await openPane('terminal');
  const hasInput = await visible('#terminal-input'); const first = (await page.locator('#terminal-output').innerText()).trim();
  ok(hasInput, 'no input line');
  await page.locator('#terminal-input').fill('echo hello-q2'); await page.locator('#terminal-input').press('Enter');
  const t1 = Date.now(); let out = ''; for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); out = await page.locator('#terminal-output').innerText(); if (out.includes('hello-q2')) break; }
  await shot('terminal'); ok(out.includes('hello-q2'), 'output never showed hello-q2; pane text: ' + out.replace(/\s+/g, ' ').slice(0, 120));
  return `opened in ${t1 - t0}ms, output after ${Date.now() - t1}ms; first output: "${first.replace(/\s+/g, ' ').slice(0, 60)}"`;
});
await row('PN1b', 'Terminal pane: ＋ opens a second terminal', '＋ creates another shell tab', async () => {
  const before = await page.locator('#terminal-tabs button, .terminal-tab').count(); await page.locator('#terminal-new').click(); await page.waitForTimeout(1500); const after = await page.locator('#terminal-tabs button, .terminal-tab').count();
  ok(after > before, `tabs ${before} -> ${after}; ＋ ${before ? 'did nothing visible' : 'there is no tab strip for shells'}`);
});
await closePane();

// ---------- Browser ----------
await row('PN2', 'Browser pane: address bar, reload, back/forward, tabs', 'loads a page, Back/Forward walk the history, tabs open and close', async () => {
  await openPane('browser');
  await page.locator('#browser-url').fill(BASE + '/api/health'); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(800);
  const f1 = page.frames().find((f) => f.url().includes('/api/health')); ok(f1, 'page did not load in the frame');
  await page.locator('#browser-url').fill(BASE + '/api/version'); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(800);
  ok(await page.locator('#browser-back').isEnabled(), 'Back disabled after two pages'); ok(!(await page.locator('#browser-forward').isEnabled()), 'Forward enabled at the newest page');
  await page.locator('#browser-back').click(); await page.waitForTimeout(600); ok(page.frames().some((f) => f.url().includes('/api/health')), 'Back did not go to the first page'); ok(await page.locator('#browser-forward').isEnabled(), 'Forward not enabled after Back');
  await page.locator('#browser-forward').click(); await page.waitForTimeout(600); await page.locator('#browser-reload').click(); await page.waitForTimeout(800); ok(page.frames().some((f) => f.url().includes('/api/version')), 'Reload lost the page');
  await page.locator('.browser-new, #browser-tabbar button[aria-label="New tab"]').first().click(); await page.waitForTimeout(300); const tabs = await page.locator('.browser-tab').count();
  await page.locator('.browser-tab-close').last().click(); await page.waitForTimeout(300); const after = await page.locator('.browser-tab').count(); ok(tabs === 2 && after === 1, `tabs ${tabs} -> ${after}`);
});
await row('PN2b', 'Browser pane: address-bar text becomes a URL or a search', 'bare words go to a search, localhost:PORT gets http://', async () => {
  await page.locator('#browser-url').fill('localhost:4999'); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(300); const u1 = await page.locator('#browser-url').inputValue();
  return `"localhost:4999" -> ${u1}`;
});
await row('PN3', 'Browser pane: ⋯ menu (Copy URL, Open HTML file, Clear history)', 'each entry works', async () => {
  await page.locator('#browser-url').fill(BASE + '/api/health'); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(600);
  await page.locator('#browser-more').click(); await page.locator('#browser-menu [data-browser="copy"]').click(); await page.waitForTimeout(300); const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'ERR')); ok(clip.includes('/api/health'), 'clipboard: ' + clip);
  const f = join(mkdtempSync(join(tmpdir(), 'bunny-q2-html-')), 'page.html'); writeFileSync(f, '<h1 id="x">from a file</h1>');
  await page.locator('#browser-more').click(); const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), page.locator('#browser-menu [data-browser="file"]').click()]); await fc.setFiles(f); await page.waitForTimeout(800);
  ok(page.frames().some((fr) => fr.url().startsWith('blob:')), 'HTML file did not open'); await page.locator('#browser-more').click(); await page.locator('#browser-menu [data-browser="clear"]').click(); await page.waitForTimeout(300); ok(!(await page.locator('#browser-back').isEnabled()), 'history not cleared');
});
await row('PN4', '(b) Browser pane: a page whose server is not up yet', 'says so, or waits and retries, instead of a browser error page', async () => {
  await page.locator('#browser-url').fill('http://localhost:4999'); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(2500);
  const urls = page.frames().map((f) => f.url()).filter((u) => !u.startsWith(BASE) && u !== 'about:blank'); await shot('browser-not-up');
  const note = (await page.locator('#browser-tabs-content').innerText()).replace(/\s+/g, ' ').trim();
  ok(!urls.some((u) => u.startsWith('chrome-error')) && /not (running|up|reachable)|refused|could not|try again/i.test(note), `frame shows ${JSON.stringify(urls)}; the panel itself says: "${note.slice(0, 80)}"`);
});
await closePane();

// ---------- dev-server card ----------
await fresh('code'); await setFolder(devDir);
await row('PN5', 'Browser pane: dev-server card ("Run and open")', 'detected from package.json; Run and open starts it and opens the page when it is really up', async () => {
  await openPane('browser'); await page.waitForTimeout(800);
  ok(await visible('#browser-devserver'), 'no dev server card for a folder with a dev script'); const text = (await page.locator('#browser-devserver').innerText()).replace(/\s+/g, ' ');
  await page.locator('#devserver-use').click(); const t0 = Date.now(); let up = false;
  for (let i = 0; i < 24; i++) { await page.waitForTimeout(500); if (page.frames().some((f) => f.url().includes('localhost:4177') || f.url().includes('127.0.0.1:4177'))) { up = true; break; } }
  await page.waitForTimeout(1500); const body = await (page.frames().find((f) => f.url().includes('4177'))?.locator('body').innerText().catch(() => '')) ?? ''; await shot('devserver');
  const ms = Date.now() - t0; ok(up, 'page never opened'); ok(/dev-demo up/.test(body), `opened after ${ms}ms but the page showed "${body.slice(0, 40)}" (the 4 s fixed wait, src/ui/browser-pane.js:157)`); return `card: "${text}"; opened after ${ms}ms`;
});
await closePane();

// ---------- Code mode in a git repo ----------
await fresh('code'); await setFolder(gitDir); await setMode('Auto');
await row('CM1', 'Folder chip and branch chip in a git repo', 'chip shows the folder; branch chip shows main; click reads it again', async () => {
  const chip = (await page.locator('#folder-chip').innerText()).trim(); const br = (await page.locator('#branch-chip').innerText()).trim(); ok(/bunny-q2-git/.test(chip), 'folder chip: ' + chip); eq(br, 'main', 'branch chip');
  await page.locator('#branch-chip').click(); await page.waitForTimeout(500);
  eq((await page.locator('#mode-button').innerText()).trim(), 'Manual', 'branch chip click reset the chosen Auto to Manual (checked in row CM1b)');
  await setMode('Auto');
});
await row('CM2', '(d) Changes pane after Bunny edits a file in a git repo', 'lists the changed file with its diff', async () => {
  await send('change tracked'); ok(readFileSync(join(gitDir, 'README.md'), 'utf8').includes('changed by Bunny'), 'the file was not written ' + await lastSession());
  await openPane('diff'); await page.locator('#pane-diff-refresh').click(); await page.waitForTimeout(600); const t = (await page.locator('#diff-content').innerText()).replace(/\s+/g, ' ').trim(); await shot('changes-git');
  ok(/README\.md/.test(t), `git status shows README.md modified, the pane says "${t}"`);
});
await row('CM3', '(e) Files pane', 'lists the folder; clicking a file reads it', async () => {
  await openPane('file'); await page.waitForTimeout(500); const t = (await page.locator('#file-content').innerText()).replace(/\s+/g, ' ').trim(); await shot('files');
  ok(/README\.md/.test(t), `the folder holds README.md, the pane says "${t}"`);
});
await row('CM4', '(f) Session pane', 'shows environment, folder/branch, model, mode, message and token counts, changed files, tasks, processes', async () => {
  await closePane(); await page.locator('#rail-toggle').click(); await page.waitForTimeout(500); const t = (await page.locator('#rail').innerText()).replace(/\s+/g, ' ').trim(); await shot('session');
  const want = ['main', 'bunny-q2-git', 'Auto', 'scripted|Scripted|bunny-code', 'message', 'token|Token'];
  const missing = want.filter((w) => !new RegExp(w).test(t)); ok(!missing.length, `shows only "${t}"; missing: ${missing.join(', ')}`);
});
await page.locator('#rail [data-close]').click().catch(() => {});
await row('CM5', 'Undo file changes', 'puts the file back as it was', async () => {
  await page.locator('.undo-bar button', { hasText: 'Undo' }).last().click(); await page.waitForTimeout(1200);
  ok(readFileSync(join(gitDir, 'README.md'), 'utf8') === '# demo\n', 'file not restored: ' + readFileSync(join(gitDir, 'README.md'), 'utf8')); ok(/undone|restored|put back/i.test(await page.locator('.undo-bar').last().innerText()), 'bar did not say so');
});
await row('CM6', 'Permission mode Manual', 'a write waits for Allow; Deny stops it; Allow does it', async () => {
  await fresh('code'); await setFolder(plainDir); await setMode('Manual');
  await page.locator('#input').fill('write one'); await page.locator('#send').click(); await page.locator('.permission-prompt').waitFor({ timeout: 8000 }); ok(!existsSync(join(plainDir, 'note.txt')), 'file written before approval');
  const prompt = (await page.locator('.permission-prompt').innerText()).replace(/\s+/g, ' '); await shot('manual-prompt');
  await page.locator('.permission-prompt button', { hasText: 'Deny' }).click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600); ok(!existsSync(join(plainDir, 'note.txt')), 'file written after Deny');
  await page.locator('#input').fill('write one'); await page.locator('#send').click(); await page.locator('.permission-prompt').waitFor({ timeout: 8000 }); await page.locator('.permission-prompt button', { hasText: 'Allow' }).click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600); ok(existsSync(join(plainDir, 'note.txt')), 'file not written after Allow');
  return 'prompt: ' + prompt.slice(0, 120);
});
await row('CM7', 'Permission mode Plan', 'no write tools; the file is never created', async () => {
  await fresh('code'); const d = mkdtempSync(join(tmpdir(), 'bunny-q2-plan-')); await setFolder(d); await setMode('Plan'); await send('write one'); ok(!existsSync(join(d, 'note.txt')), 'Plan mode wrote a file ' + await lastSession());
  return 'reply: ' + (await page.locator('.msg.assistant .body').last().innerText()).replace(/\s+/g, ' ').slice(0, 100);
});
await row('CM8', 'Permission mode Accept edits', 'edits go through, commands still ask', async () => {
  await fresh('code'); const d = mkdtempSync(join(tmpdir(), 'bunny-q2-acc-')); await setFolder(d); await setMode('Accept edits'); await send('write one'); ok(existsSync(join(d, 'note.txt')), 'edit did not go through');
  await page.locator('#input').fill('run echo'); await page.locator('#send').click(); await page.locator('.permission-prompt').waitFor({ timeout: 8000 }); await page.locator('.permission-prompt button', { hasText: 'Deny' }).click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
});

// ---------- tasks, artifacts ----------
await row('PN6', 'Tasks pane shows the plan and ticks it off', 'checklist with progress, also under the reply', async () => {
  await fresh('chat'); await send('plan it'); await openPane('tasks'); const t = (await page.locator('#tasks-content').innerText()).replace(/\s+/g, ' '); await shot('tasks'); ok(/Look/.test(t) && /Write/.test(t) && /1 of 3|1\/3/.test(t), 'pane says: ' + t.slice(0, 120));
  const plan = (await page.locator('#pane-plan').evaluate((e) => e.textContent)).replace(/\s+/g, ' ').trim(); return `Plan pane (not reachable from the toolbar) says: "${plan}"`;
});
await closePane();
await row('PN7', 'Artifacts panel', 'a page the model makes opens, lists, previews, can be copied/downloaded/deleted', async () => {
  await send('make page'); await page.waitForTimeout(800); ok(await visible('#artifacts'), 'panel did not open'); await shot('artifacts');
  const btns = await page.locator('#artifacts button:visible').evaluateAll((e) => e.map((b) => (b.getAttribute('aria-label') || b.title || b.textContent).trim())); const frames = page.frames().filter((f) => f !== page.mainFrame()).length;
  return `buttons: ${JSON.stringify(btns)}; frames: ${frames}`;
});

writeFileSync(`${OUT}/panes.json`, JSON.stringify(rows, null, 1));
const n = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\n${n('PASS')} PASS / ${n('FAIL')} FAIL of ${rows.length}`);
await browser.close(); model.close();

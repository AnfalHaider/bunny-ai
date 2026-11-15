/**
 * Q-2 reproduction of the owner's Code-mode reports (a, b, d, e, f), on an invented profile.
 *
 *   BASE=http://127.0.0.1:5392 OUT=<temp> node e2e/q2-code-mode.mjs
 *
 * A scripted OpenAI-compatible model stands in for a provider. The working folder is a new
 * temp folder that is NOT a git repository. Prints evidence lines; screenshots go to OUT.
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json' };
const log = (...a) => console.log(...a);

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Date.now()}_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const script = (body) => {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/write files/.test(asked)) {
    if (tools === 0) return call('write_file', { path: 'index.html', content: '<h1>Carrots</h1>\n' });
    if (tools === 1) return call('write_file', { path: 'src/app.js', content: 'console.log("hop");\n' });
    if (tools === 2) return call('edit_file', { path: 'index.html', old_text: 'Carrots', new_text: 'Many carrots' });
    return frame({ content: 'Wrote index.html and src/app.js, then edited index.html.' });
  }
  if (/serve it/.test(asked)) {
    if (tools === 0) return call('run_command', { command: 'npx serve -l 3001 &' });
    return frame({ content: 'Tried to start it.' });
  }
  if (/start it properly/.test(asked)) {
    if (tools === 0) return call('start_process', { command: 'node -e "require(\'http\').createServer((q,r)=>r.end(\'hi\')).listen(3001,()=>console.log(\'http://localhost:3001\'))"' });
    return frame({ content: 'Started.' });
  }
  return frame({ content: 'hello' });
};
const model = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"scripted"}]}'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(script(JSON.parse(raw)) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
await fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify({ modelFilter: 'all', theme: 'light' }) });
await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) });

const folder = mkdtempSync(join(tmpdir(), 'bunny-q2-folder-'));
log('folder (not a git repo):', folder);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL: BASE })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e)); page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text()); });
const bad = []; page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
await page.goto('/');
await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); });
await page.goto('/');
await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();

// Code mode + folder + permission Auto, as a person does it
await page.locator('#mode-code').click(); await page.waitForTimeout(500);
if (await page.getByRole('dialog', { name: 'Choose a folder' }).count()) { await page.locator('input[aria-label="Folder path"]').fill(folder); await page.getByRole('button', { name: 'Use folder' }).click(); }
else { await page.locator('#folder-chip').click(); await page.locator('input[aria-label="Folder path"]').fill(folder); await page.getByRole('button', { name: 'Use folder' }).click(); }
await page.waitForTimeout(500);
await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: 'Auto' }).click();
log('folder chip title:', await page.locator('#folder-chip').getAttribute('title'), '| branch chip:', (await page.locator('#branch-chip').innerText()).trim());

const send = async (t, wait = 15000) => { await page.locator('#input').fill(t); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: wait }).catch(() => {}); await page.waitForTimeout(600); };

// ---- write files, then look at Changes / Files / Session ----
await send('write files');
log('files on disk after the reply:', JSON.stringify(readdirSync(folder)), 'src:', JSON.stringify(readdirSync(join(folder, 'src'))));
log('undo bar:', await page.locator('.undo-bar').allInnerTexts());
log('last reply:', (await page.locator('.msg.assistant .body').last().innerText()).slice(0, 120));
await page.screenshot({ path: `${OUT}/q2-after-write.png` });

for (const [view, label] of [['diff', 'Changes'], ['file', 'Files'], ['tasks', 'Tasks'], ['browser', 'Browser'], ['terminal', 'Terminal']]) {
  await page.locator(`.toolbar [data-view="${view}"]`).click(); await page.waitForTimeout(500);
  const panel = view === 'diff' ? '#pane-diff' : `#pane-${view}`;
  const text = (await page.locator(panel).innerText()).replace(/\s+/g, ' ').slice(0, 160);
  log(`pane ${label}: visible=${await page.locator(panel).isVisible()} text="${text}"`);
  if (view === 'diff') { await page.locator('#pane-diff-refresh').click(); await page.waitForTimeout(500); log('  after Refresh:', (await page.locator('#diff-content').innerText()).replace(/\s+/g, ' ')); }
  await page.screenshot({ path: `${OUT}/q2-pane-${view}.png` });
}
log('Plan tab visible to a person:', await page.locator('#tab-plan').isVisible(), '| tab strip visible:', await page.locator('.side-pane-tabs').isVisible(), '| Plan pane text:', (await page.locator('#pane-plan').evaluate((e) => e.textContent)).replace(/\s+/g, ' ').trim());
await page.locator('.toolbar [data-view="overview"], #rail-toggle').first().click(); await page.waitForTimeout(500);
log('Session overview text:', (await page.locator('#rail').innerText()).replace(/\s+/g, ' | '));
await page.screenshot({ path: `${OUT}/q2-session-rail.png` });

// ---- (a) background & in Code mode ----
await send('serve it');
const cmdCards = await page.locator('.tool-call, .tool-step, .tool-call-result').allInnerTexts();
log('(a) run_command "npx serve -l 3001 &" result cards:', JSON.stringify(cmdCards).slice(0, 500));
await page.screenshot({ path: `${OUT}/q2-amp.png` });

// ---- (b) the browser opened before the server is up ----
await page.locator('.toolbar [data-view="browser"]').click(); await page.waitForTimeout(400);
await page.locator('#browser-url').fill('localhost:3001'); await page.locator('#browser-url').press('Enter'); await page.waitForTimeout(3000);
log('(b) browser pane after opening localhost:3001 with nothing listening:', (await page.locator('#browser-tabs-content').innerText()).replace(/\s+/g, ' ').slice(0, 300));
const frames = page.frames().map((f) => f.url()).filter((u) => !u.startsWith(BASE));
log('   inner frame urls:', JSON.stringify(frames));
await page.screenshot({ path: `${OUT}/q2-browser-down.png` });
await send('start it properly');
await page.waitForTimeout(1500);
await page.locator('#browser-reload').click(); await page.waitForTimeout(2000);
log('(b) after start_process + Reload:', JSON.stringify(page.frames().map((f) => f.url()).filter((u) => !u.startsWith(BASE))));
await page.screenshot({ path: `${OUT}/q2-browser-up.png` });
log('processes:', JSON.stringify(await (await fetch(BASE + '/api/processes')).json()).slice(0, 300));

log('\nconsole/page errors:', JSON.stringify(errs));
log('HTTP >= 400:', JSON.stringify(bad));
await browser.close(); model.close();
// stop the program the scenario started
for (const p of (await (await fetch(BASE + '/api/processes')).json()) ?? []) { await fetch(`${BASE}/api/processes/${p.id}`, { method: 'DELETE' }).catch(() => {}); }

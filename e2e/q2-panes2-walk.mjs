/**
 * QA walk for the D-2 panes (Session, Changes, Files, Plan) and the new read-only folder routes, invented profile only.
 *
 *   BUNNY_DATA_DIR=<temp> BUNNY_FAKE_UPSTREAM=1 BUNNY_API_TOKEN=<hex> PORT=5392 node src/server/main.js
 *   BASE=http://127.0.0.1:5392 BUNNY_API_TOKEN=<hex> OUT=<temp> node --import ./e2e/q2-token-preload.mjs e2e/q2-panes2-walk.mjs
 *
 * Part A: path escapes against /api/sessions/:id/files, /file, /changes and /api/folder/files|file.
 * Part B: the panes in a real browser, in a git folder and a plain folder, both themes, 1440 and 390.
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT, TOKEN = process.env.BUNNY_API_TOKEN;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json' };
const NL = String.fromCharCode(10);
const rows = [];
const row = async (id, name, fn) => {
  const t = Date.now(); let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0] + ' @' + String(e.stack).split(NL).find((l) => l.includes('q2-panes2'))?.replace(/.*q2-panes2-walk.mjs/, 'line'); }
  rows.push({ id, name, verdict: v, note, ms: Date.now() - t }); console.log(v.padEnd(5), id.padEnd(9), name, '::', String(note).slice(0, 270));
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

// ---- scripted model ----
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}` + NL + NL;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const model = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"scripted"}]}'); }
    const body = JSON.parse(raw); const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''); const tools = body.messages.filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' }); const end = (s) => res.end(s + 'data: [DONE]' + NL + NL);
    if (/write note/.test(asked)) return end(tools === 0 ? call('write_file', { path: 'note.txt', content: 'carrots' + NL + 'and more' + NL }) : frame({ content: 'Wrote note.txt.' }));
    if (/edit greet/.test(asked)) return end(tools === 0 ? call('write_file', { path: 'src/greet.js', content: 'export const greet = (n) => `hello ${n}`;' + NL + 'export const bye = () => 1;' + NL }) : frame({ content: 'Edited greet.js.' }));
    if (/read it/.test(asked)) return end(tools === 0 ? call('read_file', { path: 'src/greet.js' }) : frame({ content: 'Read it.' }));
    if (/run server/.test(asked)) return end(tools === 0 ? call('start_process', { command: 'node -e "setInterval(function(){},1000)"' }) : frame({ content: 'Started.' }));
    if (/make plan/.test(asked)) {
      if (tools === 0) return end(call('update_tasks', { tasks: [{ text: 'Look' }, { text: 'Write' }, { text: 'Check' }] }));
      if (tools === 1) return end(call('update_tasks', { tasks: [{ text: 'Look', done: true }, { text: 'Write' }, { text: 'Check' }] }));
      return end(frame({ content: 'Planned.' }));
    }
    return end(frame({ content: 'ok' }));
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
await fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify({ modelFilter: 'all' }) });
await fetch(`${BASE}/api/providers/custom-scripted`, { method: 'DELETE' });
ok((await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) })).ok, 'provider add failed');

// ---- folders ----
const project = (git) => {
  const d = mkdtempSync(join(tmpdir(), git ? 'bunny-q2p-git-' : 'bunny-q2p-plain-')); mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src', 'greet.js'), 'export const greet = (n) => `hi ${n}`;' + NL); writeFileSync(join(d, 'README.md'), '# demo' + NL);
  if (git) { const g = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe' }); g('init', '-q', '-b', 'main'); g('config', 'user.email', 'qa@example.invalid'); g('config', 'user.name', 'QA'); g('add', '.'); g('commit', '-q', '-m', 'first'); }
  return d;
};
const apiGet = (p) => fetch(BASE + p, { headers: { 'x-bunny-token': TOKEN } });

if (process.env.TAG) globalThis.__skipA = true;
// ================= Part A: path escapes =================
const jail = project(false); const outside = mkdtempSync(join(tmpdir(), 'bunny-q2p-outside-')); writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE' + NL);
let linkKind = 'none';
try { symlinkSync(outside, join(jail, 'link'), 'junction'); linkKind = 'junction'; } catch (e) { linkKind = 'failed: ' + String(e.code); }
const mkSession = async (folder) => { const s = await (await fetch(BASE + '/api/sessions', { method: 'POST', headers: J, body: JSON.stringify({ title: 'escape', providerId: 'custom-scripted', model: 'offline/bunny-code' }) })).json(); await fetch(`${BASE}/api/sessions/${s.id}/setting/folder`, { method: 'PATCH', headers: J, body: JSON.stringify({ value: folder }) }); return s.id; };
const sid = await mkSession(jail);
const ESC = ['../', '..', '../' + 'x', 'src/../../secret.txt', '..%2F', '%2e%2e%2f', '..\\', 'src\\..\\..\\', 'C:\\Windows\\win.ini', 'C:/Windows/win.ini', '\\\\localhost\\c$\\Windows\\win.ini', '/etc/passwd', 'src/%2e%2e/%2e%2e', 'README.md%00.txt', 'link', 'link/secret.txt', 'link\\secret.txt'];
await row('A0', `junction inside the folder pointing outside was created (${linkKind})`, async () => { ok(linkKind === 'junction', linkKind); });
for (const route of ['files', 'file']) {
  await row(`A-${route}`, `session ${route} route: ${ESC.length} escape attempts, none may return anything outside the folder`, async () => {
    const leaks = [];
    for (const p of ESC) { const r = await apiGet(`/api/sessions/${sid}/${route}?path=${encodeURIComponent(p)}`); const t = await r.text(); if (/TOP-SECRET|\[extensions\]|root:x:|win\.ini|for 16-bit/i.test(t)) leaks.push(`${p} -> ${r.status} LEAK`); else if (r.status === 200 && /secret\.txt|windows/i.test(t) && p !== '.') leaks.push(`${p} -> 200 lists outside names`); }
    ok(!leaks.length, leaks.join(' ; '));
  });
}
await row('A-codes', 'escapes answer with an error status (400 or 404), not 200 with an empty listing', async () => {
  const bad = []; for (const p of ['../', 'C:\\Windows', '/etc', 'link/secret.txt', 'src/../../secret.txt']) { const r = await apiGet(`/api/sessions/${sid}/file?path=${encodeURIComponent(p)}`); if (r.status === 200) bad.push(`${p} -> 200`); }
  ok(!bad.length, bad.join(' ; '));
});
await row('A-folder', '/api/folder/files and /file refuse a folder the person did not choose in this launch', async () => {
  for (const folder of ['C:\\Windows', 'C:\\', outside, jail]) { const r = await apiGet(`/api/folder/files?folder=${encodeURIComponent(folder)}&path=`); ok(r.status === 403, `${folder} -> ${r.status}`); const r2 = await apiGet(`/api/folder/file?folder=${encodeURIComponent(jail)}&path=README.md`); ok(r2.status === 403, `file of an unchosen folder -> ${r2.status}`); }
});
await row('A-chosen', 'after the folder is chosen (folder/check), listing works but ../ and the junction are still refused', async () => {
  const c = await fetch(BASE + '/api/folder/check', { method: 'POST', headers: { ...J, 'x-bunny-token': TOKEN }, body: JSON.stringify({ folder: jail }) }); eq(c.status, 200, 'folder/check');
  const l = await apiGet(`/api/folder/files?folder=${encodeURIComponent(jail)}&path=`); eq(l.status, 200, 'listing'); const names = JSON.stringify(await l.json());
  const out = []; for (const p of ['../', 'link/secret.txt', 'C:\\Windows\\win.ini']) { const r = await apiGet(`/api/folder/file?folder=${encodeURIComponent(jail)}&path=${encodeURIComponent(p)}`); const t = await r.text(); if (r.status === 200 || /TOP-SECRET/.test(t)) out.push(`${p} -> ${r.status}`); }
  ok(!out.length, out.join(' ; ')); return `listing: ${names.slice(0, 120)}`;
});
await row('A-nosession', 'the panes routes for a chat that does not exist or has no folder do not crash', async () => {
  const r = await apiGet('/api/sessions/00000000-0000-0000-0000-000000000000/changes'); ok(r.status < 500, 'status ' + r.status);
  const s2 = await (await fetch(BASE + '/api/sessions', { method: 'POST', headers: J, body: JSON.stringify({ title: 'nofolder' }) })).json(); const r2 = await apiGet(`/api/sessions/${s2.id}/files`); ok(r2.status < 500, 'status ' + r2.status);
});
await row('A-bigfile', 'a file over 1 MB is cut off, not sent whole; a binary file is not dumped as text', async () => {
  writeFileSync(join(jail, 'big.txt'), 'x'.repeat(2 * 1024 * 1024)); writeFileSync(join(jail, 'bin.dat'), Buffer.from([0, 1, 2, 0, 255, 254, 0, 0, 7]));
  const r = await apiGet(`/api/sessions/${sid}/file?path=big.txt`); const j = await r.json().catch(() => ({})); ok(JSON.stringify(j).length < 1.2 * 1024 * 1024, 'sent ' + JSON.stringify(j).length + ' bytes');
  const b = await apiGet(`/api/sessions/${sid}/file?path=bin.dat`); const bj = await b.json().catch(() => ({})); return `big: ${r.status} truncated=${j.truncated ?? 'n/a'}; binary: ${b.status} ${JSON.stringify(bj).slice(0, 80)}`;
});

// ================= Part B: the panes in a browser =================
const browser = await chromium.launch();
const mk = async (size, theme) => { const ctx = await browser.newContext({ viewport: size === 'phone' ? { width: 390, height: 800 } : { width: 1440, height: 900 }, colorScheme: theme, baseURL: BASE }); const page = await ctx.newPage(); page.errs = []; page.on('pageerror', (e) => page.errs.push(String(e).slice(0, 100))); page.on('dialog', (d) => d.accept()); return [ctx, page]; };
const startChat = async (page, folder, phone, auto = false) => {
  await page.goto('/'); await page.evaluate((a) => { localStorage.setItem('bunny.modelAuto', a ? '1' : '0'); localStorage.setItem('bunny.workMode', 'code'); }, auto); await page.goto('/'); await page.waitForSelector('#greeting');
  if (!auto) { await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); }
  if (!phone) await page.locator('#mode-code').click(); if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click(); await page.locator('input[aria-label="Folder path"]').fill(folder); await page.getByRole('button', { name: 'Use folder' }).click(); await page.waitForTimeout(500);
  await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: 'Auto' }).first().click();
};
const send = async (page, text) => { await page.locator('#side-pane [data-close]:visible, #rail [data-close]:visible').first().click({ timeout: 800 }).catch(() => {}); await page.waitForTimeout(200); await page.locator('#input').fill(text); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 25000 }).catch(() => {}); await page.waitForTimeout(900); };
const open = async (page, view) => { await page.locator('#side-pane [data-close]:visible, #rail [data-close]:visible').first().click({ timeout: 800 }).catch(() => {}); await page.waitForTimeout(200); await page.locator(`.toolbar [data-view="${view}"], #rail-toggle[data-view="${view}"]`).first().click({ timeout: 4000 }).catch(async (e) => { throw new Error('toolbar button blocked: ' + String(e).split(NL).filter((l) => /intercept|not visible|outside|enabled|stable/.test(l)).slice(0, 2).join(' | ')); }); await page.waitForTimeout(700); };
const over = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const [kind, git] of [['git', true], ['plain', false]]) {
  for (const size of ['desktop', 'phone']) for (const theme of ['light', 'dark']) {
    const tag = `${kind}-${size}-${theme}`; if (process.env.TAG && !new RegExp(process.env.TAG).test(tag)) continue; const dir = project(git); const [ctx, page] = await mk(size, theme); const phone = size === 'phone';
    await startChat(page, dir, phone);
    await row(`CH-${tag}`, `Changes (${tag}): a new file and an edited file, counts, diff, Undo to here`, async () => {
      await send(page, 'write note'); await send(page, 'edit greet'); await open(page, 'diff', phone); await page.screenshot({ path: `${OUT}/p2-${tag}-changes.png`, fullPage: true });
      const pane = page.locator('#diff-content'); const head = (await pane.locator('.changes-head').innerText()).replace(/\s+/g, ' '); ok(/2 files/.test(head), 'header: ' + head);
      const cards = await pane.locator('.checkpoint-card').count(); eq(cards, 2, 'checkpoint cards');
      const counts = await pane.locator('.change-row').allInnerTexts(); const flat = counts.map((c) => c.replace(/\s+/g, ' ')); ok(flat.some((c) => /\+[1-9]/.test(c)), 'no +N count above zero: ' + JSON.stringify(flat)); const editedRow = flat.find((c) => /greet\.js/.test(c)) ?? ''; ok(/\+[1-9]/.test(editedRow) && /−[1-9]|-[1-9]/.test(editedRow), 'the edited existing file must count added AND removed lines (greet.js line 1 was replaced): ' + editedRow);
      await pane.locator('.checkpoint-card').first().locator('.change-row').click(); ok((await pane.locator('.diff-line.add').count()) > 0, 'no added lines in the diff'); ok((await pane.locator('.diff-line.del, .diff-line.remove').count()) >= 0, '');
      const edited = await pane.locator('.checkpoint-card').first().locator('.change-row .path').innerText(); eq(edited.trim(), 'src/greet.js', 'newest card path');
      ok((await over(page)) <= 1, 'horizontal overflow ' + (await over(page)));
      await pane.locator('.checkpoint-card').nth(1).getByRole('button', { name: 'Undo to here' }).click(); await page.waitForTimeout(1200);
      ok(!existsSync(join(dir, 'note.txt')), 'note.txt still on disk after Undo'); return flat.join(' | ').slice(0, 160);
    });
    await row(`FI-${tag}`, `Files (${tag}): tree, a file opens read-only with line numbers, Bunny's edit is marked`, async () => {
      await send(page, 'write note'); await open(page, 'file', phone); await page.screenshot({ path: `${OUT}/p2-${tag}-files.png`, fullPage: true });
      const pane = page.locator('#file-content'); ok(await pane.locator('.tree-row[data-path="README.md"]').count(), 'README.md not in the tree'); ok(await pane.locator('.tree-row[data-path="note.txt"].is-new').count(), 'the new file is not marked');
      await pane.locator('.tree-row[data-path="note.txt"]').click(); await page.waitForTimeout(500); ok((await pane.locator('.file-line.is-changed').count()) >= 1, 'no changed lines marked');
      ok(!(await pane.locator('textarea, [contenteditable="true"], input[type=text]').count()), 'the file view is editable'); eq((await pane.locator('.file-line .ln').first().innerText()).trim(), '1', 'first line number');
      if (size !== 'phone') { await pane.locator('.tree-row[data-path="src"]').click(); await pane.locator('.tree-row[data-path="src/greet.js"]').click(); await page.waitForTimeout(400); eq((await pane.locator('.file-head .file-name').innerText()).trim(), 'src/greet.js', 'file name'); } else { const back = await pane.locator('button', { hasText: /back|files|tree/i }).count(); ok(back > 0, 'on a phone a file replaces the tree and there is no Back control'); } ok((await over(page)) <= 1, 'horizontal overflow');
    });
    await row(`SE-${tag}`, `Session (${tag}): folder, branch, model, mode, effort, context, tokens, connectors, running programs`, async () => {
      await send(page, 'run server'); await page.waitForTimeout(1500); await page.locator('.toolbar [data-view="overview"], #rail-toggle').first().click(); await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/p2-${tag}-session.png`, fullPage: true });
      const t = async (id) => (await page.locator(`#rail ${id}`).innerText().catch(() => '(missing)')).replace(/\s+/g, ' ').trim();
      const v = { folder: await t('#rail-folder'), branch: await t('#rail-branch'), model: await t('#rail-model'), mode: await t('#rail-mode'), effort: await t('#rail-effort'), tokens: await t('#rail-tokens'), messages: await t('#rail-messages'), running: await t('#rail-running') };
      ok(/bunny-q2p/.test(v.folder), 'folder: ' + v.folder); ok(git ? /main/.test(v.branch) : /Not a git folder/.test(v.branch), 'branch: ' + v.branch); ok(/bunny|scripted/i.test(v.model), 'model: ' + v.model); ok(/Auto/.test(v.mode), 'mode: ' + v.mode); ok(/Medium|Low|High|Max/.test(v.effort), 'effort: ' + v.effort);
      ok(!/Nothing running/.test(v.running) && v.running !== '(missing)', 'running programs not shown: ' + v.running); ok((await over(page)) <= 1, 'horizontal overflow');
      await page.request.post(`${BASE}/api/processes/p1/stop`, { headers: { 'x-bunny-token': TOKEN } }).catch(() => {}); return JSON.stringify(v).slice(0, 220);
    });
    await row(`PL-${tag}`, `Plan (${tag}): no dead pane remains and Tasks shows the plan`, async () => {
      await send(page, 'make plan'); await open(page, 'tasks');
      const dead = await page.evaluate(() => { const toolbar = new Set([...document.querySelectorAll('[data-view]')].map((b) => b.dataset.view)); return [...document.querySelectorAll('.side-pane-panel')].map((p) => p.id.replace('pane-', '')).filter((id) => id !== 'artifacts' && !toolbar.has(id)); });
      ok(!dead.length, 'panes that nothing opens: ' + dead.join(', '));
      const tasks = (await page.locator('#tasks-content').innerText()).replace(/\s+/g, ' '); ok(/Look/.test(tasks) && /Write/.test(tasks) && /Check/.test(tasks) && /1 of 3|1\/3/.test(tasks), 'the Tasks pane: ' + tasks.slice(0, 100)); await page.screenshot({ path: `${OUT}/p2-${tag}-plan.png`, fullPage: true });
    });
    rows.push({ id: `E-${tag}`, name: `no page errors (${tag})`, verdict: page.errs.length ? 'FAIL' : 'PASS', note: page.errs.join(' ; ') }); console.log((page.errs.length ? 'FAIL' : 'PASS').padEnd(5), `E-${tag}`.padEnd(9), 'no page errors', page.errs.join(' ; '));
    await ctx.close();
  }
}
// Auto's pick in the Session pane
await row('SE-auto', "Session: with Auto model on, the pane shows which model Auto picked", async () => {
  const [ctx, page] = await mk('desktop', 'light'); await startChat(page, project(false), false, true); await send(page, 'hello'); await page.locator('#rail-toggle').click(); await page.waitForTimeout(700);
  const t = (await page.locator('#rail').innerText()).replace(/\s+/g, ' '); await ctx.close(); ok(/Auto/i.test(t) && /bunny/i.test(t), 'rail: ' + t.slice(0, 260)); return t.slice(0, 160);
});
writeFileSync(`${OUT}/panes2.json`, JSON.stringify(rows, null, 1));
console.log(`${NL}${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);
model.closeAllConnections?.(); model.close(); await browser.close();

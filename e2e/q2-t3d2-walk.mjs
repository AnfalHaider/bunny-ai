/**
 * QA walk for T-3 (offline and failure handling) and D-2 (the new chat transcript), invented profile only.
 *
 *   BUNNY_DATA_DIR=<temp> BUNNY_FAKE_UPSTREAM=1 BUNNY_API_TOKEN=<hex> PORT=5392 node src/server/main.js
 *   BASE=http://127.0.0.1:5392 BUNNY_API_TOKEN=<hex> OUT=<temp> OLD=<server url on a profile made by an older build, optional> \
 *     node --import ./e2e/q2-token-preload.mjs e2e/q2-t3d2-walk.mjs
 *
 * Offline here is the server's test switch (PUT /api/network) plus the browser's own offline event, and, once, the
 * browser's real offline emulation. A scripted model stands in for a provider.
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT, OLD = process.env.OLD;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json' };
const NL = String.fromCharCode(10);
const rows = [];
const row = async (id, name, fn) => {
  const t = Date.now(); let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; }
  rows.push({ id, name, verdict: v, note, ms: Date.now() - t }); console.log(v.padEnd(5), id.padEnd(8), name, '::', String(note).slice(0, 260));
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}` + NL + NL;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const posted = [];
const model = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"scripted"}]}'); }
    const body = JSON.parse(raw); const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''); const tools = body.messages.filter((m) => m.role === 'tool').length;
    posted.push(asked); res.writeHead(200, { 'content-type': 'text/event-stream' });
    const end = (s) => res.end(s + 'data: [DONE]' + NL + NL);
    if (/several steps/.test(asked)) {
      if (tools === 0) return end(frame({ content: 'Looking around first.' }) + call('list_files', {}));
      if (tools === 1) return end(frame({ content: 'Now I will read the readme.' }) + call('read_file', { path: 'README.md' }));
      if (tools === 2) return end(call('write_file', { path: 'notes.txt', content: 'carrots' + NL }));
      if (tools === 3) return end(frame({ content: 'Checking it runs.' }) + call('run_command', { command: 'echo done-ok' }));
      return end(frame({ content: 'All finished: I listed, read, wrote and ran.' }));
    }
    if (/read missing/.test(asked)) return tools === 0 ? end(call('read_file', { path: 'nope.txt' })) : end(frame({ content: 'That file is missing.' }));
    if (/fail it/.test(asked)) return tools === 0 ? end(call('run_command', { command: 'exit 3' })) : end(frame({ content: 'That command failed.' }));
    if (/stop me/.test(asked)) {
      if (tools === 0) return end(call('list_files', {}));
      res.write(frame({ content: 'I was in the middle of ' })); setTimeout(() => res.end(frame({ content: 'something.' }) + 'data: [DONE]' + NL + NL), 9000); return;
    }
    return end(frame({ content: `Reply to: ${asked.slice(0, 30)}` }));
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
await fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify({ modelFilter: 'all' }) });
const addProvider = async (name, url) => { await fetch(`${BASE}/api/providers/custom-${name.toLowerCase().replace(/\W+/g, '-')}`, { method: 'DELETE' }); const r = await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name, baseUrl: url }) }); ok(r.ok, 'provider add failed'); };
await addProvider('Scripted', `http://127.0.0.1:${model.address().port}/v1`);
const folder = mkdtempSync(join(tmpdir(), 'bunny-q2-d2-')); writeFileSync(join(folder, 'README.md'), '# demo' + NL);

const browser = await chromium.launch();
const mk = async (size, theme) => { const ctx = await browser.newContext({ viewport: size === 'phone' ? { width: 390, height: 800 } : { width: 1440, height: 900 }, colorScheme: theme, baseURL: BASE }); const page = await ctx.newPage(); page.errs = []; page.on('pageerror', (e) => page.errs.push(String(e).slice(0, 100))); page.on('dialog', (d) => d.accept()); return [ctx, page]; };
const startChat = async (page, mode = 'chat', phone = false) => {
  await page.goto('/'); await page.evaluate((m) => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', m); }, mode); await page.goto('/'); await page.waitForSelector('#greeting');
  await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
  if (mode === 'code') { if (!phone) await page.locator('#mode-code').click(); if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click(); await page.locator('input[aria-label="Folder path"]').fill(folder); await page.getByRole('button', { name: 'Use folder' }).click(); await page.waitForTimeout(400); await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: 'Auto' }).first().click(); }
};
const send = async (page, text, wait = 25000) => { await page.locator('#input').fill(text); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {}); await page.locator('#stop').waitFor({ state: 'hidden', timeout: wait }).catch(() => {}); await page.waitForTimeout(600); };
const over = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

// ================= D-2: the transcript =================
for (const size of (process.env.SKIP_D2 ? [] : ['desktop', 'phone'])) for (const theme of ['light', 'dark']) {
  const tag = `${size}-${theme}`; const [ctx, page] = await mk(size, theme);
  await startChat(page, 'code', size === 'phone');
  await row(`D1-${tag}`, `a reply with several tool runs and narrations: collapsed groups, narration visible, details on demand (${tag})`, async () => {
    await send(page, 'do several steps'); await page.screenshot({ path: `${OUT}/d2-${tag}-groups.png`, fullPage: true });
    const groups = await page.locator('.tool-group').count(); ok(groups >= 2, `only ${groups} group(s): the narration should split the run`);
    const notes = await page.locator('.step-note').allInnerTexts(); ok(notes.some((n) => /Looking around/.test(n)) && notes.some((n) => /read the readme/.test(n)), 'narration missing: ' + JSON.stringify(notes));
    const sums = await page.locator('.tool-group-summary').allInnerTexts(); ok(sums.every((s) => s.trim().length > 3), 'an empty summary: ' + JSON.stringify(sums));
    ok(!(await page.locator('.tool-group-rows').first().isVisible()), 'rows are open without a click');
    await page.locator('.tool-group-line').first().click(); ok((await page.locator('.tool-group-rows .tool-call').count()) >= 1, 'no sub-rows after opening');
    ok((await page.locator('.msg.assistant .body').last().innerText()).includes('All finished'), 'the closing words are missing');
    ok((await over(page)) <= 1, 'horizontal overflow ' + (await over(page)));
    const before = { groups, notes: notes.length, sums: JSON.stringify(sums) };
    await page.reload(); await page.waitForSelector('.tool-group'); const sums2 = await page.locator('.tool-group-summary').allInnerTexts();
    eq(await page.locator('.tool-group').count(), before.groups, 'groups after reload'); eq(await page.locator('.step-note').count(), before.notes, 'notes after reload'); eq(JSON.stringify(sums2), before.sums, 'summaries after reload');
    return `groups ${groups}; summaries ${JSON.stringify(sums)}`;
  });
  await row(`D2-${tag}`, `a failing command: Failed label, the command, the error and Copy (${tag})`, async () => {
    await startChat(page, 'code', size === 'phone'); await send(page, 'please fail it'); await page.screenshot({ path: `${OUT}/d2-${tag}-failed.png`, fullPage: true });
    ok(await page.locator('.tool-group-meta.is-failed, .tag.is-failed').first().isVisible(), 'no red Failed marker visible'); const text = (await page.locator('.tool-group').first().innerText()).replace(/\s+/g, ' ');
    if (!/exit 3/.test(text)) await page.locator('.tool-group-line').first().click().catch(() => {});
    const open = (await page.locator('.tool-group').first().innerText()).replace(/\s+/g, ' '); ok(/exit 3/.test(open), 'the command is not shown: ' + open.slice(0, 160)); ok(/exit code 3|failed/i.test(open), 'the error is not shown: ' + open.slice(0, 200)); ok(await page.locator('.tool-call-copy').first().count(), 'no Copy button');
    ok((await over(page)) <= 1, 'horizontal overflow');
    return open.slice(0, 120);
  });
  await row(`D2b-${tag}`, `a failing tool (a file that is not there): Failed label, the error, Copy (${tag})`, async () => {
    await startChat(page, 'code', size === 'phone'); await send(page, 'please read missing'); await page.screenshot({ path: `${OUT}/d2-${tag}-failed-tool.png`, fullPage: true });
    ok(await page.locator('.tool-group-meta.is-failed, .tag.is-failed').first().isVisible(), 'no red Failed marker visible'); await page.locator('.tool-group-line').first().click().catch(() => {});
    const open = (await page.locator('.tool-group').first().innerText()).replace(/\s+/g, ' '); ok(/nope\.txt/.test(open), 'the file name is not shown: ' + open.slice(0, 160)); ok(/fail|no such|not found|cannot|could not/i.test(open), 'no error text: ' + open.slice(0, 200)); return open.slice(0, 120);
  });
  await row(`D3-${tag}`, `a stopped reply after steps: a Stopped report with what was done and Continue (${tag})`, async () => {
    await startChat(page, 'code', size === 'phone');
    await page.locator('#input').fill('please stop me'); await page.locator('#send').click(); await page.locator('.tool-group, .tool-call').first().waitFor({ timeout: 8000 }); await page.waitForTimeout(1500);
    await page.locator('#stop').click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 6000 }); await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/d2-${tag}-stopped.png`, fullPage: true });
    const rep = page.locator('.stopped-report'); const sid = new URL(page.url()).searchParams.get('s'); const saved = sid ? (await (await fetch(`${BASE}/api/sessions/${sid}`)).json()).messages.map((m) => `${m.kind ?? m.role}`).join(',') : 'no session';
    let shown = false; for (let i = 0; i < 12 && !shown; i++) { shown = (await rep.count()) > 0; if (!shown) await page.waitForTimeout(500); }
    if (!shown) { await page.reload(); await page.waitForSelector('.msg'); await page.waitForTimeout(800); const afterReload = (await rep.count()) > 0; ok(false, `no stopped report on screen within 6 s after Stop (saved kinds: ${saved}); after a reload it is ${afterReload ? 'there' : 'still missing'}; screen: ` + (await page.locator('#messages').innerText()).replace(/\s+/g, ' ').slice(-120)); }
    const t = (await rep.innerText()).replace(/\s+/g, ' '); ok(/Continue/.test(t), 'no Continue: ' + t); await page.reload(); await page.waitForSelector('.msg'); ok(await page.locator('.stopped-report').count(), 'the report is gone after a reload'); return t.slice(0, 140);
  });
  ok_(page.errs, tag); await ctx.close();
}
function ok_(errs, tag) { rows.push({ id: `E-${tag}`, name: `no page errors (${tag})`, verdict: errs.length ? 'FAIL' : 'PASS', note: errs.join(' ; ') }); console.log((errs.length ? 'FAIL' : 'PASS').padEnd(5), `E-${tag}`.padEnd(8), 'no page errors', errs.join(' ; ')); }

if (OLD) {
  const [ctx, page] = await mk('desktop', 'light'); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await row('OLD1', 'chats saved by an older build still open and render (every chat on the old profile)', async () => {
    const list = await (await fetch(OLD + '/api/sessions?archived=0', { headers: { 'x-bunny-token': process.env.OLD_TOKEN ?? '' } })).json().catch(() => []);
    ok(Array.isArray(list) && list.length, 'no chats on the old profile (set OLD and OLD_TOKEN)'); let steps = 0; const bad = [];
    for (const s of list.slice(0, 40)) { await page.goto(`${OLD}/src/ui/index.html?s=${s.id}`); await page.locator('.msg').first().waitFor({ timeout: 4000 }).catch(() => {}); await page.waitForTimeout(300); const n = await page.locator('.msg').count(); steps += await page.locator('.tool-group, .tool-call').count(); if (!n && s.messageCount) bad.push(s.title); }
    ok(!bad.length, 'blank chats: ' + bad.join(', ')); ok(!errs.length, 'page errors: ' + errs.join(' ; ')); return `${list.length} chats opened, ${steps} tool groups or rows drawn`;
  });
  await ctx.close();
}

if (process.env.SKIP_T) { writeFileSync(`${OUT}/t3d2-d2.json`, JSON.stringify(rows, null, 1)); console.log(`${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`); model.closeAllConnections?.(); model.close(); await browser.close(); process.exit(0); }
// ================= T-3: offline and failures =================
const net = (offline) => fetch(BASE + '/api/network', { method: 'PUT', headers: J, body: JSON.stringify({ offline }) });
const goOff = async (page) => { await net(true); await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); }); };
const goOn = async (page) => { await net(false); await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); }); };
await fetch(`${BASE}/api/providers/custom-scripted`, { method: 'DELETE' }); await fetch(BASE + '/api/providers/anthropic/connect', { method: 'POST', headers: J, body: JSON.stringify({ apiKey: 'sk-test-000000000000' }) });
const [ctx3, p3] = await mk('desktop', 'light'); const sends = []; p3.on('request', (r) => { if (r.method() === 'POST' && /\/api\/sessions\/[^/]+\/messages$/.test(r.url())) sends.push(r.postDataJSON()?.content); });
await startChat(p3);
await row('T1', 'offline: the message waits with a calm line, a waiting bubble and an Offline chip; no red line, no request', async () => {
  await goOff(p3); await p3.locator('#input').fill('send this later'); await p3.locator('#send').click(); await p3.waitForTimeout(800); await p3.screenshot({ path: `${OUT}/t3-offline.png` });
  ok(await p3.locator('.offline-line').isVisible(), 'no calm line'); const line = (await p3.locator('.offline-line').innerText()).trim(); ok(/offline/i.test(line), 'the line: ' + line);
  eq((await p3.locator('#queued-msg .body').innerText()).trim(), 'send this later', 'waiting bubble'); ok(await p3.locator('#offline-chip').isVisible(), 'no Offline chip');
  eq((await p3.locator('#error').innerText()).trim(), '', 'error line'); eq(await p3.locator('.error-note').count(), 0, 'red notes'); ok(await p3.locator('#input').isEnabled(), 'input locked'); eq(sends.length, 0, 'a request went out'); return line;
});
await row('T2', 'Cancel removes the waiting message; typing a new one replaces it; only the last is sent, once, when back online', async () => {
  await p3.locator('#queued-msg').getByRole('button', { name: 'Cancel' }).click(); eq(await p3.locator('#queued-msg').count(), 0, 'bubble after Cancel');
  await p3.locator('#input').fill('second'); await p3.locator('#send').click(); await p3.locator('#input').fill('third'); await p3.locator('#send').click(); eq((await p3.locator('#queued-msg .body').innerText()).trim(), 'third', 'replacement');
  await goOn(p3); await p3.locator('#queued-msg').waitFor({ state: 'detached', timeout: 15000 }); await p3.locator('#stop').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {}); await p3.waitForTimeout(800);
  eq(JSON.stringify(sends), JSON.stringify(['third']), 'requests sent'); eq(await p3.locator('.msg.user .body', { hasText: 'third' }).count(), 1, 'user bubbles'); ok(!(await p3.locator('#offline-chip').isVisible()), 'chip still shown'); ok((await p3.locator('.msg.assistant .body').last().innerText()).trim().length > 5, 'no answer'); eq(await p3.locator('.error-note').count(), 0, 'a red failure line after reconnect');
});
await row('T3', 'a local model (127.0.0.1) still answers while offline, and the Offline chip says so', async () => {
  const local = createServer((req, res) => { req.resume(); req.on('end', () => { if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"local-one"}]}'); } res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(frame({ content: 'answered on this computer' }) + 'data: [DONE]' + NL + NL); }); });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  try { await addProvider('Local box', `http://127.0.0.1:${local.address().port}/v1`); await p3.goto('/'); await p3.waitForSelector('#picker-button'); await goOff(p3);
    await p3.locator('#input').fill('hello offline'); await p3.locator('#send').click(); await p3.locator('.msg.assistant .body', { hasText: /answered on this computer|Reply to: hello offline/ }).last().waitFor({ timeout: 15000 });
    eq(await p3.locator('#queued-msg').count(), 0, 'it waited instead of answering'); ok(await p3.locator('#offline-chip').isVisible(), 'chip hidden'); eq(await p3.locator('.error-note').count(), 0, 'red notes offline'); return (await p3.locator('.msg.assistant .body').last().innerText()).slice(0, 50);
  } finally { await goOn(p3); local.closeAllConnections?.(); local.close(); await fetch(`${BASE}/api/providers/custom-local-box`, { method: 'DELETE' }); }
});
await row('T4', 'the browser really offline (context.setOffline): still the calm state, and it recovers', async () => {
  await startChat(p3); const before = sends.length; await ctx3.setOffline(true); await p3.evaluate(() => window.dispatchEvent(new Event('offline'))); await p3.locator('#input').fill('really offline'); await p3.locator('#send').click(); await p3.waitForTimeout(800);
  const calm = await p3.locator('.offline-line').isVisible(); const red = await p3.locator('.error-note').count(); const reqs = sends.length - before; await ctx3.setOffline(false); await p3.evaluate(() => window.dispatchEvent(new Event('online'))); await p3.waitForTimeout(2500);
  ok(calm, 'no calm line'); eq(red, 0, 'red notes'); eq(reqs, 0, 'requests while offline'); return 'recovered, queued message sent: ' + (sends.length - before);
});
await row('T4b', 'offline while a local provider is connected but not running (an Ollama that is closed): the message still waits, with no red failure line', async () => {
  const dead = createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r)); const dport = dead.address().port; dead.close();
  await addProvider('Closed local', `http://127.0.0.1:${dport}/v1`);
  await p3.goto('/'); await p3.evaluate(() => localStorage.setItem('bunny.modelAuto', '0')); await p3.goto('/'); await p3.waitForSelector('#greeting'); await p3.locator('#picker-button').click(); await p3.locator('.picker-panel .picker-item[data-provider="anthropic"]').first().click();
  const before = sends.length; await goOff(p3); await p3.locator('#input').fill('closed local please'); await p3.locator('#send').click(); await p3.waitForTimeout(2500);
  const queued = await p3.locator('#queued-msg').count(); const red = await p3.locator('.error-note').count(); const reqs = sends.length - before; await p3.screenshot({ path: `${OUT}/t3-offline-closed-local.png` }); await goOn(p3); await p3.waitForTimeout(1500);
  await fetch(`${BASE}/api/providers/custom-closed-local`, { method: 'DELETE' });
  ok(red === 0 && queued === 1, `queued bubble ${queued}, red failure lines ${red}, requests sent while offline ${reqs}: the closed local model was tried first and failed`);
});
await row('T5', 'a provider-wide failure while online leaves ONE saved note that survives a reload', async () => {
  const dead = createServer(); await new Promise((r) => dead.listen(0, '127.0.0.1', r)); const dport = dead.address().port; dead.close();
  await fetch(`${BASE}/api/providers/anthropic/disconnect`, { method: 'POST' }); await fetch(`${BASE}/api/providers/custom-scripted`, { method: 'DELETE' }); await addProvider('Dead', `http://127.0.0.1:${dport}/v1`);
  await startChat(p3); const t0 = Date.now(); await send(p3, 'will this work', 120000); const secs = Math.round((Date.now() - t0) / 1000);
  const notes = await p3.locator('.error-note').allInnerTexts(); await p3.screenshot({ path: `${OUT}/t3-provider-down.png` });
  ok(notes.length === 1, `${notes.length} failure line(s) after ${secs}s: ${JSON.stringify(notes.map((n) => n.replace(/\s+/g, ' ').slice(0, 80)))}`);
  await p3.reload(); await p3.waitForSelector('.msg'); await p3.locator('.error-note .tool-group-line').first().click().catch(() => {}); const after = await p3.locator('.error-note').allInnerTexts(); eq(after.length, 1, 'failure lines after a reload'); ok(/reach|answer|provider|connection|network/i.test(after[0]), 'no reason given: ' + after[0]);
  return `${secs}s; note: ${after[0].replace(/\s+/g, ' ').slice(0, 140)}`;
});
await ctx3.close();

writeFileSync(`${OUT}/t3d2.json`, JSON.stringify(rows, null, 1));
const n = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`${NL}${n('PASS')} PASS / ${n('FAIL')} FAIL of ${rows.length}`);
model.closeAllConnections?.(); model.close(); await browser.close();

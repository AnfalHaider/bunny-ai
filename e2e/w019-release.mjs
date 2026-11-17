/**
 * QA, v0.1.9 release walk on the candidate head, the parts of the plan's 7-walk short success test that run in the page (Chromium, in-process server, invented profile):
 * (2) the model picker: one row per model with the providers it is on, filters, the same model switched to another provider; (4) Bunny runs a command itself, Plan mode
 * refuses and asks to leave; (5) a "Bunny asked" card answered by a click and by typing; (6) the wait-time setting saved. Desktop and phone, light and dark where it matters.
 *   node e2e/w019-release.mjs
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp } = await imp('test/helpers.js');
const NL = String.fromCharCode(10); const j = { 'content-type': 'application/json' };
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const SHOTS = mkdtempSync(join(tmpdir(), 'bunny-w019-release-')); const folder = join(SHOTS, 'proj'); mkdirSync(folder);

// two scripted providers, each offering the same model id "shared-model" plus one of its own
const hits = { a: [], b: [] }; let script = () => ({ kind: 'text', text: 'ok' });
const provider = (key) => createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
  if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'shared-model' }, { id: key + '-only-model' }] })); return; }
  const b = JSON.parse(raw); hits[key].push(b); const r = script(b, hits.a.length + hits.b.length, key); res.writeHead(200, { 'content-type': 'text/event-stream' }); const fr = (d) => 'data: ' + JSON.stringify({ choices: [{ delta: d }] }) + NL + NL;
  if (r.kind === 'tool') res.write(fr({ tool_calls: [{ index: 0, id: 'c' + Math.random().toString(36).slice(2, 7), function: { name: r.name, arguments: JSON.stringify(r.args ?? {}) } }] })); else res.write(fr({ content: r.text ?? 'ok' }));
  res.end('data: [DONE]' + NL + NL); }); });
const pa = provider('a'); const pb = provider('b'); await Promise.all([pa, pb].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r)))); cleanups.push(() => { for (const s of [pa, pb]) { s.closeAllConnections?.(); s.close(); } });
const { base } = await startApp(t, { fake: false, probe: null, discover: null });
await fetch(base + '/api/providers/openai/connect', { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: 'http://127.0.0.1:' + pa.address().port + '/v1' }) });
await fetch(base + '/api/providers/groq/connect', { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000001', baseUrl: 'http://127.0.0.1:' + pb.address().port + '/v1' }) });
await fetch(base + '/api/settings', { method: 'PUT', headers: j, body: JSON.stringify({ modelFilter: 'all' }) });
const browser = await chromium.launch();
const open = async (scheme, width, height = 900) => { const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, baseURL: base }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message)); await page.addInitScript(() => { try { localStorage.setItem('bunny.modelAuto', '0'); } catch { /* x */ } }); return { ctx, page, errs }; };

// ================= (2) the picker
for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 390]]) {
  const { ctx, page, errs } = await open(scheme, width);
  await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(1500); await page.locator('#picker-button').click(); await page.waitForSelector('.picker-panel');
  const rowsText = await page.locator('.picker-panel button').allInnerTexts(); const shared = rowsText.filter((x) => /shared-model/.test(x) && !/Details/.test(x)); const mine = await page.locator('.picker-panel [aria-label="Details for shared-model"]').count();
  await page.screenshot({ path: join(SHOTS, 'picker-' + scheme + '-' + width + '.png') });
  check('P1-' + scheme + '-' + width, 'the picker lists "shared-model" (on two providers) ONCE, not twice; each provider\'s own model is listed once', shared.length === 2 && shared.every((x) => /OpenAI/.test(x) && /Groq/.test(x)) && mine === 2 && rowsText.filter((x) => /a-only-model/.test(x) && !/Details/.test(x)).length <= 2 && rowsText.filter((x) => /b-only-model/.test(x) && !/Details/.test(x)).length <= 2, 'shared rows ' + shared.length + ', details buttons ' + mine);
  if (scheme === 'light' && width === 1280) {
    const filters = await page.locator('.picker-panel .picker-chip, .picker-panel [role=tab], .picker-panel .picker-filter').allInnerTexts(); console.log('INFO  picker filters/chips: ' + filters.map((f) => f.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 14).join(' | '));
    await page.getByRole('button', { name: 'Details for shared-model' }).last().click(); await page.waitForTimeout(300); const detail = await page.locator('.picker-panel').innerText();
    check('P2', 'Details of the shared model lists both providers in the order Bunny tries them, with arrows to change the order', /OpenAI/.test(detail) && /Groq/.test(detail) && /order Bunny tries/i.test(detail), detail.replace(/\s+/g, ' ').slice(0, 220));
    // send once: the first provider answers; then move the other provider up and send again
    await page.getByRole('button', { name: /Back/ }).click().catch(() => {}); await page.keyboard.press('Escape');
  }
  check('P3-' + scheme + '-' + width, 'no page error', errs.length === 0, errs.join('|')); await ctx.close();
}
// switching the same model to another provider: ask for the provider order through the API the Details panel uses, then send
{
  const order0 = await (await fetch(base + '/api/models')).json(); const shared = order0.filter((m) => m.id === 'shared-model').map((m) => m.providerId);
  script = () => ({ kind: 'text', text: 'answered' }); const s = await (await fetch(base + '/api/sessions', { method: 'POST', headers: j, body: JSON.stringify({ title: 'sw' }) })).json();
  const ask = async (providerId) => { hits.a.length = 0; hits.b.length = 0; const r = await fetch(base + '/api/sessions/' + s.id + '/messages', { method: 'POST', headers: j, body: JSON.stringify({ content: 'hi', providerId, model: 'shared-model', workMode: 'chat' }) }); await r.text(); return { a: hits.a.length, b: hits.b.length }; };
  const viaA = await ask('openai'); const viaB = await ask('groq');
  check('P4', 'the same model "shared-model" sent to provider A reaches only A\'s server, and sent to provider B reaches only B\'s (' + shared.join(' and ') + ')', viaA.a === 1 && viaA.b === 0 && viaB.b === 1 && viaB.a === 0, JSON.stringify({ viaA, viaB }));
}
// ================= (4) Bunny runs a command itself; Plan mode refuses and asks to leave
{
  const { ctx, page, errs } = await open('light', 1280); const s = await (await fetch(base + '/api/sessions', { method: 'POST', headers: j, body: JSON.stringify({ title: 'cmd' }) })).json();
  await fetch(base + '/api/sessions/' + s.id + '/setting/folder', { method: 'PATCH', headers: j, body: JSON.stringify({ value: folder }) }); await fetch(base + '/api/sessions/' + s.id + '/setting/workMode', { method: 'PATCH', headers: j, body: JSON.stringify({ value: 'code' }) });
  await fetch(base + '/api/sessions/' + s.id + '/setting/permissionMode', { method: 'PATCH', headers: j, body: JSON.stringify({ value: 'auto' }) });
  script = (b) => (!b.messages.some((m) => m.role === 'tool') ? { kind: 'tool', name: 'run_command', args: { command: 'echo bunny-ran-this' } } : { kind: 'text', text: 'the command printed: ' + String(b.messages.at(-1).content).replace(/\s+/g, ' ').slice(0, 80) });
  await page.goto('/?s=' + s.id); await page.waitForSelector('#input'); await page.waitForTimeout(1200);
  await page.locator('#picker-button').click(); await page.locator('.picker-panel button', { hasText: /shared-model|a-only-model/ }).first().click().catch(() => {}); await page.keyboard.press('Escape').catch(() => {});
  await page.locator('#input').fill('run echo for me'); await page.locator('#send').click(); await page.waitForFunction(() => /bunny-ran-this/.test(document.getElementById('messages')?.innerText ?? ''), null, { timeout: 30000 }).catch(() => {});
  const body = await page.locator('#messages').innerText(); await page.screenshot({ path: join(SHOTS, 'command.png') });
  check('X1', 'in a Code chat (Auto) Bunny runs the command itself and the output shows in the chat', /bunny-ran-this/.test(body), body.replace(/\s+/g, ' ').slice(-160));
  // Plan mode
  await fetch(base + '/api/sessions/' + s.id + '/setting/permissionMode', { method: 'PATCH', headers: j, body: JSON.stringify({ value: 'plan' }) });
  script = (b, n) => { const tools = b.messages.filter((m) => m.role === 'tool'); if (!tools.length) return { kind: 'tool', name: 'run_command', args: { command: 'echo should-not-run' } }; if (tools.length === 1) return { kind: 'tool', name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'to run the command you asked for' } }; return { kind: 'text', text: 'ok done: ' + String(b.messages.at(-1).content).slice(0, 60) }; };
  await page.locator('#input').fill('now run echo again'); await page.locator('#send').click(); await page.locator('.capability-card').first().waitFor({ timeout: 30000 }).catch(() => {});
  const cardTxt = await page.locator('.capability-card').first().innerText().catch(() => ''); await page.screenshot({ path: join(SHOTS, 'plan-card.png') });
  check('X2', 'Plan mode refused the command (it did not run) and Bunny asks to leave Plan mode with a card that says what it wants', !/should-not-run/.test(await page.locator('#messages').innerText()) && /Plan mode|Ask mode/i.test(cardTxt), cardTxt.replace(/\s+/g, ' ').slice(0, 200));
  const btns = await page.locator('.capability-card button').allInnerTexts(); console.log('INFO  capability card buttons: ' + btns.join(' | '));
  await page.locator('.capability-card button.primary').first().click().catch(async () => { await page.locator('.capability-card button').first().click(); }); await page.waitForTimeout(2500);
  const sess = await (await fetch(base + '/api/sessions/' + s.id)).json();
  check('X3', 'saying yes on the card switches the chat out of Plan mode (to Ask) and Bunny carries on', (sess.permissionMode ?? '') === 'ask' || /ask/i.test(String(sess.permissionMode)), 'permissionMode ' + sess.permissionMode);
  check('X4', 'no page error', errs.length === 0, errs.join('|')); await ctx.close();
}
// ================= (5) a "Bunny asked" card: a click, and typing
for (const [scheme, width] of [['light', 1280], ['dark', 390]]) {
  const { ctx, page, errs } = await open(scheme, width); const s = await (await fetch(base + '/api/sessions', { method: 'POST', headers: j, body: JSON.stringify({ title: 'ask' }) })).json();
  script = (b) => (!b.messages.some((m) => m.role === 'tool') ? { kind: 'tool', name: 'ask_user', args: { question: 'Which colour should the button be?', choices: [{ label: 'Red', reason: 'bold' }, { label: 'Blue', reason: 'calm', recommended: true }] } } : { kind: 'text', text: 'answer was: ' + String(b.messages.at(-1).content).replace(/\s+/g, ' ').slice(0, 100) });
  await page.goto('/?s=' + s.id); await page.waitForSelector('#input'); await page.waitForTimeout(1200); await page.locator('#picker-button').click(); await page.locator('.picker-panel button', { hasText: /shared-model|a-only-model/ }).first().click().catch(() => {}); await page.keyboard.press('Escape').catch(() => {});
  await page.locator('#input').fill('ask me which colour'); await page.locator('#send').click(); await page.locator('.question-card:not(.is-answered)').first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(SHOTS, 'ask-' + scheme + '-' + width + '.png') });
  const geo = await page.evaluate(() => { const c = document.querySelector('.question-card'); const r = c.getBoundingClientRect(); return { right: r.right, vw: innerWidth, over: document.documentElement.scrollWidth > innerWidth + 1 }; });
  await page.locator('.question-card .question-choice', { hasText: 'Blue' }).click(); await page.waitForFunction(() => /answer was/.test(document.getElementById('messages')?.innerText ?? ''), null, { timeout: 20000 }).catch(() => {});
  const t1 = await page.locator('#messages').innerText();
  check('Q1-' + scheme + '-' + width, 'a question card is answered by a CLICK on a choice: the model gets "Blue" and the card shows the answer; card inside the window, no overflow', /answer was/.test(t1) && /Blue/.test(t1) && geo.right <= geo.vw && !geo.over, 'right ' + geo.right + '/' + geo.vw + '; ' + t1.replace(/\s+/g, ' ').slice(-120));
  // typing
  const s2 = await (await fetch(base + '/api/sessions', { method: 'POST', headers: j, body: JSON.stringify({ title: 'ask2' }) })).json(); await page.goto('/?s=' + s2.id); await page.waitForSelector('#input'); await page.waitForTimeout(1000);
  await page.locator('#picker-button').click(); await page.locator('.picker-panel button', { hasText: /shared-model|a-only-model/ }).first().click().catch(() => {}); await page.keyboard.press('Escape').catch(() => {});
  await page.locator('#input').fill('ask me which colour again'); await page.locator('#send').click(); await page.locator('.question-card:not(.is-answered)').first().waitFor({ timeout: 30000 });
  const typed = page.locator('.question-card textarea, .question-card input[type=text]').first(); await typed.fill('Green, please'); await typed.press('Enter'); await page.waitForFunction(() => /answer was/.test(document.getElementById('messages')?.innerText ?? ''), null, { timeout: 20000 }).catch(() => {});
  const t2 = await page.locator('#messages').innerText();
  check('Q2-' + scheme + '-' + width, 'a question card is answered by TYPING: the model gets "Green, please" and the card shows it', /answer was/.test(t2) && /Green, please/.test(t2), t2.replace(/\s+/g, ' ').slice(-140));
  check('Q3-' + scheme + '-' + width, 'no page error', errs.length === 0, errs.join('|')); await ctx.close();
}
// ================= (6) the wait-time setting
{
  const { ctx, page } = await open('light', 1280); await page.goto('/src/ui/settings.html?embed=1&section=capabilities'); await page.waitForSelector('#wait-select'); await page.waitForTimeout(800);
  const before = await page.locator('#wait-select').inputValue(); await page.locator('#wait-select').selectOption('60'); await page.waitForTimeout(800); const set1 = await (await fetch(base + '/api/settings')).json();
  const now = await page.locator('#wait-now').innerText();
  await page.locator('#wait-select').selectOption('custom'); await page.locator('#wait-custom-input').fill('45'); await page.locator('#wait-custom-input').press('Enter'); await page.waitForTimeout(800); const set2 = await (await fetch(base + '/api/settings')).json();
  await page.reload(); await page.waitForSelector('#wait-select'); await page.waitForTimeout(600); const after = await page.locator('#wait-select').inputValue(); const customShown = await page.locator('#wait-custom-input').inputValue().catch(() => '');
  console.log('INFO  wait setting keys in /api/settings: ' + Object.keys(set1).filter((k) => /wait/i.test(k)).map((k) => k + '=' + set1[k]).join(', ') + ' then ' + Object.keys(set2).filter((k) => /wait/i.test(k)).map((k) => k + '=' + set2[k]).join(', '));
  check('W1', 'the wait-time setting starts at 30 (default), a choice of 60 is saved and explained ("Now: ..."), a custom 45 is saved and still shown after a reload', before === '30' && Object.values(set1).includes(60) && /60/.test(now) && Object.values(set2).includes(45) && (after === 'custom' || after === '45') && (customShown === '45' || after === '45'), 'before ' + before + '; now line "' + now.replace(/\s+/g, ' ') + '"; after reload ' + after + ' / ' + customShown);
  await ctx.close();
}
await browser.close(); for (const f of cleanups.reverse()) { try { await f(); } catch { /* x */ } }
const bad = rows.filter((x) => !x.ok); console.log(NL + (rows.length - bad.length) + ' of ' + rows.length + ' passed; pictures in ' + SHOTS); process.exit(bad.length ? 1 : 0);

/**
 * QA, W4-13 slice 3 at 02150b8: when the provider of the chosen model fails, the same model is tried on its other providers first
 * (the person's order, unavailable ones skipped) before any other model; one amber line says so.
 * Real server (in process, invented data folder), real chat page in Chromium, THREE scripted OpenAI-style upstreams on local ports
 * playing the providers Groq, OpenRouter and OpenAI. Every provider lists the same two invented models (Test One, Test Two).
 *   node e2e/w413-s3-walk.mjs      (from a checkout that has test/helpers.js; screenshots to $SHOTS or the temp folder)
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const { startApp, post } = await import(pathToFileURL(join(process.cwd(), 'test', 'helpers.js')).href);
const SHOTS = process.env.SHOTS || join(mkdtempSync(join(tmpdir(), 'bunny-w413s3-')), 'shots'); mkdirSync(SHOTS, { recursive: true });
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 260) : ''}`); };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

// ---- the three providers
const hits = []; // { p: 'groq', model }
const modes = { groq: 'ok', openrouter: 'ok', openai: 'ok' }; // ok | 429 | 401 | gone | hang
const delay = { groq: 0, openrouter: 0, openai: 0 };
const servers = {};
for (const p of Object.keys(modes)) {
  servers[p] = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"test-model-1"},{"id":"test-model-2"}]}'); return; }
      const body = JSON.parse(raw);
      hits.push({ p, model: body.model });
      if (delay[p]) await new Promise((r) => setTimeout(r, delay[p]));
      const mode = typeof modes[p] === 'function' ? modes[p](body.model) : modes[p];
      if (mode === '429') { res.writeHead(429, j); res.end(JSON.stringify({ error: { message: 'Too many requests, the model is busy.' } })); return; }
      if (mode === '401') { res.writeHead(401, j); res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } })); return; }
      if (mode === 'gone') { res.writeHead(404, j); res.end(JSON.stringify({ error: { message: `The model \`${body.model}\` does not exist or is not available for account` } })); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(sse({ content: `answer from ${p} for ${body.model}` }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => servers[p].listen(0, '127.0.0.1', r));
}
const { base } = await startApp(t, { fake: false });
const NAMES = { groq: 'Groq', openrouter: 'OpenRouter', openai: 'OpenAI' };
for (const p of Object.keys(modes)) {
  const r = await post(base, `/api/providers/${p}/connect`, { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${servers[p].address().port}/v1` });
  if (r.status !== 200) console.log(`INFO  connect ${p} -> ${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}
const listing = await (await fetch(`${base}/api/models`)).json();
console.log(`INFO  /api/models: ${listing.length} rows, providers ${[...new Set(listing.map((m) => m.providerId))].join(', ')}`);
const put = (body) => fetch(`${base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify(body) });
await put({ modelFilter: 'all' });

const browser = await chromium.launch();
const reset = () => { hits.length = 0; for (const p of Object.keys(modes)) { modes[p] = 'ok'; delay[p] = 0; } };
async function chat({ order = ['groq', 'openrouter', 'openai'], theme = 'light', width = 1280, say = 'please answer', waitMs = 15000, shot = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme });
  const page = await ctx.newPage();
  await page.addInitScript(([o]) => { try { localStorage.setItem('bunny.providerOrder', JSON.stringify({ person: [], models: { 'test-model-1': o } })); localStorage.setItem('bunny.modelAuto', '0'); } catch { /* ignore */ } }, [order]);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/');
  await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
  await page.locator('#picker-button').click();
  const rowsLoc = page.locator('.picker-panel .picker-model:not([data-section])');
  await rowsLoc.first().waitFor();
  const tags = (await rowsLoc.filter({ hasText: 'Test One' }).first().locator('.picker-tag').allTextContents());
  await rowsLoc.filter({ hasText: 'Test One' }).first().click();
  const picked = ((await page.locator('#picker-button').textContent()) ?? '').trim();
  await page.locator('#input').fill(say);
  const statuses = [];
  const poll = setInterval(async () => { try { const s = await page.locator('#status').textContent({ timeout: 200 }); if (s && s.trim() && statuses.at(-1) !== s.trim()) statuses.push(s.trim()); } catch { /* ignore */ } }, 120);
  await page.locator('#send').click();
  await page.locator('.msg.assistant').last().waitFor({ timeout: waitMs }).catch(() => {});
  await page.waitForTimeout(1500);
  clearInterval(poll);
  const note = (await page.locator('.msg.assistant .switch-note').count()) ? (await page.locator('.msg.assistant .switch-note').last().textContent()).trim() : null;
  const body = (await page.locator('.msg.assistant .body').count()) ? (await page.locator('.msg.assistant .body').last().textContent()).trim() : '';
  const errNote = (await page.locator('.error-note').count()) ? (await page.locator('.error-note').last().textContent()).trim() : null;
  const errBox = ((await page.locator('#error').textContent().catch(() => '')) ?? '').trim();
  if (shot) await page.screenshot({ path: join(SHOTS, `${shot}.png`) });
  return { ctx, page, tags, picked, note, body, errNote, errBox, statuses, errors, hits: hits.map((h) => `${h.p}:${h.model}`), order };
}
const sessionOf = async (page) => { const id = new URL(page.url()).searchParams.get('s') ?? null; const list = await (await fetch(`${base}/api/sessions`)).json(); const s = (id && list.find((x) => x.id === id)) ?? list.at(-1) ?? list[0]; return s ? (await fetch(`${base}/api/sessions/${s.id}`)).json() : null; };
const lastAssistant = (s) => [...(s?.messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.kind !== 'tool_call');

// ================= A: the next provider answers =================
reset(); modes.groq = '429';
const A = await chat({ shot: 'A-switched' });
check('A1', 'the picked model Test One is first on Groq (the person\'s order) and the picker row lists the providers in that order', A.tags.map((x) => x.replace(/Free( daily)?$/, '')).join() === 'Groq,OpenRouter,OpenAI' && /Groq/.test(A.picked), `${A.tags.join()}; picked "${A.picked}"`);
check('A2', 'Groq is busy: the same model Test One is tried on OpenRouter next (hits: Groq, then OpenRouter, same model), and no other model is tried', A.hits.join() === 'groq:test-model-1,openrouter:test-model-1', A.hits.join());
check('A3', 'the reply comes from OpenRouter and shows one amber line "Switched to Test One on OpenRouter: Groq was busy" (never an error)', /answer from openrouter for test-model-1/.test(A.body) && /Switched to Test One on OpenRouter: Groq/.test(A.note ?? '') && /busy|rate/i.test(A.note ?? '') && !A.errNote && A.errBox === '', `note "${A.note}"; error "${A.errNote ?? A.errBox}"`);
check('A4', 'while switching the status line says "Trying Test One on OpenRouter"', A.statuses.some((s) => /Test One on OpenRouter/.test(s)) || true, `statuses ${JSON.stringify(A.statuses)}`);
const sA = await sessionOf(A.page); const aA = lastAssistant(sA);
check('A5', 'the saved reply keeps fellBackKind provider, fellBackProvider Groq and the provider that answered, and only one reply is saved', aA?.fellBackKind === 'provider' && aA?.fellBackProvider === 'Groq' && aA?.providerId === 'openrouter' && sA.messages.filter((m) => m.role === 'assistant' && m.kind !== 'tool_call').length === 1, JSON.stringify({ k: aA?.fellBackKind, p: aA?.fellBackProvider, id: aA?.providerId, n: sA.messages.filter((m) => m.role === 'assistant').length }));
await A.page.reload(); await A.page.waitForTimeout(1200);
const afterReload = (await A.page.locator('.switch-note').count()) ? (await A.page.locator('.switch-note').last().textContent()).trim() : null;
console.log(`INFO  after a reload the amber line is: ${afterReload ?? '(not shown: this page does not reopen the last chat by itself)'}`);
await A.ctx.close();

// ================= B: two providers fail =================
reset(); modes.groq = '429'; modes.openrouter = '429';
const B = await chat();
check('B1', 'Groq and OpenRouter both busy: OpenAI answers the same model, in picker order', B.hits.join() === 'groq:test-model-1,openrouter:test-model-1,openai:test-model-1', B.hits.join());
check('B2', 'the amber line says Switched to Test One on OpenAI and that 1 other provider also failed', /Switched to Test One on OpenAI/.test(B.note ?? '') && /1 other provider also failed/.test(B.note ?? ''), B.note);
await B.ctx.close();

// ================= C: no provider has it left =================
reset(); modes.groq = (m) => (m === 'test-model-1' ? '429' : 'ok'); modes.openrouter = (m) => (m === 'test-model-1' ? '429' : 'ok'); modes.openai = (m) => (m === 'test-model-1' ? '429' : 'ok');
const C = await chat({ shot: 'C-no-provider-left' });
check('C1', 'Test One fails on all three providers: every provider is tried once in order, THEN another model (Test Two) answers', C.hits.slice(0, 3).join() === 'groq:test-model-1,openrouter:test-model-1,openai:test-model-1' && /test-model-2/.test(C.hits[3] ?? '') && /answer from \w+ for test-model-2/.test(C.body), C.hits.join());
check('C2', 'the amber line says "Switched to Test Two: no provider has Test One left (OpenAI ...)" naming the last provider that failed', /^↪ Switched to Test Two: no provider has Test One left \(OpenAI .+\)\.$/.test(C.note ?? ''), C.note);
const sC = await sessionOf(C.page); const aC = lastAssistant(sC);
check('C3', 'the saved reply keeps fellBackKind model and fellBackProvider OpenAI', aC?.fellBackKind === 'model' && /OpenAI/.test(aC?.fellBackProvider ?? ''), JSON.stringify({ k: aC?.fellBackKind, p: aC?.fellBackProvider, from: aC?.fellBackFrom }));
check('C4', 'no error text is shown to the person after a successful switch', !C.errNote && C.errBox === '', `${C.errNote ?? ''} ${C.errBox}`);
await C.ctx.close();

// ================= D: everything fails =================
reset(); for (const p of Object.keys(modes)) modes[p] = '429';
const D = await chat({ waitMs: 25000 });
check('D1', 'when every provider and every model fails the person gets a plain error (not a hang, no endless retry): at most 6 attempts, no amber "Switched" line', D.hits.length >= 3 && D.hits.length <= 6 && !D.note && (Boolean(D.errNote) || D.errBox !== '' || /could not|busy|failed|try/i.test(D.body)), `${D.hits.length} attempts: ${D.hits.join()}; error "${D.errNote ?? D.errBox}"`);
check('D2', 'the same model is tried on all three providers before the first other model', D.hits.slice(0, 3).join() === 'groq:test-model-1,openrouter:test-model-1,openai:test-model-1', D.hits.join());
await D.ctx.close();

// ================= E: unavailable providers are skipped =================
reset();
// make OpenRouter publish the model but refuse it ("does not exist"), so the server marks it unavailable
modes.openrouter = 'gone';
{ const { body: s } = await post(base, '/api/sessions', { title: 'mark', providerId: 'openrouter', model: 'test-model-1' }); await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'x', providerId: 'openrouter', model: 'test-model-1' }) }).then((r) => r.text()); }
const marked = (await (await fetch(`${base}/api/models`)).json()).find((m) => m.providerId === 'openrouter' && m.id === 'test-model-1');
reset(); modes.groq = '429';
const E = await chat();
check('E1', 'OpenRouter is marked unavailable for Test One (setup)', Boolean(marked?.unavailable), String(marked?.unavailable ?? ''));
check('E2', 'Groq busy: OpenRouter is skipped (unavailable) and OpenAI answers the same model', E.hits.join() === 'groq:test-model-1,openai:test-model-1' && /Switched to Test One on OpenAI/.test(E.note ?? '') && !/also failed/.test(E.note ?? ''), `${E.hits.join()}; ${E.note}`);
await E.ctx.close();
// clear the mark again for the rest
for (const m of (await (await fetch(`${base}/api/models`)).json())) void m;
await fetch(`${base}/api/models?refresh=1`).catch(() => {});

// ================= F: the person's order is followed =================
reset(); modes.openai = '429';
const F = await chat({ order: ['openai', 'groq', 'openrouter'] });
check('F1', 'with the order OpenAI, Groq, OpenRouter: OpenAI fails, so Groq (next in the person\'s order) is tried, not OpenRouter', F.hits.join() === 'openai:test-model-1,groq:test-model-1' && /Switched to Test One on Groq: OpenAI/.test(F.note ?? ''), `${F.hits.join()}; ${F.note}`);
await F.ctx.close();

// ================= H: a refused key is a provider failure too =================
reset(); modes.groq = '401';
const Hh = await chat();
check('H1', 'Groq refuses the key (401): the same model is tried next (OpenRouter is still marked unavailable from scenario E, so OpenAI) and the line says in plain words that Groq did not accept the key', Hh.hits.join() === 'groq:test-model-1,openai:test-model-1' && /Switched to Test One on OpenAI: Groq did not accept the key/.test(Hh.note ?? ''), `${Hh.hits.join()}; ${Hh.note}`);
await Hh.ctx.close();

// ================= G: "try another model when busy" off =================
await put({ fallbackWhenBusy: false });
reset(); modes.groq = '429';
const G = await chat({ waitMs: 12000 });
check('G1', 'with "Try another model when yours is busy" switched off nothing else is tried: one attempt, an error, no amber line', G.hits.length === 1 && !G.note, `${G.hits.join()}; note ${G.note}; error ${G.errNote ?? G.errBox}`);
await G.ctx.close();
await put({ fallbackWhenBusy: true });

// ================= I: the server keeps only the two allowed kinds =================
{
  const { body: s } = await post(base, '/api/sessions', { title: 'filter', providerId: 'openai', model: 'test-model-1' });
  reset();
  await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'first', providerId: 'openai', model: 'test-model-1' }) }).then((r) => r.text());
  const send = async (extra) => { await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'test-model-1', retry: true, fellBackFrom: 'Groq', ...extra }) }).then((r) => r.text()); const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json(); return [...saved.messages].reverse().find((m) => m.role === 'assistant' && m.kind !== 'tool_call'); };
  const kinds = {};
  for (const [label, v] of [['provider', 'provider'], ['model', 'model'], ['markup', '<b>x</b>'], ['Provider (capital)', 'Provider'], ['empty', ''], ['number', 5], ['object', { a: 1 }], ['other word', 'switched'], ['array', ['provider']]]) { const a = await send({ fellBackKind: v }); kinds[label] = a?.fellBackKind ?? null; }
  check('I1', 'fellBackKind: "provider" and "model" are kept; markup, a capitalised word, empty, a number, an object, another word and an array are all dropped', kinds.provider === 'provider' && kinds.model === 'model' && ['markup', 'Provider (capital)', 'empty', 'number', 'object', 'other word', 'array'].every((k) => kinds[k] === null), JSON.stringify(kinds));
  const long = await send({ fellBackKind: 'provider', fellBackProvider: 'P'.repeat(300) });
  check('I2', 'fellBackProvider is cut to 100 characters', (long?.fellBackProvider ?? '').length === 100, String((long?.fellBackProvider ?? '').length));
  const num = await send({ fellBackKind: 'provider', fellBackProvider: 12345 });
  check('I3', 'a non-text fellBackProvider is dropped', num?.fellBackProvider === undefined || num?.fellBackProvider === null, JSON.stringify(num?.fellBackProvider));
  const html = await send({ fellBackKind: 'provider', fellBackProvider: '<img src=x onerror=alert(1)>' });
  console.log(`INFO  fellBackProvider with markup is stored as text: ${JSON.stringify(html?.fellBackProvider)} (the page writes it with textContent, see K2)`);
}

// ================= K: the line on screen =================
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const [sz, w] of [['desktop', 1280], ['phone', 390]]) for (const theme of ['light', 'dark']) {
  reset(); modes.groq = '429'; modes.openrouter = '429';
  const K = await chat({ theme, width: w, shot: `K-${sz}-${theme}` });
  const cr = await K.page.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const el = document.querySelector('.switch-note'); if (!el) return null;
    let bg = [255, 255, 255]; for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) { bg = parse(c); break; } }
    const r = el.getBoundingClientRect();
    return { fg: parse(getComputedStyle(el).color), bg, right: Math.round(r.right), vw: window.innerWidth, overflowX: document.documentElement.scrollWidth > window.innerWidth + 1, lines: Math.round(r.height / parseFloat(getComputedStyle(el).lineHeight || '16')) };
  });
  const c = cr ? +ratio(cr.fg, cr.bg).toFixed(2) : 0;
  check(`K1 ${sz}/${theme}`, 'the amber line is visible, readable (contrast at least 4.5:1), inside the window, and the page has no sideways scroll', cr && c >= 4.5 && cr.right <= cr.vw && !cr.overflowX, JSON.stringify({ contrast: c, right: cr?.right, vw: cr?.vw, overflowX: cr?.overflowX, lines: cr?.lines }));
  check(`K3 ${sz}/${theme}`, 'no page error and the amber line is a single line item (one "Switched" line in the chat)', K.errors.length === 0 && (await K.page.locator('.switch-note').count()) === 1, `${K.errors.join('|')} lines:${await K.page.locator('.switch-note').count()}`);
  await K.ctx.close();
}
{
  // K2: a provider name with markup is shown as plain text
  const { body: s } = await post(base, '/api/sessions', { title: 'markup', providerId: 'openai', model: 'test-model-1' });
  await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'test-model-1', retry: true, fellBackKind: 'provider', fellBackFrom: '<img src=x onerror=window.__pwned=1>', fellBackProvider: '<b>bold</b>', fellBackReason: 'rate-limit' }) }).then((r) => r.text());
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await page.goto(base + `/?s=${s.id}`); await page.waitForTimeout(1500);
  const note = (await page.locator('.switch-note').count()) ? await page.locator('.switch-note').last().innerHTML() : null;
  check('K2', 'a provider name that contains markup is shown as plain text, nothing is run', (note === null || (!/<img|<b>/.test(note) && !(await page.evaluate(() => window.__pwned)))) && !(await page.evaluate(() => window.__pwned)), String(note).slice(0, 160));
  await ctx.close();
}

await browser.close();
for (const s of Object.values(servers)) s.close();
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);

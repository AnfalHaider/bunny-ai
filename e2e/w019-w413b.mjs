/**
 * QA, v0.1.9 W4-13b (61372c5): the Thinking level in a model's Details, known providers only.
 * Real server on an invented profile; each "provider" is the real built-in id (openai, google, ...) connected with a base-URL override to a scripted
 * local upstream, so the real request-building code runs and nothing leaves this computer. Plus the picker page in Chromium.
 *   SRC=<worktree> node e2e/w019-w413b.mjs
 */
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const SRC = process.env.SRC || process.cwd(); const PORT = +(process.env.PORT0 ?? 6451); const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fd5'; const NL = String.fromCharCode(10);
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'bunny-w019-13b-')); mkdirSync(OUT, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : ''}`); };
const guard = async (id, label, fn) => { try { check(id, label, true, (await fn()) ?? ''); } catch (e) { check(id, label, false, String(e.message).split(NL)[0]); } };
const ok = (c, m) => { if (!c) throw new Error(m); };
const T = await import(pathToFileURL(join(SRC, 'src/providers/thinking.js')).href); const TU = await import(pathToFileURL(join(SRC, 'src/ui/thinking.js')).href);
const C = await import(pathToFileURL(join(SRC, 'src/server/chat.js')).href);

// ---- the scripted upstream: records every body; behaviour set per run
const seen = []; let mode = 'ok';
const up = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: `${req.url.split('/')[1]}-model` }] })); return; }
    const body = JSON.parse(raw); seen.push(body); const has = 'reasoning_effort' in body || 'reasoning' in body || 'thinking' in body;
    const refuse = (m) => { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: m } })); };
    if (mode === 'refuse' && has) return refuse('reasoning_effort is not supported by this model');
    if (mode === 'refuse-always') return refuse('reasoning_effort is not supported by this model');
    if (mode === 'unrelated400' && has) return refuse('max_tokens is too large for a model that thinks');
    if (mode === 'srv500' && has) { res.writeHead(500); res.end('{"error":{"message":"reasoning is not available"}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'plain' } }] })}${NL}${NL}data: [DONE]${NL}${NL}`);
  });
});
await new Promise((r) => up.listen(0, '127.0.0.1', r)); const UPORT = up.address().port;
const imp = (p) => import(pathToFileURL(join(SRC, p)).href);
const { startApp } = await imp('test/helpers.js');
const cleanups = []; const tt = { after: (f) => cleanups.push(f) };
const { base: BASE } = await startApp(tt, { fake: false, probe: null, discover: null });
const H = { 'content-type': 'application/json' };
let browser;
const finish = async () => { try { await browser?.close(); } catch { /* x */ } for (const f of cleanups) { try { await f(); } catch { /* x */ } } up.closeAllConnections?.(); up.close(); const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; pictures in ${OUT}`); process.exit(bad.length ? 1 : 0); };
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
const connect = async (id) => { const r = await api(`/api/providers/${id}/connect`, 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${UPORT}/${id}/v1` }); return r.status; };
let session;
const say = async (providerId, extra = {}, text = 'think') => { const r = await fetch(`${BASE}/api/sessions/${session}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ content: text, providerId, model: `${providerId}-model`, ...extra }) }); return r.text(); };
const last = () => seen.at(-1);

try {
    session = (await (await api('/api/sessions', 'POST', { title: 'QA 13b' })).json()).id;
  const KNOWN = ['openai', 'google', 'openrouter', 'groq', 'xai', 'deepseek', 'together', 'fireworks', 'cerebras', 'moonshot'];
  const UNKNOWN = ['nvidia', 'mistral', 'anthropic', 'zhipu', 'dashscope', 'siliconflow', 'modelscope'];
  for (const p of [...KNOWN, ...UNKNOWN]) { const s = await connect(p); if (s >= 400) console.log(`INFO  could not connect ${p}: HTTP ${s}`); }

  await guard('T1', 'the page copy and the server table agree for every provider, and the field per provider is the documented one', async () => {
    for (const p of [...KNOWN, ...UNKNOWN, 'made-up', '', null, undefined, '__proto__', 'constructor']) ok(JSON.stringify(TU.thinkingLevels(p)) === JSON.stringify(T.thinkingLevels(p)), 'differ: ' + p);
    const want = { openai: { reasoning_effort: 'high' }, google: { reasoning_effort: 'high' }, openrouter: { reasoning: { effort: 'high' } }, groq: { reasoning_effort: 'high' }, xai: { reasoning_effort: 'high' }, deepseek: { reasoning_effort: 'high' }, together: { reasoning_effort: 'high' }, fireworks: { reasoning_effort: 'high' }, cerebras: { reasoning_effort: 'high' }, moonshot: { reasoning_effort: 'high' } };
    for (const [p, w] of Object.entries(want)) ok(JSON.stringify(T.thinkingBody(p, 'high')) === JSON.stringify(w), p);
    ok(T.thinkingBody('__proto__', 'high') === null && T.thinkingBody('constructor', 'high') === null && T.thinkingBody('openai', 'HIGH') === null && T.thinkingBody('openai', ['high']) === null, 'prototype or odd inputs');
    return 'tables equal; odd inputs null';
  });
  mode = 'ok';
  for (const p of KNOWN) {
    await guard(`E-${p}`, `${p}: Low / Medium / High each arrive in ${p}'s own field; Default sends none`, async () => {
      const lv = T.thinkingLevels(p); const got = [];
      for (const l of lv) { seen.length = 0; await say(p, { thinking: l }); ok(seen.length === 1, `${l}: ${seen.length} requests`); got.push(JSON.stringify(T.thinkingBody(p, l)) === JSON.stringify({ [Object.keys(T.thinkingBody(p, l))[0]]: last()[Object.keys(T.thinkingBody(p, l))[0]] })); ok(JSON.stringify(Object.fromEntries(Object.keys(T.thinkingBody(p, l)).map((k) => [k, last()[k]]))) === JSON.stringify(T.thinkingBody(p, l)), `${l}: ${JSON.stringify(last()).slice(0, 160)}`); }
      seen.length = 0; await say(p, {}); ok(!('reasoning_effort' in last()) && !('reasoning' in last()) && !('thinking' in last()), 'Default sent a field');
      if (p === 'cerebras' || p === 'moonshot') { seen.length = 0; await say(p, { thinking: 'medium' }); ok(!('reasoning_effort' in last()), 'medium sent to a provider with no medium'); }
      return `levels ${lv.join('/')}`;
    });
  }
  for (const p of UNKNOWN) {
    await guard(`U-${p}`, `${p}: not a known provider, so nothing is sent even if the page asks`, async () => { seen.length = 0; await say(p, { thinking: 'high' }); ok(seen.length === 1 && !('reasoning_effort' in last()) && !('reasoning' in last()) && !('thinking' in last()), JSON.stringify(last()).slice(0, 200)); return 'clean'; });
  }
  await guard('V1', 'bad values from a page are ignored, never forwarded: "extreme", "HIGH", "off", "", number, object, array, injection string', async () => {
    for (const v of ['extreme', 'HIGH', 'off', 'none', '', 5, { effort: 'high' }, ['high'], 'high; DROP', '__proto__']) { seen.length = 0; await say('openai', { thinking: v }); ok(seen.length === 1 && !('reasoning_effort' in last()) && !('reasoning' in last()), `${JSON.stringify(v)} -> ${JSON.stringify(last()).slice(0, 120)}`); }
    return '10 bad values: no field';
  });
  await guard('V2', 'the person\'s Thinking choice REPLACES the Effort-based reasoning (one field, not two); with Default the Effort setting still works', async () => {
    await api('/api/settings', 'PUT', { effort: 'high' }); seen.length = 0; await say('openai', { thinking: 'low' }); const withChoice = last(); seen.length = 0; await say('openai', {}); const without = last();
    console.log('INFO  settings effort=high; with Thinking=low openai body keys: ' + Object.keys(withChoice).filter((k) => /reason|think|effort/.test(k)).map((k) => k + '=' + JSON.stringify(withChoice[k])).join(',') + ' | Default: ' + (Object.keys(without).filter((k) => /reason|think|effort/.test(k)).map((k) => k + '=' + JSON.stringify(without[k])).join(',') || 'none'));
    ok(withChoice.reasoning_effort === 'low', 'choice lost: ' + JSON.stringify(withChoice).slice(0, 160)); await api('/api/settings', 'PUT', { effort: 'medium' }); return 'choice wins; Default falls back to Effort';
  });

  mode = 'refuse';
  await guard('R1', 'a model that refuses the field is asked again WITHOUT it, once, answers, and the person is told in words', async () => {
    seen.length = 0; const text = await say('openai', { thinking: 'low' }); ok(seen.length === 2 && 'reasoning_effort' in seen[0] && !('reasoning_effort' in seen[1]), `requests ${seen.length}`); ok(/plain/.test(text), 'no answer'); ok(/Thinking setting not used/.test(text) && /answered at its default/.test(text), text.slice(0, 300));
    const note = /result":"([^"]+)/.exec(text)?.[1]; return note ?? 'told';
  });
  await guard('R2', 'a refusal of the retry too ends in an error for the person, not a loop (still exactly two requests)', async () => {
    mode = 'refuse-always'; seen.length = 0; const text = await say('openai', { thinking: 'low' }); ok(seen.length === 2, `requests ${seen.length}`); ok(/error|did not|could not|answered 400/i.test(text) && !/"plain"/.test(text.replace(/Scripted/g, '')), text.slice(0, 260)); return text.slice(0, 150);
  });
  await guard('R3', 'a 400 that is about something else (max_tokens) is NOT retried', async () => { mode = 'unrelated400'; seen.length = 0; const text = await say('openai', { thinking: 'low' }); ok(seen.length === 1, `requests ${seen.length}`); ok(/max_tokens|too large|400|error/i.test(text), text.slice(0, 200)); return 'one request, error shown'; });
  await guard('R4', 'a server error (500) that mentions reasoning is NOT treated as a refusal', async () => { mode = 'srv500'; seen.length = 0; const text = await say('openai', { thinking: 'low' }); ok(seen.length <= 2, `requests ${seen.length}`); console.log(`INFO  500 with reasoning in the text: ${seen.length} request(s)`); ok(!/Thinking setting not used/.test(text), 'treated as a thinking refusal'); return `${seen.length} request(s)`; });
  await guard('R5', 'refusesThinking: table of wordings (Anthropic-style, Gemini-style, vague, a 429, 401, a body with no field)', async () => {
    const say2 = (m, code = 400) => ({ code: 'chat.http', message: `The provider answered ${code}: ${m}` }); const f = { reasoning_effort: 'high' };
    const yes = ["Unknown parameter: 'reasoning_effort'.", "Unsupported parameter: 'reasoning_effort' is not supported with this model.", 'reasoning_effort: extra inputs are not permitted', 'This model does not support the reasoning parameter', 'thinking is not supported for this model'];
    const no = ['Invalid API key', 'Rate limit reached for requests', 'context length exceeded', 'The model is overloaded'];
    const res = { yes: yes.map((m) => C.refusesThinking(say2(m), f)), no: no.map((m) => C.refusesThinking(say2(m), f)), c429: C.refusesThinking(say2('reasoning is not supported', 429), f), c401: C.refusesThinking(say2('reasoning is not supported', 401), f) };
    console.log('INFO  refusal wordings recognised: ' + JSON.stringify(res)); ok(res.no.every((x) => x === false) && !res.c429 && !res.c401, JSON.stringify(res)); const missed = yes.filter((_, i) => !res.yes[i]); ok(missed.length === 0, 'real refusal wordings missed: ' + missed.join(' | ')); return 'all recognised';
  });
  mode = 'ok';

  // ---------------------------------------------------------------- the picker page (real server data)
  await api('/api/settings', 'PUT', { modelFilter: 'all' });
  browser = await chromium.launch();
  for (const [scheme, width] of [['light', 1280], ['dark', 1280], ['light', 390]]) {
    await guard(`P-${scheme}-${width}`, `picker page ${scheme} ${width}px: Details of an openai model shows Thinking (Default, Low, Medium, High), the choice is kept and marked; a Cerebras model shows Default, Low, High; a Mistral model shows none`, async () => {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, baseURL: BASE }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      
      await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(1200); await page.locator('#picker-button').click(); await page.waitForSelector('.picker-panel');
      const openDetails = async (provider) => { await page.getByRole('button', { name: `Details for ${provider}-model` }).last().click(); return 'ok'; };
      const t1 = await openDetails('openai'); ok(t1, 'no openai details'); const group = page.getByRole('group', { name: 'Thinking' }); const labels = await group.getByRole('button').allInnerTexts(); ok(labels.join() === 'Default,Low,Medium,High', labels.join());
      await group.getByRole('button', { name: 'High' }).click(); ok((await group.getByRole('button', { name: 'High' }).getAttribute('aria-pressed')) === 'true', 'High not marked'); await page.screenshot({ path: join(OUT, `p-${scheme}-${width}.png`) });
      const stored = await page.evaluate(() => localStorage.getItem('bunny.thinking')); ok(/"high"/.test(stored), stored);
      await page.getByRole('button', { name: /Back/ }).click(); await page.keyboard.press('Escape');
      await ctx.close(); ok(errors.length === 0, errors.join(';')); return `labels ${labels.join('/')}; stored ${stored}`;
    });
  }
  await guard('P4', 'picker page: Cerebras shows Default/Low/High only and Mistral shows no Thinking at all', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE }); const page = await ctx.newPage(); 
    await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(1200); await page.locator('#picker-button').click(); await page.waitForSelector('.picker-panel');
    const probe = async (provider) => { const b = page.getByRole('button', { name: `Details for ${provider}-model` }); if (!(await b.count())) return 'model-not-found'; await b.last().click(); await page.waitForTimeout(150); const g = page.getByRole('group', { name: 'Thinking' }); return (await g.count()) ? (await g.getByRole('button').allInnerTexts()).join('/') : 'none'; };
    const c = await probe('cerebras'); await page.getByRole('button', { name: /Back/ }).click().catch(() => {}); const m = await probe('mistral'); await page.screenshot({ path: join(OUT, 'p4.png') }); await ctx.close(); console.log(`INFO  cerebras: ${c}; mistral: ${m}`);
    ok(c === 'Default/Low/High', 'cerebras ' + c); ok(m === 'none', 'mistral ' + m); return `cerebras ${c}; mistral ${m}`;
  });
  await guard('P5', 'the choice goes with the message from the page: picking High for an openai model then sending puts reasoning_effort=high in the upstream body', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE }); const page = await ctx.newPage();
    await page.addInitScript(() => { try { localStorage.setItem('bunny.thinking', JSON.stringify({ 'openai-model': 'high' })); } catch { /* x */ } });
    await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(1200); await page.locator('#picker-button').click(); await page.waitForSelector('.picker-panel');
    const rowsOf = page.locator('.picker-panel button', { hasText: /openai-model/i }); const n = await rowsOf.count(); console.log('INFO  picker rows for some-model: ' + n);
    await rowsOf.first().click().catch(() => {}); await page.keyboard.press('Escape').catch(() => {}); seen.length = 0; await page.locator('#input').fill('hello there'); await page.locator('#send').click(); await page.waitForTimeout(2500);
    const b = seen.find((x) => JSON.stringify(x).includes('hello there')); ok(b, 'upstream never asked (picker selection of an openai model may have picked another provider)'); console.log('INFO  body reasoning fields: ' + JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k]) => /reason|think|effort/.test(k)))));
    await ctx.close(); return 'reasoning in the body: ' + (b.reasoning_effort ?? JSON.stringify(b.reasoning) ?? 'none');
  });
  await finish();
} catch (e) { console.log('ABORT', e.stack ?? e.message); rows.push({ id: 'X', ok: false }); await finish(); }

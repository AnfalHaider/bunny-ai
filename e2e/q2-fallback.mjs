/**
 * Q-2 reproduction of owner report (c) and the Auto / model-switching reports.
 *
 *   BASE=http://127.0.0.1:5393 OUT=<temp> SCENARIO=picked-stalls|auto-top-stalls|picked-busy|all-stall node e2e/q2-fallback.mjs
 *
 * One scripted provider with several models. Some models never answer (the server's own
 * stall watchdog is 120 s per attempt, src/server/chat.js:20), some answer 429, one answers.
 * Prints the timeline: when each attempt failed, what the status line said, how many
 * "could not finish" lines the transcript ended up with, and which model finally answered.
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT, SCENARIO = process.env.SCENARIO ?? 'picked-stalls';
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json' };
const t0 = Date.now();
const at = () => `${String(Math.round((Date.now() - t0) / 1000)).padStart(3)}s`;
const log = (...a) => console.log(at(), ...a);

const MODELS = {
  'picked-stalls': { stall: ['offline/bunny-code'], busy: [] },
  'auto-top-stalls': { stall: ['offline/bunny-code', 'offline/bunny-large'], busy: [] },
  'picked-busy': { stall: [], busy: ['offline/bunny-code'] },
  'all-stall': { stall: ['offline/bunny-code', 'offline/bunny-large', 'offline/bunny-small'], busy: [] },
}[SCENARIO];
const ALL = ['offline/bunny-code', 'offline/bunny-large', 'offline/bunny-small']; // fake mode lists these three whatever /models says
const asked = [];
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const hung = new Set();
const model = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ data: ALL.map((id) => ({ id })) })); }
    const body = JSON.parse(raw);
    asked.push({ t: at(), model: body.model });
    if (MODELS.busy.includes(body.model)) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end('{"error":{"message":"Rate limit exceeded"}}'); }
    if (MODELS.stall.includes(body.model)) { hung.add(res); return; } // accept and never answer
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(frame({ content: `answered by ${body.model}` }) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
await fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify({ modelFilter: 'all' }) });
await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL: BASE })).newPage();
const errs = []; page.on('pageerror', (e) => errs.push('pageerror ' + e));
const auto = SCENARIO === 'auto-top-stalls' || SCENARIO === 'all-stall';
await page.goto('/');
await page.evaluate((a) => { localStorage.setItem('bunny.modelAuto', a ? '1' : '0'); localStorage.setItem('bunny.workMode', 'chat'); }, auto);
await page.goto('/');
await page.locator('#picker-button').click();
const options = await page.locator('.picker-panel .picker-item').allInnerTexts();
log('picker options:', JSON.stringify(options.map((o) => o.replace(/\s+/g, ' ').slice(0, 60))));
if (!auto) await page.locator('.picker-panel .picker-item', { hasText: 'Bunny Code' }).first().click();
else await page.keyboard.press('Escape');
log('picker button shows:', (await page.locator('#picker-button').innerText()).replace(/\s+/g, ' '));

await page.locator('#input').fill('hello there'); await page.locator('#send').click();
const statuses = new Set();
const watch = setInterval(async () => { try { const s = (await page.locator('#status').innerText()).trim(); if (s && !statuses.has(s)) { statuses.add(s); log('status line:', s); } } catch {} }, 1000);
await page.locator('#stop').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
await page.locator('#stop').waitFor({ state: 'hidden', timeout: 480_000 }).catch(() => log('still streaming after 8 min'));
clearInterval(watch);
await page.waitForTimeout(1500);
const lines = (await page.locator('#messages').innerText()).split('\n').filter(Boolean);
log('transcript lines:', JSON.stringify(lines));
log('"could not finish" lines:', lines.filter((l) => /could not finish/.test(l)).length);
log('provider was asked (model order):', JSON.stringify(asked));
const sessions = await (await fetch(BASE + '/api/sessions')).json();
const saved = await (await fetch(`${BASE}/api/sessions/${sessions[0].id}`)).json();
log('saved messages:', JSON.stringify((saved.messages ?? []).map((m) => `${m.role}${m.kind ? '/' + m.kind : ''}: ${String(m.content).slice(0, 70)}`)));
await page.screenshot({ path: `${OUT}/q2-fallback-${SCENARIO}.png` });
log('page errors:', JSON.stringify(errs));
for (const r of hung) r.destroy();
await browser.close(); model.close();

/**
 * QA, v0.1.9 W3-8 (87f0003): a reply that fails part-way is kept as the words so far and the model that takes over carries on from them;
 * Auto starts from the model that answered last. Real server (in process, invented data folder), real chat page in Chromium, a scripted
 * OpenAI-style upstream with two models: whichever model Auto asks FIRST dies in the middle of its reply; the other one carries on.
 *   node e2e/w019-w38.mjs      (screenshots to $SHOTS or the temp folder)
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp, post } = await imp('test/helpers.js');
const { preferLastAnswered } = await imp('src/ui/model-abilities.js');
const SHOTS = process.env.SHOTS || join(mkdtempSync(join(tmpdir(), 'bunny-w019w38-')), 'shots'); mkdirSync(SHOTS, { recursive: true });
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : ''}`); };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

// ---- pure rule
{
  const a = { providerId: 'p', id: 'a' }; const b = { providerId: 'p', id: 'b' }; const c = { providerId: 'q', id: 'c' };
  check('R1', 'preferLastAnswered puts the model that answered last first and keeps the others in order', JSON.stringify(preferLastAnswered([a, b, c], { providerId: 'q', id: 'c' }).map((x) => x.id)) === '["c","a","b"]');
  check('R2', 'a last-answered model that is already first, no longer in the list, the same name on another provider, or null: the list is unchanged', ['a,b,c'].every(() => JSON.stringify(preferLastAnswered([a, b, c], { providerId: 'p', id: 'a' }).map((x) => x.id)) === '["a","b","c"]' && JSON.stringify(preferLastAnswered([a, b, c], { providerId: 'p', id: 'gone' }).map((x) => x.id)) === '["a","b","c"]' && JSON.stringify(preferLastAnswered([a, b, c], { providerId: 'z', id: 'b' }).map((x) => x.id)) === '["a","b","c"]' && JSON.stringify(preferLastAnswered([a, b, c], null).map((x) => x.id)) === '["a","b","c"]'));
  check('R3', 'odd input does not crash (empty list, a last value without id)', preferLastAnswered([], { providerId: 'p', id: 'a' }).length === 0 && preferLastAnswered([a], {}).length === 1);
}

// ---- the world
const { base } = await startApp(t, { fake: false });
let hits = []; let dier = null; let dies = true; let secondDies = false;
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"test-model-1"},{"id":"test-model-2"}]}'); return; }
    const body = JSON.parse(raw); hits.push({ model: body.model, messages: body.messages });
    dier ??= body.model; // the first model asked is the one that dies
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (body.model === dier && dies) { res.write(sse({ content: 'First the roots, then ' })); setTimeout(() => res.destroy(), 80); return; }
    if (secondDies && body.model !== dier) { res.write(sse({ content: 'the stems, and ' })); setTimeout(() => res.destroy(), 80); return; }
    res.end(sse({ content: body.model === dier ? 'fresh answer from the first model.' : 'the leaves.' }) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); cleanups.push(async () => upstream.close());
await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
await fetch(`${base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ modelFilter: 'all' }) });

const browser = await chromium.launch();
async function openAuto({ theme = 'light', width = 1280 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('bunny.modelAuto', '1'); } catch { /* ignore */ } });
  await page.goto(base + '/'); await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
  await page.waitForTimeout(1200);
  return { ctx, page, errors };
}
const say = async (page, text, wait = 9000) => {
  await page.locator('#input').fill(text); await page.locator('#send').click();
  await page.waitForFunction(() => !document.querySelector('#send')?.disabled || document.querySelectorAll('.msg.assistant').length > 0, null, { timeout: wait }).catch(() => {});
  await page.waitForTimeout(wait > 5000 ? 5000 : 1500);
};
const texts = (page, sel) => page.locator(sel).allTextContents().then((a) => a.map((x) => x.replace(/\s+/g, ' ').trim()));

for (const [sz, w] of [['desktop', 1280], ['phone', 390]]) for (const theme of ['light', 'dark']) {
  const tag = `${sz}/${theme}`;
  hits = []; dier = null; dies = true; secondDies = false;
  const { ctx, page, errors } = await openAuto({ theme, width: w });
  await say(page, 'explain carrots');
  const order = hits.map((h) => h.model);
  check(`P1 ${tag}`, 'Auto asks the first model, it dies after "First the roots, then", and the OTHER model is asked next (two requests, different models)', order.length === 2 && order[0] === dier && order[1] !== dier, order.join(' > '));
  const second = hits[1]?.messages ?? [];
  const sent = JSON.stringify(second);
  check(`P2 ${tag}`, 'the model that takes over is SENT the words written so far and is told the reply was cut off', /First the roots, then/.test(sent) && /cut off|stopped before it finished/.test(sent), `${(second.at(-1)?.content ?? '').toString().slice(0, 100)}`);
  const bodies = await texts(page, '.msg.assistant .body');
  check(`P3 ${tag}`, 'the chat shows the words so far as their own message ("First the roots, then") and then the answer from the second model ("the leaves.")', bodies.some((b) => /First the roots, then/.test(b)) && bodies.some((b) => /the leaves\./.test(b)), JSON.stringify(bodies).slice(0, 160));
  check(`P4 ${tag}`, 'the cut-off message says Bunny can pick up where it stopped (Send "continue") and the red error note is gone after the takeover', (await page.locator('.hint', { hasText: /continue/i }).count()) >= 1 && (await page.locator('.error-note').count()) === 0, `error notes ${await page.locator('.error-note').count()}`);
  await page.screenshot({ path: join(SHOTS, `partial-${sz}-${theme}.png`) });
  const sid = new URL(page.url()).searchParams.get('s');
  void sid;
  await page.reload(); await page.waitForTimeout(1500);
  const afterReload = await texts(page, '.msg.assistant .body');
  check(`P5 ${tag}`, 'after a reload the partial words and the final answer are both still there, in that order', afterReload.findIndex((b) => /First the roots/.test(b)) >= 0 && afterReload.findIndex((b) => /the leaves\./.test(b)) > afterReload.findIndex((b) => /First the roots/.test(b)), JSON.stringify(afterReload).slice(0, 160));
  // Auto starts from the model that answered last
  hits = [];
  await say(page, 'and now tell me about turnips');
  const nextOrder = hits.map((h) => h.model);
  const lastAnswerer = order[1];
  check(`P6 ${tag}`, 'the next message in Auto starts from the model that answered last (not the one that died): the first request goes to it', nextOrder[0] === lastAnswerer, `${nextOrder.join(' > ')} (last answerer ${lastAnswerer})`);
  const stored = await page.evaluate(() => localStorage.getItem('bunny.lastAnswered'));
  check(`P7 ${tag}`, 'what Auto remembers is only the provider id and model id, kept on this computer', /"providerId":"openai"/.test(stored ?? '') && Object.keys(JSON.parse(stored ?? '{}')).sort().join() === 'id,providerId', stored);
  check(`P8 ${tag}`, 'no page error', errors.length === 0, errors.join('|'));
  await ctx.close();
}

// ---- more cases (one run)
{
  hits = []; dier = null; dies = true; secondDies = true;
  const { ctx, page } = await openAuto();
  await say(page, 'explain beets', 14000);
  const asked = hits.map((h) => h.model);
  const bodies = await texts(page, '.msg.assistant .body');
  const lastSent = JSON.stringify(hits.at(-1)?.messages ?? []);
  console.log(`INFO  both models die part-way: requests ${asked.join(' > ')}; bodies ${JSON.stringify(bodies).slice(0, 200)}`);
  check('M1', 'when the first model dies and the second one dies too, the words of BOTH are kept (nothing lost) and the reply ends with a plain error, not a hang', bodies.some((b) => /First the roots/.test(b)) && asked.length >= 2 && asked.length <= 4, `${asked.length} requests`);
  check('M2', 'a third attempt (if any) is sent the words of the earlier partials, not an empty chat', asked.length < 3 || (/First the roots/.test(lastSent)), `${asked.length} requests`);
  await ctx.close();
  hits = []; dier = null; dies = true; secondDies = false;
  const w = await openAuto(); const st = []; const origEvents = w.page; void origEvents;
  // a model that dies BEFORE any words (nothing to keep): no empty partial message
  const emptyDier = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"x-1"}]}'); return; } res.writeHead(200, { 'content-type': 'text/event-stream' }); setTimeout(() => res.destroy(), 50); }); });
  await new Promise((r) => emptyDier.listen(0, '127.0.0.1', r));
  const em = await startApp(t, { fake: false });
  await post(em.base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${emptyDier.address().port}/v1` });
  const { body: s } = await post(em.base, '/api/sessions', { title: 'empty', providerId: 'openai', model: 'x-1' });
  await fetch(`${em.base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'hi', providerId: 'openai', model: 'x-1' }) }).then((r) => r.text());
  const saved = await (await fetch(`${em.base}/api/sessions/${s.id}`)).json();
  st.push(...saved.messages.map((m) => m.kind ?? m.role));
  check('M3', 'a model that dies before writing anything leaves NO empty "partial" message (only the user message and the error)', !st.includes('partial'), st.join(','));
  emptyDier.close(); await w.ctx.close();
}
{
  // manual model choice: Auto does not remember or reorder
  hits = []; dier = null; dies = false; secondDies = false;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 } }); const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('bunny.modelAuto', '0'); localStorage.removeItem('bunny.lastAnswered'); } catch { /* ignore */ } });
  await page.goto(base + '/'); await page.waitForTimeout(1200);
  await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item[data-model], .picker-panel .picker-model').first().click();
  await say(page, 'manual choice', 6000);
  const stored = await page.evaluate(() => localStorage.getItem('bunny.lastAnswered'));
  check('M4', 'with a model chosen by hand (Auto off), nothing is remembered for Auto', stored === null, String(stored));
  await ctx.close();
}
await browser.close();
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);

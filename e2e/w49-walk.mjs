/**
 * QA, W4-9: how long Bunny waits for a first reply before trying another model (setting firstReplyWaitSeconds).
 * Invented profile only (temp data folders). Real timings: streamChat and the real chat route against a local server that never answers.
 *   node e2e/w49-walk.mjs      (from a checkout that has src/server/waitLimits.js and test/helpers.js)
 */
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const imp = (p) => import(pathToFileURL(join(root, p)).href);
const { startApp, post, put } = await imp('test/helpers.js');
const { waitLimits, waitSeconds } = await imp('src/server/waitLimits.js');
const { streamChat } = await imp('src/server/chat.js');
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).slice(0, 220) : ''}`); };
const getSettings = async (base) => (await fetch(`${base}/api/settings`)).json();
const putSetting = (base, body) => fetch(`${base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify(body) });

// ---- A: the setting through the API
const dataDir = await mkdtemp(join(tmpdir(), 'bunny-w49-'));
let { base } = await startApp(t, { dataDir, fake: false });
{
  const s0 = await getSettings(base);
  check('A1', 'a fresh profile has no stored wait (so the default 30 applies)', s0.firstReplyWaitSeconds === undefined || s0.firstReplyWaitSeconds === 30, `value ${s0.firstReplyWaitSeconds}`);
  for (const v of [15, 30, 60, 90, 120, 10, 600, 45]) {
    const r = await putSetting(base, { firstReplyWaitSeconds: v });
    check(`A2 ${v}`, `${v} is accepted and read back (presets 15/30/60/90/120, Custom 10 to 600)`, r.status === 200 && (await getSettings(base)).firstReplyWaitSeconds === v, `status ${r.status}`);
  }
  await putSetting(base, { firstReplyWaitSeconds: 45 });
  for (const bad of [9, 601, 0, -5, 30.5, 'abc', '30', null, true, [], {}, 1e9, NaN]) {
    const r = await putSetting(base, { firstReplyWaitSeconds: bad });
    const body = await r.json().catch(() => ({}));
    const still = (await getSettings(base)).firstReplyWaitSeconds;
    check(`A3 ${JSON.stringify(bad)}`, `${JSON.stringify(bad)} is refused with 400, the note "Use a whole number of seconds from 10 to 600. Not saved." and nothing is saved`, r.status === 400 && /from 10 to 600\. Not saved\./.test(body.message ?? '') && still === 45, `status ${r.status}; stored ${still}; ${body.code}`);
  }
  const mixed = await putSetting(base, { firstReplyWaitSeconds: 700, theme: 'dark' });
  check('A4', 'a bad wait in a request that also changes another setting saves neither', mixed.status === 400 && (await getSettings(base)).theme !== 'dark', `status ${mixed.status}; theme ${(await getSettings(base)).theme}`);
}
// restart on the same data folder
{
  const again = await startApp(t, { dataDir, fake: false });
  check('A5', 'the setting survives a restart (45 read back by a second app on the same folder)', (await getSettings(again.base)).firstReplyWaitSeconds === 45);
  // hand-damaged settings.json
  const file = join(dataDir, 'settings.json');
  const raw = JSON.parse(await readFile(file, 'utf8'));
  for (const [label, val] of [['text', 'abc'], ['too big', 5000], ['too small', 2], ['fraction', 20.5], ['null', null]]) {
    raw.firstReplyWaitSeconds = val; await writeFile(file, JSON.stringify(raw));
    const reread = await startApp(t, { dataDir, fake: false });
    const r = await fetch(`${reread.base}/api/settings`);
    check(`A6 ${label}`, `a hand-damaged stored value (${label}) does not crash the app, and the wait that applies is 30`, r.status === 200 && waitSeconds(val) === 30 && waitLimits(val).firstMs === 30000, `status ${r.status}; settings shows ${(await r.json()).firstReplyWaitSeconds}`);
  }
}
// ---- B: the limits, as a table
{
  const table = [[undefined, 30, 60, 60], [15, 15, 30, 30], [30, 30, 60, 60], [60, 60, 120, 120], [90, 90, 180, 180], [120, 120, 240, 240], [10, 10, 20, 20], [300, 300, 600, 600], [400, 400, 600, 600], [600, 600, 600, 600], ['x', 30, 60, 60]];
  for (const [setting, first, slow, gap] of table) {
    const l = waitLimits(setting);
    check(`B ${String(setting)}`, `setting ${String(setting)}: first reply ${first} s, slow models ${slow} s, silence while streaming ${gap} s (doubled, capped at 600)`, l.firstMs === first * 1000 && l.slowFirstMs === slow * 1000 && l.gapMs === gap * 1000, JSON.stringify(l));
  }
}

// ---- C: real timing with a server that never answers
const silent = createServer((req) => { req.on('data', () => {}); /* never answers */ });
await new Promise((r) => silent.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${silent.address().port}/v1`;
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const hush = createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(sse({ content: 'hello' })); /* then silent */ }); });
await new Promise((r) => hush.listen(0, '127.0.0.1', r));
const hushUrl = `http://127.0.0.1:${hush.address().port}/v1`;
async function timeIt(opts, server = url) {
  const began = Date.now(); let got = ''; let error = null;
  try { for await (const d of streamChat({ baseUrl: server, apiKey: 'k', messages: [{ role: 'user', content: 'hi' }], maxTokens: 50, ...opts })) got += String(d); } catch (e) { error = e; }
  return { ms: Date.now() - began, error: error?.message ?? null, code: error?.code, got };
}
const within = (ms, secs, slack = 1.5) => ms >= secs * 1000 - 300 && ms <= secs * 1000 + slack * 1000;
const [c10, c20, cDef, slow10, hush10] = await Promise.all([
  timeIt({ model: 'gpt-4o', waitSeconds: 10 }),
  timeIt({ model: 'gpt-4o', waitSeconds: 20 }),
  timeIt({ model: 'gpt-4o' }),
  timeIt({ model: 'o1-reasoning', waitSeconds: 10 }),
  timeIt({ model: 'gpt-4o', waitSeconds: 10 }, hushUrl),
]);
check('C1', 'wait 10: a never-answering server is given up on after about 10 s', within(c10.ms, 10) && c10.error, `${c10.ms} ms: ${c10.error}`);
check('C2', 'wait 20: given up on after about 20 s', within(c20.ms, 20) && c20.error, `${c20.ms} ms: ${c20.error}`);
check('C3', 'no setting: the old 30 s', within(cDef.ms, 30) && cDef.error, `${cDef.ms} ms: ${cDef.error}`);
check('C4', 'wait 10 with a reasoning model: twice as long, about 20 s', within(slow10.ms, 20) && slow10.error, `${slow10.ms} ms: ${slow10.error}`);
check('C5', 'wait 10, the model starts then goes silent: given up on after the doubled silence limit, about 20 s, and what arrived is kept', within(hush10.ms, 20, 2) && /hello/.test(hush10.got), `${hush10.ms} ms; got "${hush10.got}"; error ${hush10.error}`);
check('C6', 'the give-up message is the same wording for every wait', c10.error === c20.error && Boolean(c10.error), c10.error);

// ---- D: the real chat route uses the setting (a message to a never-answering provider ends after the saved wait)
{
  const app2 = await startApp(t, { fake: false });
  await post(app2.base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: url });
  await putSetting(app2.base, { firstReplyWaitSeconds: 10 });
  const { body: s } = await post(app2.base, '/api/sessions', { title: 'w49', providerId: 'openai', model: 'gpt-4o' });
  const began = Date.now();
  const res = await fetch(`${app2.base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'hello', providerId: 'openai', model: 'gpt-4o' }), signal: AbortSignal.timeout(45000) }).catch(() => null);
  const text = res ? await res.text().catch(() => '') : '';
  const ms = Date.now() - began;
  check('D1', 'through the real chat route, with the wait saved as 10, a never-answering provider ends the reply after about 10 s with an error event', within(ms, 10, 3) && /error/.test(text), `${ms} ms; ${text.slice(-160).replace(/\s+/g, ' ')}`);
}

silent.closeAllConnections?.(); hush.closeAllConnections?.(); silent.close(); hush.close();
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

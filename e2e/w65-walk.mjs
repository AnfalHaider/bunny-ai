/**
 * QA, W6-5: Auto leaves a dead model and a provider that just refused; for Code it prefers strong tool-use models.
 * Part 1 is the page's own ranking code (src/ui/model-abilities.js, plain ESM) fed invented model lists.
 * Part 2 is the real server: a busy answer rests ONLY that model; the list the page reads says so.
 *   node e2e/w65-walk.mjs      (from a checkout that has test/helpers.js)
 */
import { createServer } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { rankModels, whyPicked, modelAbilities } = await imp('src/ui/model-abilities.js');
const { startApp, post } = await imp('test/helpers.js');
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 230) : ''}`); };
const m = (providerId, id, extra = {}) => ({ providerId, providerName: providerId, id, displayName: id, contextLength: 128000, ...extra });
const ids = (list) => list.map((x) => `${x.providerId}/${x.id}`);
const future = Date.now() + 120_000; const past = Date.now() - 1000;

// ---- Part 1: ranking
const pool = [m('a', 'gpt-4o'), m('b', 'claude-sonnet-4'), m('c', 'llama-3.2-3b-instruct'), m('d', 'gemini-2.0-flash'), m('e', 'qwen3-coder-480b'), m('f', 'gpt-4o-mini'), m('g', 'tiny-model-1b')];
const code = rankModels(pool, 'code');
check('R1', 'for Code the strong tool-use models come first (gpt-4o, claude, qwen3-coder) and small ones (3b, flash, mini, 1b) come after', ['gpt-4o', 'claude-sonnet-4', 'qwen3-coder-480b'].every((id) => code.slice(0, 3).some((x) => x.id === id)), ids(code).join(', '));
check('R2', 'for Code the mini and flash models come after every strong one (models that cannot run Code at all are left out)', code.findIndex((x) => x.id === 'gpt-4o-mini') > 2 && code.findIndex((x) => x.id === 'gemini-2.0-flash') > 2, ids(code).join(', '));
const chat = rankModels(pool, 'chat');
console.log(`INFO  chat order: ${ids(chat).join(', ')}`);
check('R3', 'a model marked unavailable is never picked', !rankModels([...pool, m('x', 'gpt-5', { unavailable: 'not found for account' })], 'code').some((x) => x.id === 'gpt-5'));
const cooling = [m('a', 'gpt-4o', { coolingUntil: future }), m('a', 'gpt-4.1', { coolingUntil: future }), m('b', 'claude-sonnet-4')];
check('R4', 'models of a provider that is cooling down are skipped; another provider is picked', ids(rankModels(cooling, 'code')).join() === 'b/claude-sonnet-4', ids(rankModels(cooling, 'code')).join());
const expired = [m('a', 'gpt-4o', { coolingUntil: past }), m('b', 'claude-sonnet-4')];
check('R5', 'a cool-down that has ended no longer hides the model', rankModels(expired, 'code').some((x) => x.id === 'gpt-4o'));
check('R6', 'when every model is cooling or unavailable, the list is empty (not a crash) so the page can say so', rankModels([m('a', 'gpt-4o', { coolingUntil: future })], 'code').length === 0);
check('R7', 'only the model that was busy is skipped when the cool-down is for that model (page marks the one model)', ids(rankModels([m('a', 'gpt-4o', { coolingUntil: future }), m('a', 'gpt-4.1')], 'code')).join() === 'a/gpt-4.1');
check('R8', 'whyPicked for Code on a strong model says strong at coding and tool use', whyPicked(m('a', 'gpt-4o'), 'code') === 'strong at coding and tool use', whyPicked(m('a', 'gpt-4o'), 'code'));
check('R9', 'whyPicked for Code on a model not in the strong list says the best coding model available here', whyPicked(m('z', 'obscure-model'), 'code') === 'the best coding model available here', whyPicked(m('z', 'obscure-model'), 'code'));
check('R10', 'whyPicked for chat adds nothing', whyPicked(m('a', 'gpt-4o'), 'chat') === null);
{ const l = rankModels([m('a', 'gemini-2.5-pro'), m('b', 'gpt-4o-mini')], 'code'); check('R11', 'gemini-2.5-pro (the word mini only inside gemini) is not treated as weak for Code, and ranks above gpt-4o-mini', l[0]?.id === 'gemini-2.5-pro', ids(l).join()); }
{ const l = rankModels([m('a', 'llama-3.1-8b-instruct'), m('b', 'llama-3.1-70b-instruct')], 'code'); check('R12', 'for Code a 70b llama ranks above an 8b llama', l[0]?.id === 'llama-3.1-70b-instruct', ids(l).join()); }
void modelAbilities;

// ---- Part 2: the real server
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const { base } = await startApp(t, { fake: false });
let answer = { status: 429, text: 'Too many requests, the model is busy.' };
const upstream = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { res.writeHead(answer.status, j); res.end(JSON.stringify({ error: { message: answer.text } })); }); });
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
async function say(model) {
  const { body: s } = await post(base, '/api/sessions', { title: 'w65', providerId: 'openai', model });
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'hello', providerId: 'openai', model }), signal: AbortSignal.timeout(40000) });
  const text = await res.text();
  const ev = (/^event: error\ndata: (.*)$/m.exec(text) ?? [])[1];
  return ev ? JSON.parse(ev) : null;
}
const list = async () => (await fetch(`${base}/api/models`)).json();
const e1 = await say('test-model-1');
const after = await list();
const one = after.find((x) => x.id === 'test-model-1'); const two = after.find((x) => x.id === 'test-model-2');
check('R13', 'a busy answer on test-model-1 rests only that model for about 2 minutes: the other model of the same provider is not cooling', e1?.coolingScope === 'model' && one?.coolingUntil > Date.now() + 90_000 && !two?.coolingUntil, JSON.stringify({ scope: e1?.coolingScope, one: one?.coolingUntil ? Math.round((one.coolingUntil - Date.now()) / 1000) + ' s' : null, two: two?.coolingUntil ?? null }));
const rankedNow = rankModels(after, 'chat');
check('R14', 'the page ranking on the list the server just returned leaves out the cooling model and keeps the other', !rankedNow.some((x) => x.id === 'test-model-1') && rankedNow.some((x) => x.id === 'test-model-2'), ids(rankedNow).join(', '));
answer = { status: 429, text: 'You exceeded your current quota, please check your plan.' };
const e2 = await say('test-model-2');
const after2 = await list();
check('R15', 'a quota message rests the whole provider for an hour: both models cooling, Auto has nothing left from this provider', e2?.coolingScope === 'provider' && after2.every((x) => x.coolingUntil > Date.now() + 3_000_000) && rankModels(after2, 'chat').length === 0, JSON.stringify({ scope: e2?.coolingScope, left: rankModels(after2, 'chat').length }));
answer = { status: 401, text: 'Incorrect API key provided' };
const e3 = await say('test-model-1');
check('R16', 'a refused key is a provider problem with no cool-down timer (the page tells the person to fix the key)', e3?.scope === 'provider' && !e3?.coolingUntil, JSON.stringify(e3).slice(0, 200));

upstream.close();
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
void mkdtemp; void tmpdir;
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

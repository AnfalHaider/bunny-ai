/**
 * QA, v0.1.9 w6-small (3274621): W6-25 (a question, a permission prompt and a capability card are not answered or denied by a timer; after waitNudgeMs
 * the window is nudged), W6-19 (copying or comparing how a page looks is a see job; a hand-picked model that cannot see gets one plain line),
 * W6-23 (a retry starts by clearing the failed attempts' red notes). Real server (in process, invented data folder), a scripted OpenAI-style upstream,
 * and the real chat page in Chromium for the screen parts. waitNudgeMs is set to 700 ms so the nudge can be seen without a 3 minute wait.
 *   node e2e/w019-small.mjs      (screenshots to $SHOTS or the temp folder)
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp, post } = await imp('test/helpers.js');
const { detectJob, noEyesWarning } = await imp('src/ui/model-abilities.js');
const SHOTS = process.env.SHOTS || join(mkdtempSync(join(tmpdir(), 'bunny-w019small-')), 'shots'); mkdirSync(SHOTS, { recursive: true });
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 240) : ''}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// =============== W6-19: pure rules ===============
{
  const yes = ['copy this site for me', 'Please clone the landing page', 'recreate this website in React', 'replicate the design of this page', 'mimic the look of the page', 'compare these two pages', 'compare the layout of both screenshots', 'match the design in the screenshot', 'copy how the UI looks', 'compare screenshots of the old and new pages'];
  const no = ['copy the file to the backup folder', 'compare these two numbers', 'match the regex against the log lines', 'clone the repository', 'copy the text of the readme', 'recreate the database from the dump', 'compare the prices', 'copy this function', 'refactor the page controller'];
  const wrongYes = yes.filter((p) => detectJob(p, { workMode: 'code' }) !== 'see'); const wrongNo = no.filter((p) => detectJob(p, { workMode: 'code' }) === 'see');
  check('V1', 'copy/clone/recreate/replicate/mimic/match/compare a site, page, design, layout or screenshots is a see job even in Code mode', wrongYes.length === 0, wrongYes.join(' | ') || `${yes.length} phrases`);
  check('V2', 'ordinary copy, compare, match and clone requests (files, numbers, regex, repositories) are NOT a see job', wrongNo.length === 0, wrongNo.join(' | ') || `${no.length} phrases`);
  const edge = ['match the regex on the page', 'compare the page sizes in bytes', 'copy the page title into the readme', 'clone the website repository from github'];
  console.log(`INFO  look-alike requests classified as a see job (a model that can see is chosen, harmless but not needed): ${edge.filter((p) => detectJob(p, { workMode: 'code' }) === 'see').join(' | ') || 'none'}`);
  check('V3', 'noEyesWarning: a see job, model chosen by hand, that cannot see gives one plain line naming the model; Auto, a model that can see, or another job give none', /gpt-x cannot look at pictures/.test(noEyesWarning({ job: 'see', modelAuto: false, modelName: 'gpt-x', canSee: false }) ?? '') && noEyesWarning({ job: 'see', modelAuto: true, modelName: 'a', canSee: false }) === null && noEyesWarning({ job: 'see', modelAuto: false, modelName: 'a', canSee: true }) === null && noEyesWarning({ job: 'code', modelAuto: false, modelName: 'a', canSee: false }) === null);
  check('V4', 'with no model name the line says "This model"', /^This model cannot look at pictures/.test(noEyesWarning({ job: 'see', modelAuto: false, canSee: false }) ?? ''));
}

// =============== the world ===============
const { base, app } = await startApp(t, { fake: false, waitNudgeMs: 700, discover: null });
let seen = []; let script = () => ({ kind: 'text', text: 'ok' });
const MODELS = ['gpt-4o', 'text-only-1', 'claude-sonnet-4'];
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: MODELS.map((id) => ({ id })) })); return; }
    const body = JSON.parse(raw); seen.push(body); const b = script(body, seen.length);
    if (b.kind === 'http') { res.writeHead(b.status, j); res.end(JSON.stringify({ error: { message: b.message } })); return; }
    const answer = () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const frame = b.kind === 'tool' ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${seen.length}`, function: { name: b.name, arguments: JSON.stringify(b.args ?? {}) } }] } }] } : { choices: [{ delta: { content: b.text ?? 'ok' } }] };
      res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
    };
    if (b.delay) setTimeout(answer, b.delay); else answer();
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r)); cleanups.push(async () => upstream.close());
await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
await fetch(`${base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ modelFilter: 'all' }) });
const folder = await mkdtemp(join(tmpdir(), 'bunny-w019small-folder-'));
const listed = await (await fetch(`${base}/api/models`)).json();
console.log(`INFO  models offered: ${listed.map((m) => m.id).join(', ')}`);

async function run({ content, model = 'gpt-4o', mode = 'ask', workMode = 'code', retry = false, sessionId = null, handler = null, closeAfterMs = 0 }) {
  let id = sessionId; seen = [];
  if (!id) {
    const { body: s } = await post(base, '/api/sessions', { title: 'w019', providerId: 'openai', model });
    id = s.id;
    for (const [n, v] of [['folder', folder], ['workMode', workMode], ['permissionMode', mode]]) await fetch(`${base}/api/sessions/${id}/setting/${n}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: v }) });
  }
  const events = []; const times = [];
  const ctl = new AbortController(); if (closeAfterMs) setTimeout(() => ctl.abort(), closeAfterMs);
  const began = Date.now();
  try {
    const res = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content, providerId: 'openai', model, workMode, ...(retry ? { retry: true, attemptsLeft: 0 } : {}) }), signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(40000)]) });
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
      let cut; while ((cut = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
        const ev = /^event: (.*)$/m.exec(frame)?.[1]; const d = /^data: (.*)$/m.exec(frame)?.[1]; if (!ev || !d) continue;
        let p; try { p = JSON.parse(d); } catch { continue; }
        events.push({ ev, data: p }); times.push(Date.now() - began);
        if (handler) handler(ev, p, id); // not awaited: a handler that waits must not stop the reading of later events
      }
    }
  } catch { /* closed by the walk */ }
  const saved = await (await fetch(`${base}/api/sessions/${id}`)).json();
  return { id, events, times, saved, ms: Date.now() - began };
}
const kindsOf = (r) => r.saved.messages.map((m) => m.kind ?? m.role);

// =============== W6-25: waiting is not answered by a timer ===============
{
  script = (b, n) => (n === 1 ? { kind: 'tool', name: 'ask_user', args: { question: 'Which colour should the button be?', choices: ['Red', 'Blue'] } } : { kind: 'text', text: 'done after the answer' });
  let nudgeAt = null; let answeredAt = null;
  const r = await run({ content: 'ask me something', handler: async (ev, p, id) => {
    if (ev === 'question') { await wait(2500); answeredAt = Date.now(); await fetch(`${base}/api/sessions/${id}/question/${p.id}`, { method: 'POST', headers: j, body: JSON.stringify({ choices: ['Blue'] }) }); }
    if (ev === 'waiting') nudgeAt = Date.now();
  } });
  const waiting = r.events.filter((e) => e.ev === 'waiting');
  check('Q1', 'a question that waits longer than the nudge time sends ONE "waiting" nudge (kind question, with the question text) and is NOT skipped: answered 2.5 s later, it works and the reply finishes', waiting.length === 1 && waiting[0].data.kind === 'question' && /Which colour/.test(waiting[0].data.title) && /done after the answer/.test(JSON.stringify(r.saved.messages)) && nudgeAt && answeredAt > nudgeAt, `${waiting.length} nudges; ${JSON.stringify(waiting[0]?.data)}`);
  const q = r.saved.messages.find((m) => m.question);
  check('Q2', 'the saved card says what was answered (Blue), not "Skipped" or "Not answered"', /Blue/.test(JSON.stringify(q?.question ?? r.saved.messages.filter((m) => /Asked/.test(m.tool ?? '')))), JSON.stringify(q?.question ?? '').slice(0, 120));
  // permission prompt
  script = (b, n) => (n === 1 ? { kind: 'tool', name: 'write_file', args: { path: 'a.txt', content: 'hello' } } : { kind: 'text', text: 'file written' });
  let permNudge = false;
  const p = await run({ content: 'write a file', mode: 'ask', handler: async (ev, d, id) => {
    if (ev === 'permission') { await wait(2500); await fetch(`${base}/api/sessions/${id}/permission/${d.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: true }) }); }
    if (ev === 'waiting' && d.kind === 'permission') permNudge = true;
  } });
  check('Q3', 'a permission prompt left 2.5 s (past the nudge) is not denied by itself: it nudges (kind permission), and Allow later still runs the command', permNudge && /file written/.test(JSON.stringify(p.saved.messages)) && !/denied/.test(JSON.stringify(p.saved.messages.filter((m) => m.kind === 'tool_call').map((m) => m.status))), `nudge ${permNudge}; statuses ${p.saved.messages.filter((m) => m.kind === 'tool_call').map((m) => m.status)}`);
  // capability card
  script = (b, n) => (n === 1 ? { kind: 'tool', name: 'request_capability', args: { capability: 'custom_tools', reason: 'build a helper' } } : { kind: 'text', text: 'capability decided' });
  let capNudge = false;
  const c = await run({ content: 'build a tool', mode: 'ask', workMode: 'chat', handler: async (ev, d, id) => {
    if (ev === 'capability') { await wait(2500); await fetch(`${base}/api/sessions/${id}/capability/${d.id}`, { method: 'POST', headers: j, body: JSON.stringify({ granted: false }) }); }
    if (ev === 'waiting' && d.kind === 'capability') capNudge = true;
  } });
  check('Q4', 'a capability card left waiting nudges (kind capability) and is not answered by the timer; the later No is what ends it', capNudge && /capability decided/.test(JSON.stringify(c.saved.messages)), `nudge ${capNudge}`);
  // nudge is a one-off
  script = (b, n) => (n === 1 ? { kind: 'tool', name: 'ask_user', args: { question: 'Still there?', choices: ['Yes', 'No'] } } : { kind: 'text', text: 'ok' });
  const many = await run({ content: 'long wait', handler: async (ev, d, id) => { if (ev === 'question') { await wait(4200); await fetch(`${base}/api/sessions/${id}/question/${d.id}`, { method: 'POST', headers: j, body: JSON.stringify({ choices: ['Yes'] }) }); } } });
  const nudges = many.events.filter((e) => e.ev === 'waiting');
  console.log(`INFO  one question left for 4.2 s with a 0.7 s nudge time: ${nudges.length} nudge(s) at ${many.times.filter((_, i) => many.events[i].ev === 'waiting').join(', ')} ms (the nudge fires once; it does not repeat)`);
  check('Q5', 'the nudge is sent once per card (not every few seconds)', nudges.length === 1, `${nudges.length}`);
  // the person's window goes away: the card still ends (no hang)
  script = (b) => (/window closes/.test(JSON.stringify((b.messages ?? []).filter((m) => m.role === 'user').at(-1)?.content ?? '')) && !(b.messages ?? []).some((m) => m.role === 'tool') ? { kind: 'tool', name: 'ask_user', args: { question: 'Gone?', choices: ['A', 'B'] } } : { kind: 'text', text: 'ok' });
  const gone = await run({ content: 'window closes', closeAfterMs: 1500 });
  await wait(500);
  const next = await run({ content: 'a new message works', sessionId: gone.id });
  check('Q6', 'when the window goes away while Bunny waits (the reply connection closes), nothing hangs: the next message in the same chat works at once', next.ms < 6000 && next.saved.messages.length > gone.saved.messages.length, `${next.ms} ms`);
}

// =============== W6-23: a retry clears the failed attempts' red notes ===============
{
  // message 1: model A runs a step, then fails; the retry (model B) runs steps too and answers
  script = (b, n) => {
    if (b.model === 'gpt-4o' && n === 1) return { kind: 'tool', name: 'list_files', args: {} };
    if (b.model === 'gpt-4o') return { kind: 'http', status: 500, message: 'upstream exploded' };
    if (b.model === 'claude-sonnet-4' && !(b.messages ?? []).some((m) => m.role === 'tool')) return { kind: 'tool', name: 'list_files', args: {} };
    return { kind: 'text', text: 'B finished the job' };
  };
  seen = [];
  const first = await run({ content: 'tidy the folder', model: 'gpt-4o', mode: 'auto' });
  const afterFirst = kindsOf(first);
  console.log(`INFO  after model A failed after one step: ${afterFirst.join(', ')}`);
  const retry = await run({ content: 'tidy the folder', model: 'claude-sonnet-4', mode: 'auto', retry: true, sessionId: first.id });
  const kinds = kindsOf(retry);
  console.log(`INFO  after the retry by model B finished: ${kinds.join(', ')}`);
  check('F1', 'model A fails after running a step: the chat holds the step and one red error note', afterFirst.includes('error') && afterFirst.filter((k) => k === 'error').length === 1, afterFirst.join(','));
  check('F2', 'the retry by model B runs its own steps and answers: NO red error note is left anywhere in the chat (not in the middle either)', !kinds.includes('error') && /B finished the job/.test(JSON.stringify(retry.saved.messages)), kinds.join(','));
  check('F3', 'the steps of both attempts are kept (nothing lost) and the answer is last', kinds.filter((k) => k === 'tool_call').length >= 2 && retry.saved.messages.at(-1).content === 'B finished the job', kinds.join(','));
  // both fail: one note, the latest
  script = (b) => (b.model === 'gpt-4o' ? { kind: 'http', status: 500, message: 'first failure' } : { kind: 'http', status: 500, message: 'second failure' });
  const f1 = await run({ content: 'try hard', model: 'gpt-4o', mode: 'auto' });
  const f2 = await run({ content: 'try hard', model: 'claude-sonnet-4', mode: 'auto', retry: true, sessionId: f1.id });
  const errs = f2.saved.messages.filter((m) => m.kind === 'error');
  check('F4', 'if the retry fails too, the chat holds exactly ONE note, the latest ("second failure"), not both', errs.length === 1 && /second failure/.test(errs[0].content), `${errs.length} notes: ${errs.map((e) => e.content.slice(0, 60)).join(' | ')}`);
  // no earlier error and a normal message: nothing is removed that should stay
  script = () => ({ kind: 'text', text: 'plain answer' });
  const ok1 = await run({ content: 'hello', model: 'gpt-4o', mode: 'auto' });
  const ok2 = await run({ content: 'and again', model: 'gpt-4o', mode: 'auto', sessionId: ok1.id, retry: true });
  check('F5', 'a retry in a chat that has no failure notes loses nothing (user message and first answer are still there)', kindsOf(ok2).filter((k) => k === 'user' || k === 'assistant' || k === 'text').length >= 3, kindsOf(ok2).join(','));
  script = (b, n) => (n === 1 ? { kind: 'http', status: 500, message: 'old failure' } : { kind: 'text', text: 'later answer' });
  const old1 = await run({ content: 'first', model: 'gpt-4o', mode: 'auto' });
  script = () => ({ kind: 'text', text: 'second answer' });
  const old2 = await run({ content: 'second question', model: 'gpt-4o', mode: 'auto', sessionId: old1.id });
  console.log(`INFO  a failure note from an earlier, separate message is ${kindsOf(old2).includes('error') ? 'kept' : 'removed'} when a NEW (not retry) message is sent: ${kindsOf(old2).join(', ')}`);
}

// =============== W6-19 and W6-25 on screen ===============
const browser = await chromium.launch();
async function page_(theme = 'light', width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme });
  await ctx.addInitScript(() => {
    window.__notes = [];
    class FakeNotification { constructor(title, o) { window.__notes.push({ title, body: o?.body }); } static requestPermission() { return Promise.resolve('granted'); } close() {} }
    FakeNotification.permission = 'granted';
    window.Notification = FakeNotification;
  });
  const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '/'); await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme); await page.waitForTimeout(1200);
  return { ctx, page, errors };
}
for (const [sz, w] of [['desktop', 1280], ['phone', 390]]) for (const theme of ['light', 'dark']) {
  const tag = `${sz}/${theme}`;
  // W6-25 on screen: a question waits; the status line says so; a hidden window gets a notification
  script = (b) => (/ask me which colour/.test(JSON.stringify((b.messages ?? []).filter((m) => m.role === 'user').at(-1)?.content ?? '')) && !(b.messages ?? []).some((m) => m.role === 'tool') ? { kind: 'tool', name: 'ask_user', args: { question: 'Which colour should the button be?', choices: ['Red', 'Blue'] } } : { kind: 'text', text: 'colour chosen' });
  const { ctx, page, errors } = await page_(theme, w);
  await page.evaluate(() => { try { localStorage.setItem('bunny.modelAuto', '0'); } catch { /* ignore */ } });
  await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item[data-model], .picker-panel .picker-model').filter({ hasText: /gpt-4o/ }).first().click();
  await page.evaluate(() => Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }));
  await page.locator('#input').fill('ask me which colour'); await page.locator('#send').click();
  await page.locator('.question-card:not(.is-answered)').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1800);
  const status = ((await page.locator('#status').textContent().catch(() => '')) ?? '').trim();
  const notes = await page.evaluate(() => window.__notes);
  check(`W25a ${tag}`, 'a question left past the nudge time: the status line says "Bunny is still waiting for an answer: Which colour ..." and the card is still live (clickable)', /Bunny is still waiting for an answer: Which colour/.test(status) && (await page.locator('.question-card:not(.is-answered) .question-choice').count()) === 2, status.slice(0, 120));
  check(`W25b ${tag}`, 'with the window hidden a notification is raised with the same line (once)', notes.length === 1 && /still waiting for an answer/.test(notes[0].body ?? ''), JSON.stringify(notes));
  await page.screenshot({ path: join(SHOTS, `waiting-${sz}-${theme}.png`) });
  await page.locator('.question-card .question-choice', { hasText: 'Blue' }).click(); await page.waitForTimeout(1500);
  check(`W25c ${tag}`, 'answering it after the nudge works (colour chosen) and the card shows the answer', /colour chosen/.test(((await page.locator('.msg.assistant .body').last().textContent().catch(() => '')) ?? '')) && /Blue/.test(((await page.locator('.question-card .question-answer').last().textContent().catch(() => '')) ?? '')));
  check(`W25d ${tag}`, 'no page error', errors.length === 0, errors.join('|'));
  await ctx.close();
}
{
  // W6-19 on screen: a hand-picked model that cannot see; a see job in Code mode
  script = () => ({ kind: 'text', text: 'looked at it', delay: 1800 }); // a slow answer, so the status line can be read while the reply starts
  const { ctx, page } = await page_('light', 1280);
  await page.evaluate(() => { try { localStorage.setItem('bunny.modelAuto', '0'); } catch { /* ignore */ } });
  await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item[data-model], .picker-panel .picker-model').filter({ hasText: /text-only-1/ }).first().click();
  const statuses = []; const poll = setInterval(async () => { try { const s = (await page.locator('#status').textContent({ timeout: 150 }))?.trim(); if (s && statuses.at(-1) !== s) statuses.push(s); } catch { /* ignore */ } }, 80);
  await page.locator('#input').fill('please copy this website for me'); await page.locator('#send').click();
  await page.waitForTimeout(2500); clearInterval(poll);
  check('E1', 'a model chosen by hand that cannot see, asked to copy a website: one plain line in the status line while the reply starts ("text-only-1 cannot look at pictures ... Pick a model that can see, or choose Auto.")', statuses.some((s) => /text-only-1 cannot look at pictures/.test(s) && /choose Auto/.test(s)), JSON.stringify(statuses).slice(0, 200));
  await page.screenshot({ path: join(SHOTS, 'noeyes-desktop-light.png') });
  seen = [];
  await page.locator('#input').fill('what is two plus two'); await page.locator('#send').click(); await page.waitForTimeout(1500);
  const quiet = ((await page.locator('#status').textContent().catch(() => '')) ?? '');
  check('E2', 'an ordinary question to the same model gives no such line', !/cannot look at pictures/.test(quiet), quiet.slice(0, 80));
  await ctx.close();
}
{
  // Auto picks a model that can see for the same request
  script = () => ({ kind: 'text', text: 'looked at it' });
  seen = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 844 } }); const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('bunny.modelAuto', '1'); } catch { /* ignore */ } });
  await page.goto(base + '/'); await page.waitForTimeout(1500);
  await page.locator('#input').fill('copy this landing page design'); await page.locator('#send').click(); await page.waitForTimeout(3500);
  const asked = seen.map((b) => b.model);
  check('E3', 'in Auto the same kind of request goes to a model that can see (gpt-4o or claude-sonnet-4, not text-only-1)', asked.length >= 1 && asked[0] !== 'text-only-1', asked.join(' > '));
  await ctx.close();
}
await browser.close();
void app;
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);

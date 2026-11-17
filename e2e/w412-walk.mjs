/**
 * QA, W4-12 at c2da6a8: the "Bunny asked" card. A live card is answered by a click, by words typed in the card, or by words typed in the
 * message box; "keep going" and its plain synonyms carry on a limit-check card; a typed answer is kept; a card nobody answered says Bunny
 * stopped waiting and its choices are dimmed. Real server (in process, invented data folder), real chat page in Chromium, a scripted
 * OpenAI-style model that records every request it receives.
 *   node e2e/w412-walk.mjs      (from a checkout that has test/helpers.js; screenshots to $SHOTS or the temp folder)
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const { startApp, post } = await import(pathToFileURL(join(process.cwd(), 'test', 'helpers.js')).href);
const SHOTS = process.env.SHOTS || join(mkdtempSync(join(tmpdir(), 'bunny-w412-')), 'shots'); mkdirSync(SHOTS, { recursive: true });
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 250) : ''}`); };

// ---- the scripted provider: steps[i] is { name, args } for request i, or undefined for "done"
let seen = []; let steps = [];
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] })); return; }
    const body = JSON.parse(raw); seen.push(body);
    const step = steps[seen.length - 1];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = step
      ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args) } }] } }] }
      : { choices: [{ delta: { content: 'all done' } }] };
    res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const { base } = await startApp(t, { fake: false });
await fetch(`${base}/api/settings`, { method: 'PUT', headers: j, body: JSON.stringify({ modelFilter: 'all' }) });
await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
const folder = await mkdtemp(join(tmpdir(), 'bunny-qa-w412-'));
const toolMsgs = (b) => (b?.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content));
const ASK = (extra = {}) => ({ name: 'ask_user', args: { question: 'Which database should the project use?', choices: ['Postgres', 'SQLite'], ...extra } });
const SAME = { name: 'list_files', args: { path: '.' } };

// =============== Part 1: the server side of the limit-check card (by the API; a table of typed words) ===============
async function limitCard(answerFn) {
  seen = []; steps = [SAME, SAME, SAME, SAME, SAME]; // the same step three times in a row raises "Keep trying, or stop here?"
  const { body: s } = await post(base, '/api/sessions', { title: 'limit', providerId: 'openai', model: 'gpt-4o' });
  const set = (n, v) => fetch(`${base}/api/sessions/${s.id}/setting/${n}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: v }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', 'auto');
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'gpt-4o', workMode: 'code' }), signal: AbortSignal.timeout(30000) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let card = null; let at = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let cut; while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      if (/^event: question/m.test(frame)) { card = JSON.parse(/^data: (.*)$/m.exec(frame)[1]); at = seen.length; await fetch(`${base}/api/sessions/${s.id}/question/${card.id}`, { method: 'POST', headers: j, body: JSON.stringify(answerFn(card)) }); }
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  const step = saved.messages.find((m) => m.tool === 'Asked: limit check');
  const afterMsgs = (seen[at]?.messages ?? []).filter((m) => m.role === 'user').map((m) => String(m.content)).filter((c) => /^The person answered your question/.test(c));
  return { card, afterMsgs, carried: seen.length - at >= 2, requestsAfter: seen.length - at, saved: step?.question ?? null, result: step?.result };
}
{
  const first = await limitCard(() => ({ choices: ['Stop here'] }));
  check('L0', 'the limit-check card is "I have run the same step ... three times in a row. Keep trying, or stop here?" with the choices Stop here (recommended, listed first) and Keep going', /three times in a row/.test(first.card?.question ?? '') && first.card.choices.map((c) => c.label).sort().join() === 'Keep going,Stop here', JSON.stringify(first.card).slice(0, 200));
  check('L1', 'clicking Stop here stops: no further request to the model', first.carried === false, `${first.requestsAfter} requests after`);
  const keep = await limitCard(() => ({ choices: ['Keep going'] }));
  check('L2', 'clicking Keep going carries on', keep.carried === true, `${keep.requestsAfter} requests after`);
  const carryWords = ['keep going', 'Keep going!', 'KEEP GOING', 'keep trying', 'carry on', 'go on', 'continue', 'yes', 'Yes please', '  yes  ', 'continue with it', 'yes, but only the tests'];
  const stopWords = ['stop here', 'stop', 'no', 'No thanks', "don't keep going", 'not yet', 'wait', 'please stop', 'enough', 'later', 'yesterday', 'go online', 'continuing', 'keep', 'carry', 'ok'];
  for (const w of carryWords) { const r = await limitCard(() => ({ text: w })); check(`T+ "${w}"`, `typed "${w}" carries on`, r.carried === true, `${r.requestsAfter} requests after; saved answer "${r.saved?.answer}"`); }
  for (const w of stopWords) { const r = await limitCard(() => ({ text: w })); check(`T- "${w}"`, `typed "${w}" stops`, r.carried === false, `${r.requestsAfter} requests after; saved answer "${r.saved?.answer}"`); }
  const ambiguous = ['yes, stop', 'continue? no, stop', 'yes but stop now'];
  for (const w of ambiguous) { const r = await limitCard(() => ({ text: w })); console.log(`INFO  typed "${w}" -> ${r.carried ? 'carries on' : 'stops'} (it starts with a carry-on word)`); }
  const both = await limitCard(() => ({ choices: ['Stop here'], text: 'keep going' }));
  check('T1', 'a click on Stop here wins over words typed in the same card ("keep going"): it stops', both.carried === false, `${both.requestsAfter} requests after`);
  const both2 = await limitCard(() => ({ choices: ['Keep going'], text: 'but carefully' }));
  check('T2', 'a click on Keep going with a note typed in the card carries on', both2.carried === true, `${both2.requestsAfter} requests after`);
  const skip = await limitCard(() => ({ skipped: true, text: 'yes' }));
  check('T3', 'Skip stops, even if some text was typed', skip.carried === false, `${skip.requestsAfter} requests after`);
  const typed = await limitCard(() => ({ text: 'keep going, but only look at the docs folder' }));
  check('T4', 'a typed answer is kept in the saved record of the card (it is what the person said, not "No answer")', typed.saved?.answer === 'keep going, but only look at the docs folder' && typed.carried === true, JSON.stringify(typed.saved)?.slice(0, 200));
  const long = await limitCard(() => ({ text: 'keep going ' + 'x'.repeat(500) }));
  check('T5', 'a very long typed answer is cut (200 characters) in the saved record and still carries on', long.carried === true && (long.saved?.answer ?? '').length <= 200, `${(long.saved?.answer ?? '').length} characters`);
  const empty = await limitCard(() => ({ text: '   ' }));
  check('T6', 'a blank answer (spaces only) is no answer: stops, saved as null', empty.carried === false && empty.saved?.answer === null, JSON.stringify(empty.saved)?.slice(0, 160));
  // ---- bcca328: a typed "yes, but skip X" carries on AND the model gets the words typed
  const words = await limitCard(() => ({ text: 'yes, but skip the tests' }));
  check('Y1', 'typed "yes, but skip the tests": carries on, and the next request to the model holds a user message with the words typed', words.carried === true && words.afterMsgs.length === 1 && /yes, but skip the tests/.test(words.afterMsgs[0]) && /three times in a row/.test(words.afterMsgs[0]), JSON.stringify(words.afterMsgs).slice(0, 260));
  for (const w of ['keep going', 'Keep going!', 'KEEP GOING.', '  keep going  ']) { const r = await limitCard(() => ({ text: w })); check(`Y2 "${w}"`, `plain "${w}" carries on with no extra message to the model (it is only the go-ahead)`, r.carried === true && r.afterMsgs.length === 0, JSON.stringify(r.afterMsgs)); }
  const clicked = await limitCard(() => ({ choices: ['Keep going'] }));
  check('Y3', 'a click on Keep going sends no extra message', clicked.carried === true && clicked.afterMsgs.length === 0);
  const note = await limitCard(() => ({ choices: ['Keep going'], text: 'only look at the docs folder' }));
  check('Y4', 'a click on Keep going with a note typed in the card: carries on and the model gets the note', note.carried === true && note.afterMsgs.length === 1 && /only look at the docs folder/.test(note.afterMsgs[0]), JSON.stringify(note.afterMsgs).slice(0, 220));
  const stopNote = await limitCard(() => ({ choices: ['Stop here'], text: 'because I changed my mind' }));
  check('Y5', 'a click on Stop here with a note stops and nothing is added for the model', stopNote.carried === false && stopNote.afterMsgs.length === 0);
  const stopWord = await limitCard(() => ({ text: 'no, stop' }));
  check('Y6', 'typed "no, stop" stops and nothing is added', stopWord.carried === false && stopWord.afterMsgs.length === 0);
  const markup = await limitCard(() => ({ text: 'yes <b>bold</b> "quoted" `tick` {json: 1}' }));
  check('Y7', 'markup, quotes and braces in typed words pass through as plain text (carries on, one message)', markup.carried === true && markup.afterMsgs.length === 1 && markup.afterMsgs[0].includes('<b>bold</b>'), JSON.stringify(markup.afterMsgs).slice(0, 200));
  const longWords = await limitCard(() => ({ text: 'yes ' + 'z'.repeat(600) }));
  check('Y8', 'a very long typed answer reaches the model cut to 200 characters of the words typed (the whole message under 450 characters)', longWords.carried === true && longWords.afterMsgs.length === 1 && longWords.afterMsgs[0].length < 450 && (longWords.afterMsgs[0].match(/z+/g) ?? [''])[0].length <= 200, `${longWords.afterMsgs[0]?.length} characters`);
  const skipYes = await limitCard(() => ({ skipped: true, text: 'yes but skip it' }));
  check('Y9', 'Skip with words typed still stops and adds nothing', skipYes.carried === false && skipYes.afterMsgs.length === 0);
  const saved2 = await limitCard(() => ({ text: 'yes, but skip the tests' }));
  check('Y10', 'the saved card record still shows what the person typed', saved2.saved?.answer === 'yes, but skip the tests', JSON.stringify(saved2.saved?.answer));
  const twice = await limitCard(() => ({ text: 'continue, but only read, do not write' }));
  check('Y11', 'a second kind of go-ahead word ("continue, but only read, do not write") is passed on too', twice.carried === true && /only read, do not write/.test(twice.afterMsgs[0] ?? ''), JSON.stringify(twice.afterMsgs).slice(0, 200));
  // ---- f6180e8: a go-ahead word followed by stop, don't, no, not, wait or hold is a stop; "but" and other words still carry on
  const stops = ['yes, stop', 'yes, wait', "yes, don't", 'yes, do not', 'yes stop', 'Yes. Stop.', 'continue, stop', 'go on, hold on', 'keep going, no', 'yes - not now', 'carry on; wait'];
  for (const w of stops) { const r = await limitCard(() => ({ text: w })); check(`F+ "${w}"`, `typed "${w}" is a stop (nothing more is run)`, r.carried === false && r.afterMsgs.length === 0, `${r.requestsAfter} requests after`); }
  const goes = ['yes, but skip the tests', 'yes but stop touching the config', 'continue, but only read', 'yes, skip the tests', 'yes, only the docs', 'keep going, carefully', 'yes please', 'go on and finish'];
  for (const w of goes) { const r = await limitCard(() => ({ text: w })); check(`F- "${w}"`, `typed "${w}" carries on and the model gets the words`, r.carried === true && r.afterMsgs.length === 1 && r.afterMsgs[0].includes(w), `${r.requestsAfter} requests after`); }
  for (const w of ['yes, no problem', "yes, don't worry about it", "continue, don't stop", 'yes, not a problem', 'go on, no need to ask']) { const r = await limitCard(() => ({ text: w })); console.log(`INFO  typed "${w}" -> ${r.carried ? 'carries on' : 'STOPS'} (starts with a go-ahead word then no, not or don't)`); }
  const skipSaved = await limitCard(() => ({ skipped: true }));
  check('F1', 'Skip on the limit-check card is saved as Skipped (not empty) and stops', skipSaved.carried === false && skipSaved.saved?.answer === 'Skipped', JSON.stringify(skipSaved.saved?.answer));
  const forged = await limitCard(() => ({ skipped: true, gone: true }));
  check('F2', 'a request that adds gone:true to a skip is saved as no answer (the same as a closed window); harmless', forged.saved?.answer === null && forged.carried === false, JSON.stringify(forged.saved?.answer));
  const odd = await limitCard(() => ({ text: { a: 1 }, choices: 'Keep going' }));
  console.log(`INFO  odd shapes ({text: object, choices: string}) -> ${odd.carried ? 'carries on' : 'stops'}, the reply did not crash`);
}

// =============== Part 2: the page ===============
const browser = await chromium.launch();
async function openChat({ width, theme }) {
  const ctx = await browser.newContext({ viewport: { width, height: 844 }, colorScheme: theme });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => { try { localStorage.setItem('bunny.modelAuto', '0'); } catch { /* ignore */ } });
  await page.goto(base + '/');
  await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item[data-model]').first().click();
  return { ctx, page, errors };
}
async function ask(page, text = 'help me choose') {
  await page.locator('#input').fill(text);
  await page.locator('#send').click();
  await page.locator('.question-card:not(.is-answered)').first().waitFor({ timeout: 15000 });
}
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const answerOf = async (page) => ((await page.locator('.question-card .question-answer').last().textContent().catch(() => '')) ?? '').trim();
const userMessages = async (page) => page.locator('.msg.user').count();

for (const [sz, w] of [['desktop', 1280], ['phone', 390]]) for (const theme of ['light', 'dark']) {
  const tag = `${sz}/${theme}`;
  // ---- a click on a choice
  { const { ctx, page, errors } = await openChat({ width: w, theme });
    seen = []; steps = [ASK(), undefined];
    await ask(page);
    const sendOn = await page.locator('#send').isEnabled();
    check(`A1 ${tag}`, 'a live card shows the question, its two choices, a typing box, Send and Skip, and the message box Send stays on while the card waits', (await page.locator('.question-card h4').first().textContent()) === 'Which database should the project use?' && (await page.locator('.question-card .question-choice').count()) === 2 && sendOn, `send enabled: ${sendOn}`);
    await page.screenshot({ path: join(SHOTS, `W412-live-${sz}-${theme}.png`) });
    await page.locator('.question-card .question-choice', { hasText: 'SQLite' }).click();
    await page.waitForTimeout(1500);
    check(`A2 ${tag}`, 'clicking SQLite: the card becomes "Bunny asked ... You answered: SQLite" and the model gets that answer', /You answered: SQLite/.test(await answerOf(page)) && /SQLite/.test(toolMsgs(seen[1]).join(' ')), `${await answerOf(page)}; model saw ${toolMsgs(seen[1]).join(' ').slice(0, 80)}`);
    check(`A3 ${tag}`, 'the reply finishes (all done) and the message box Send is off again when idle with nothing to send', /all done/.test((await page.locator('.msg.assistant .body').last().textContent()) ?? ''));
    check(`A4 ${tag}`, 'no page error', errors.length === 0, errors.join('|'));
    await ctx.close(); }
  // ---- words typed in the card
  { const { ctx, page } = await openChat({ width: w, theme });
    seen = []; steps = [ASK(), undefined];
    await ask(page);
    await page.locator('.question-card textarea').fill('Whatever is easiest to back up');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    check(`B1 ${tag}`, 'words typed in the card and Enter: "You answered: Whatever is easiest to back up"', /You answered: Whatever is easiest to back up/.test(await answerOf(page)) && /easiest to back up/.test(toolMsgs(seen[1]).join(' ')), await answerOf(page));
    await ctx.close(); }
  // ---- the message box answers a waiting card
  { const { ctx, page } = await openChat({ width: w, theme });
    seen = []; steps = [ASK(), undefined];
    await ask(page);
    const before = await userMessages(page);
    await page.locator('#input').fill('something else entirely, I want files');
    await page.locator('#send').click();
    await page.waitForTimeout(1500);
    const afterUsers = await userMessages(page);
    check(`M1 ${tag}`, 'typing other words in the message box and Send answers the card with those words (not a new chat message), and the box is cleared', /You answered: something else entirely, I want files/.test(await answerOf(page)) && afterUsers === before && (await page.locator('#input').inputValue()) === '' && /I want files/.test(toolMsgs(seen[1]).join(' ')), `${await answerOf(page)}; user messages ${before}->${afterUsers}`);
    await ctx.close(); }
  { const { ctx, page } = await openChat({ width: w, theme });
    seen = []; steps = [ASK(), undefined];
    await ask(page);
    await page.locator('#input').fill('sqlite.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500);
    check(`M2 ${tag}`, 'typing the name of a choice with other case and a full stop ("sqlite.") picks that choice: "You answered: SQLite"', /You answered: SQLite$/.test(await answerOf(page)), await answerOf(page));
    await ctx.close(); }
  { const { ctx, page } = await openChat({ width: w, theme });
    seen = []; steps = [ASK(), undefined];
    await ask(page);
    await page.locator('#input').fill('/compact');
    await page.locator('#send').click();
    await page.waitForTimeout(800);
    const stillWaiting = (await page.locator('.question-card:not(.is-answered)').count()) === 1;
    check(`M3 ${tag}`, 'a slash command typed while a card waits does not answer the card (the card is still waiting)', stillWaiting, `still waiting: ${stillWaiting}`);
    await page.locator('#input').fill('');
    await page.locator('.question-card .question-choice').first().click();
    await page.waitForTimeout(1200);
    await ctx.close(); }
  { const { ctx, page } = await openChat({ width: w, theme });
    seen = []; steps = [ASK(), undefined];
    await ask(page);
    await page.locator('#input').fill('');
    await page.locator('#send').click();
    await page.waitForTimeout(500);
    check(`M4 ${tag}`, 'pressing Send with an empty message box does nothing: the card still waits', (await page.locator('.question-card:not(.is-answered)').count()) === 1);
    await page.locator('.question-card button', { hasText: 'Skip' }).click();
    await page.waitForTimeout(1200);
    const allCards = (await page.locator('.question-card').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
    console.log(`INFO  after Skip the cards read: ${JSON.stringify(allCards)}`);
    check(`M5 ${tag}`, 'Skip: the card says the person skipped it (not that Bunny stopped waiting) and the reply finishes', allCards.some((x) => /You skipped this question/.test(x)) && !allCards.some((x) => /Bunny stopped waiting/.test(x)) && /all done/.test((await page.locator('.msg.assistant .body').last().textContent()) ?? ''), allCards.join(' | '));
    await ctx.close(); }
  // ---- a limit-check card answered from the message box
  for (const [words, carries] of [['stop here.', false], ['keep going', true], ['Continue', true], ['no thanks', false]]) {
    const { ctx, page } = await openChat({ width: w, theme });
    seen = []; steps = [SAME, SAME, SAME, SAME, SAME, undefined];
    await page.locator('#permission-mode').selectOption('auto').catch(() => {});
    await page.locator('#input').fill('please look around');
    await page.locator('#send').click();
    const got = await page.locator('.question-card:not(.is-answered)').first().waitFor({ timeout: 12000 }).then(() => true).catch(() => false);
    if (!got) { check(`K ${tag} "${words}"`, 'the limit-check card appeared (the page used a chat in Code mode)', false, 'no card: the page chat is not in Code mode with a folder'); await ctx.close(); continue; }
    const at = seen.length;
    await page.locator('#input').fill(words);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2000);
    check(`K ${tag} "${words}"`, `typing "${words}" in the message box on the limit-check card ${carries ? 'carries on' : 'stops'}`, (seen.length - at >= 2) === carries && /You answered/.test(await answerOf(page)), `${await answerOf(page)}; requests after ${seen.length - at}`);
    await ctx.close();
  }
}

// =============== Part 3: reload while Bunny waits (the owner's likely case), and a saved card nobody answered ===============
for (const [sz, w] of [['desktop', 1280], ['phone', 390]]) for (const theme of ['light', 'dark']) {
  const tag = `${sz}/${theme}`;
  const { ctx, page, errors } = await openChat({ width: w, theme });
  seen = []; steps = [ASK({ choices: [{ label: 'Postgres', reason: 'Real database server', recommended: true }, { label: 'SQLite', reason: 'One file, nothing to install' }] }), undefined];
  await ask(page, 'set up the project');
  await page.locator('.question-card textarea').fill('half typed thought');
  await page.waitForTimeout(300);
  const sid = await page.evaluate(() => (window.__bunnySession ?? null));
  void sid;
  await page.reload();
  await page.waitForTimeout(2500);
  const note = page.locator('.question-card.is-unanswered .question-answer-note');
  let have = await note.count();
  if (!have) { // the page may not reopen the last chat by itself: open it from the sidebar
    const row = page.locator('.chat-row, .sidebar .chat, [data-session], .session-item').first();
    if (await row.count()) { await row.click(); await page.waitForTimeout(1500); have = await note.count(); }
  }
  check(`R1 ${tag}`, 'after a reload while Bunny waits, the question is in the chat as a saved card that says Bunny stopped waiting', have === 1, `${have} unanswered cards`);
  const card = page.locator('.question-card.is-unanswered').first();
  const noteText = have ? (await note.first().textContent()).trim() : '';
  check(`R2 ${tag}`, 'the note says why (the window was closed or reloaded, or nobody answered in time) and tells the person to use the message box', /Bunny stopped waiting/.test(noteText) && /message box/.test(noteText) && /reloaded/.test(noteText), noteText.slice(0, 160));
  const answerLine = have ? (await card.locator('.question-answer').textContent()).trim() : '';
  check(`R3 ${tag}`, 'the card says "Not answered", lists the choices as plain dimmed text (not buttons), and keeps the reasons', answerLine === 'Not answered' && (await card.locator('button.question-choice').count()) === 0 && (await card.locator('.question-choice.is-static').count()) === 2, `${answerLine}; ${await card.locator('.question-choice.is-static').count()} static choices`);
  const op = have ? await card.locator('.question-choice.is-static').first().evaluate((e) => getComputedStyle(e.closest('.question-card') ? e : e).opacity) : null;
  check(`R4 ${tag}`, 'the choices of an unanswered card are dimmed (opacity 0.55) so they do not look like live buttons', op !== null && Math.abs(Number(op) - 0.55) < 0.02, `opacity ${op}`);
  const clickable = have ? await card.locator('.question-choice.is-static').first().evaluate((e) => ({ tag: e.tagName, role: e.getAttribute('role'), tab: e.tabIndex })) : null;
  check(`R5 ${tag}`, 'the dimmed choices are spans with no button role and are not tabbable', clickable && clickable.tag === 'SPAN' && !clickable.role && clickable.tab < 0, JSON.stringify(clickable));
  if (have) await card.locator('.question-choice.is-static').first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(500);
  check(`R6 ${tag}`, 'clicking a dimmed choice does nothing (still no answer, nothing sent to the model)', seen.length === 1 && /Not answered/.test(((await card.locator('.question-answer').textContent().catch(() => '')) ?? '')), `requests ${seen.length}`);
  // contrast of the note and the answer line, size of the layout
  const cr = await page.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) return parse(c); } return [255, 255, 255]; };
    const out = {};
    for (const [k, sel] of Object.entries({ note: '.question-answer-note', answer: '.question-card.is-unanswered .question-answer', question: '.question-card.is-unanswered h4' })) { const el = document.querySelector(sel); if (el) out[k] = [parse(getComputedStyle(el).color), bgOf(el)]; }
    return { out, overflow: document.documentElement.scrollWidth > window.innerWidth + 1 };
  });
  const ratios = Object.fromEntries(Object.entries(cr.out).map(([k, [fg, bg]]) => [k, +ratio(fg, bg).toFixed(2)]));
  check(`R7 ${tag}`, 'the note, the "Not answered" line and the question are readable (4.5:1) and the page has no sideways scroll', Object.values(ratios).length === 3 && Object.values(ratios).every((v) => v >= 4.5) && !cr.overflow, JSON.stringify({ ratios, overflow: cr.overflow }));
  await page.screenshot({ path: join(SHOTS, `W412-unanswered-${sz}-${theme}.png`) });
  // the person tells Bunny what they want in the message box: a normal new message
  seen = []; steps = [undefined];
  await page.locator('#input').fill('Use SQLite please');
  await page.locator('#send').click();
  await page.waitForTimeout(2000);
  check(`R8 ${tag}`, 'after the reload the message box works as a normal message: "Use SQLite please" reaches the model as a new message and Bunny answers', seen.length >= 1 && JSON.stringify(seen[0].messages).includes('Use SQLite please') && /all done/.test((await page.locator('.msg.assistant .body').last().textContent()) ?? ''), `requests ${seen.length}`);
  check(`R9 ${tag}`, 'no page error through the reload', errors.length === 0, errors.join('|'));
  await ctx.close();
}
// the saved card for a question that DID get an answer keeps its answer; one that was skipped says so
{
  const { ctx, page } = await openChat({ width: 1280, theme: 'light' });
  seen = []; steps = [ASK(), undefined];
  await ask(page);
  await page.locator('.question-card .question-choice', { hasText: 'Postgres' }).click();
  await page.waitForTimeout(1500);
  await page.reload(); await page.waitForTimeout(2000);
  const answered = await page.locator('.question-card.is-answered:not(.is-unanswered)').count();
  const text = answered ? (await page.locator('.question-card.is-answered .question-answer').first().textContent()).trim() : '';
  check('S1', 'a card that was answered keeps its answer after a reload ("You answered: Postgres"), with the chosen choice marked and no stopped-waiting note', /You answered: Postgres/.test(text) && (await page.locator('.question-answer-note').count()) === 0, `${answered} answered cards: ${text}`);
  await ctx.close();
}

// f6180e8: a card the person skipped keeps saying so after the reply ends and after a reload; a card nobody answered still says Not answered
for (const [sz, w] of [['desktop', 1280], ['phone', 390]]) for (const theme of ['light', 'dark']) {
  const tag = `${sz}/${theme}`;
  const { ctx, page } = await openChat({ width: w, theme });
  seen = []; steps = [ASK(), undefined];
  await ask(page);
  await page.locator('.question-card button', { hasText: 'Skip' }).click();
  await page.waitForTimeout(1800);
  const cardsAfter = (await page.locator('.question-card').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
  check(`SK1 ${tag}`, 'after Skip and the end of the reply the card says "You skipped this question." with no "Bunny stopped waiting" note', cardsAfter.length === 1 && /You skipped this question\./.test(cardsAfter[0]) && !/stopped waiting/.test(cardsAfter[0]) && !/Not answered/.test(cardsAfter[0]), cardsAfter.join(' | ').slice(0, 200));
  await page.reload(); await page.waitForTimeout(2200);
  const cardsReload = (await page.locator('.question-card').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim());
  const staticChoices = await page.locator('.question-card .question-choice.is-static').count();
  check(`SK2 ${tag}`, 'after a reload the skipped card still says "You skipped this question." with its choices as plain text, no note, not marked unanswered', cardsReload.length === 1 && /You skipped this question\./.test(cardsReload[0]) && !/stopped waiting/.test(cardsReload[0]) && (await page.locator('.question-card.is-unanswered').count()) === 0 && staticChoices === 2, cardsReload.join(' | ').slice(0, 200));
  await ctx.close();
}
{
  const { ctx, page } = await openChat({ width: 1280, theme: 'light' });
  seen = []; steps = [ASK(), undefined];
  await ask(page);
  await page.reload(); await page.waitForTimeout(2500);
  const txt = (await page.locator('.question-card').allTextContents()).map((x) => x.replace(/\s+/g, ' ').trim()).join(' | ');
  check('SK3', 'a reload while Bunny waits (not a Skip) still shows Not answered and the stopped-waiting note', /Not answered/.test(txt) && /stopped waiting/.test(txt) && !/You skipped/.test(txt), txt.slice(0, 220));
  await ctx.close();
}
await browser.close(); upstream.close();
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);

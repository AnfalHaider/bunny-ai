/**
 * QA, v0.1.9 POLISH (368b984, gaps 7 to 13), run on the candidate head: contrast of the picker labels and the amber switch line (light and dark, measured in the page),
 * the "no provider has it left" wording, the question guard (asksToRunCommands), goesThenStops, a schedule prompt of exactly 2,000 characters.
 *   node e2e/w019-polish.mjs
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';
const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { asksToRunCommands } = await imp('src/server/agentTools.js'); const { goesThenStops } = await imp('src/server/chat.js'); const { startApp } = await imp('test/helpers.js');
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : ''}`); };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };

// ---- gap 10: the question guard
const yes = ['I need you to run npm test and paste the output.', 'Open a terminal and run git status.', 'Kindly run the build and tell me what it says.', 'Let me know when you have run the migration.', 'Please run this on your machine: npm ci', 'Would you mind running the script?', 'Can you run it yourself?', 'Run the command in your terminal.', 'Paste the output here.', 'You will need to run it yourself.', 'I will run it myself once you tell me the command.', 'Execute the installer on your machine and report back.', 'Could you please run npm install?'];
const no = ['Should I run the tests?', 'Do you want me to run the build now?', 'Which colour should the button be?', 'Shall I run npm install in the project folder?', 'May I run the linter on all files?', 'I will run the tests if you say yes.', 'Would you like me to type the command into the terminal?', 'Do you want me to execute the script on your machine?'];
const yesRes = yes.map((q) => [q, asksToRunCommands({ question: q })]); const noRes = no.map((q) => [q, asksToRunCommands({ question: q })]);
console.log('INFO  guard misses (should be caught): ' + (yesRes.filter(([, r]) => !r).map(([q]) => JSON.stringify(q)).join(' | ') || 'none'));
console.log('INFO  guard false alarms (should NOT be caught): ' + (noRes.filter(([, r]) => r).map(([q]) => JSON.stringify(q)).join(' | ') || 'none'));
check('G10a', 'asksToRunCommands catches the earlier-missed hand-off phrasings and the plain ones (13 phrasings)', yesRes.every(([, r]) => r), yesRes.filter(([, r]) => !r).map(([q]) => q).join(' | '));
check('G10b', 'and does not catch Bunny asking about its own run, a colour question, or "type the command into the terminal?" (8 phrasings)', noRes.every(([, r]) => !r), noRes.filter(([, r]) => r).map(([q]) => q).join(' | '));
check('G10c', 'choices count too: a choice "I will run it myself" in a question that only offers hand-offs', asksToRunCommands({ question: 'How shall we continue?', choices: ['I will run it myself', 'Skip'] }) === true || asksToRunCommands({ question: 'How shall we continue?', choices: [{ label: 'Please run it yourself' }] }) === true, '');

// ---- gap 11: goesThenStops
const stopTable = [['yes, no problem', false], ['yes no problem at all', false], ['continue, don\'t stop', false], ['continue, do not stop', false], ['go on, no need to stop', false], ['keep going', false], ['yes', false], ['yes, stop', true], ['continue, stop', true], ['carry on, wait', true], ['yes, but stop after this', null], ['yes, no', true], ['continue, not yet', true], ['continue. Stop.', true], ['Yes, STOP', true], ['no', false], ['stop', false], ['yes, hold on', true], ['yes, not a problem', false]];
const stopRes = stopTable.map(([s, want]) => [s, want, goesThenStops(s)]);
console.log('INFO  goesThenStops: ' + stopRes.map(([s, , got]) => `${JSON.stringify(s)}=>${got}`).join('  '));
const bad = stopRes.filter(([, want, got]) => want !== null && want !== got);
check('G11', 'goesThenStops: "yes, no problem" / "continue, don\'t stop" go on; "continue, stop" / "yes, stop" stop (19 phrasings)', bad.length === 0, bad.map(([s, w, g]) => `${s}: wanted ${w} got ${g}`).join(' | '));

// ---- gap 12: the schedule card holds a prompt of exactly 2,000 characters (heading not counted); 2,001 is refused with a message
import { createServer } from 'node:http';
const NL = String.fromCharCode(10); const jj = { 'content-type': 'application/json' };
async function scheduleRun(promptLen) {
  const up = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, jj); res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] })); return; }
    const body = JSON.parse(raw); res.writeHead(200, { 'content-type': 'text/event-stream' }); const fr = (d) => 'data: ' + JSON.stringify({ choices: [{ delta: d }] }) + NL + NL;
    if (body.messages.some((m) => m.role === 'tool')) { res.end(fr({ content: 'done' }) + 'data: [DONE]' + NL + NL); return; }
    res.end(fr({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'schedule_task', arguments: JSON.stringify({ name: 'nightly', prompt: 'x'.repeat(promptLen), every_minutes: 60, may_change: true }) } }] }) + 'data: [DONE]' + NL + NL); }); });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const { base: b2 } = await startApp(t, { fake: false });
  await fetch(b2 + '/api/providers/openai/connect', { method: 'POST', headers: jj, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: 'http://127.0.0.1:' + up.address().port + '/v1' }) });
  const s = await (await fetch(b2 + '/api/sessions', { method: 'POST', headers: jj, body: JSON.stringify({ title: 'sched' }) })).json();
  await fetch(b2 + '/api/sessions/' + s.id + '/setting/permissionMode', { method: 'PATCH', headers: jj, body: JSON.stringify({ value: 'ask' }) });
  const res = await fetch(b2 + '/api/sessions/' + s.id + '/messages', { method: 'POST', headers: jj, body: JSON.stringify({ content: 'schedule a tidy-up', providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  const asked = []; let text = ''; const dec = new TextDecoder();
  for await (const chunk of res.body) { const part = dec.decode(chunk, { stream: true }); text += part; for (const m of part.matchAll(/event: permission\ndata: (.*)/g)) { const d = JSON.parse(m[1]); asked.push(d); await fetch(b2 + '/api/sessions/' + s.id + '/permission/' + d.id, { method: 'POST', headers: jj, body: JSON.stringify({ allowed: true }) }); } }
  const tasks = await (await fetch(b2 + '/api/schedules')).json(); up.close(); return { asked, text, tasks };
}
const fits = await scheduleRun(2000); const over = await scheduleRun(2001); const small = await scheduleRun(1900);
check('G12a', 'a schedule prompt of exactly 2,000 characters: one card, the whole prompt on it, nothing cut, and the task is made when allowed', fits.asked.length === 1 && fits.asked[0].detail.endsWith('x'.repeat(2000)) && !/not shown/.test(fits.asked[0].detail) && fits.tasks.length === 1, 'cards ' + fits.asked.length + '; tasks ' + fits.tasks.length);
check('G12b', 'a prompt of 2,001 characters is refused with a message that says "more than 2000" and no task is made', over.asked.length === 0 && /more than 2000/.test(over.text) && over.tasks.length === 0, over.text.replace(/\s+/g, ' ').slice(0, 220));
check('G12c', 'a prompt of 1,900 (the old failing range) is shown whole', small.asked.length === 1 && small.asked[0].detail.endsWith('x'.repeat(1900)), 'cards ' + small.asked.length);

// ---- gaps 7 and 8: contrast, measured in the page
const { base } = await startApp(t, { fake: true }); const { connectProvider } = await imp('test/helpers.js'); await connectProvider(base, 'anthropic'); await fetch(base + '/api/settings', { method: 'PUT', headers: jj, body: JSON.stringify({ modelFilter: 'all' }) });
const browser = await chromium.launch();
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, baseURL: base }); const page = await ctx.newPage();
  await page.goto('/'); await page.waitForSelector('#picker-button'); await page.waitForTimeout(1200); await page.locator('#picker-button').click(); await page.waitForSelector('.picker-panel');
  const m = await page.evaluate(() => {
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const bg = (e) => { for (; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m2 = c.match(/[\d.]+/g); if (m2 && (m2.length < 4 || Number(m2[3]) > 0.5)) return parse(c); } return [255, 255, 255]; };
    const out = {}; const panel = document.querySelector('.picker-panel');
    const add = (key, el) => { if (el) out[key] = { fg: parse(getComputedStyle(el).color), bg: bg(el), text: (el.textContent || '').trim().slice(0, 30) }; };
    add('group', panel.querySelector('.picker-group')); add('chipLabel', panel.querySelector('.picker-chip-label'));
    const note = document.createElement('div'); note.className = 'switch-note'; note.textContent = 'switch note sample'; panel.appendChild(note); add('switchNote', note);
    return out;
  });
  for (const [k, v] of Object.entries(m)) check(`C-${scheme}-${k}`, `${scheme}: ${k} ("${v.text}") has at least 4.5:1 against its background`, ratio(v.fg, v.bg) >= 4.5, `${ratio(v.fg, v.bg).toFixed(2)}:1 fg ${v.fg} bg ${v.bg}`);
  if (!m.group) check(`C-${scheme}-group-present`, `${scheme}: the picker shows a group label to measure`, false, 'no .picker-group in the panel');
  await ctx.close();
}
await browser.close();

// ---- gap 9: the wording of the fall-back line (in the page's text table)
const i18n = await imp('src/ui/i18n-agent.js').catch(() => null);
const src = (await import('node:fs')).readFileSync('src/ui/i18n-agent.js', 'utf8'); const line = src.split('\n').find((l) => /switchedModel/.test(l)) ?? '';
console.log('INFO  switched-model line: ' + line.trim().slice(0, 300)); void i18n;
check('G9', 'the "no provider has it left" line has no brackets inside brackets and mentions the other providers\' failure through {more}', line.length > 0 && !/\([^)]*\([^)]*\)/.test(line) && /\{more\}/.test(line), line.trim().slice(0, 220));

// ---- gap 13: two clear search-stop messages (real workspace, real files, real clock)
{
  const { createWorkspace } = await imp('src/server/workspace.js'); const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const evil = '(a+)+' + String.fromCharCode(36);
  const root = mkdtempSync(join(tmpdir(), 'bunny-w019-polish-ws-')); writeFileSync(join(root, 'evil.txt'), 'a'.repeat(40) + '!');
  const ws = createWorkspace(root, {}); let msg = ''; const t0 = Date.now();
  try { await ws.run('search_files', { query: evil, regex: true }); msg = 'NO ERROR'; } catch (e) { msg = e.message; }
  check('G13a', 'a pattern that one file cannot finish in a second says so ("one file took more than a second"), not "after 5 s"', /one file took more than a second/.test(msg), msg + ' (' + (Date.now() - t0) + ' ms)');
  rmSync(root, { recursive: true, force: true });
  const big = mkdtempSync(join(tmpdir(), 'bunny-w019-polish-ws2-')); for (let i = 0; i < 12; i += 1) writeFileSync(join(big, 'f' + i + '.txt'), 'a'.repeat(40) + '!');
  const ws2 = createWorkspace(big, {}); let msg2 = ''; const t1 = Date.now();
  try { await ws2.run('search_files', { query: evil, regex: true }); msg2 = 'NO ERROR'; } catch (e) { msg2 = e.message; }
  console.log('INFO  twelve slow files: "' + msg2 + '" after ' + (Date.now() - t1) + ' ms');
  check('G13b', 'with many slow files the whole search stops by itself within about 6 s and says so in words', /Search stopped/.test(msg2) && (Date.now() - t1) < 9000, msg2 + ' (' + (Date.now() - t1) + ' ms)');
  rmSync(big, { recursive: true, force: true });
}
for (const f of cleanups) { try { await f(); } catch { /* x */ } }
const badRows = rows.filter((r) => !r.ok); console.log(String.fromCharCode(10) + (rows.length - badRows.length) + ' of ' + rows.length + ' passed'); process.exit(badRows.length ? 1 : 0);

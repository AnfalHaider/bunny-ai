/**
 * QA, W4-14 at 304e71a: "Bunny was not able to run commands and asked the person to" (owner's report).
 * Desktop-style server (folderPickerOnly: the window answers cards through the main-process stand-in app.adminFetch; a plain request with the
 * launch token gets 403), invented data folder, a scripted OpenAI-style model that records every request it receives and replays a script.
 * The owner's four ways in (Tech Lead's list in the W4-11 audit, G): Plan mode inside a Code chat, a Chat-mode chat, a Code chat with no
 * usable folder, and a code_mode grant made while in Plan mode. Then the fix: Bunny runs the command itself, or asks to leave Plan mode.
 *   node e2e/w414-walk.mjs      (from a checkout that has test/helpers.js)
 */
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp, post } = await imp('test/helpers.js');
const { asksToRunCommands } = await imp('src/server/agentTools.js');
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 260) : ''}`); };

// ---- the scripted provider: steps[i] is { name, args } (a tool call on request i) or undefined (answer "done")
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
      : { choices: [{ delta: { content: 'done' } }] };
    res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
const { app, base } = await startApp(t, { fake: false, folderPickerOnly: true });
const admin = (path, init) => app.adminFetch(path, init);
await admin('/api/providers/openai/connect', { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` }) });
const folderDir = await mkdtemp(join(tmpdir(), 'bunny-qa-w414-'));
await app.chooseFolder(folderDir);

const toolNames = (b) => (b?.tools ?? []).map((d) => d.function.name);
const systemText = (b) => (b?.messages ?? []).filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n');
const toolMsgs = (b) => (b?.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content));

/** One reply in a fresh chat. `answer(event, data, ctx)` answers cards. */
async function reply({ mode = 'ask', workMode = 'code', folder = folderDir, content = 'bootstrap this project from the GitHub link', script = [], answer = null, defaultMode = null } = {}) {
  seen = []; steps = script;
  if (defaultMode) await admin('/api/settings', { method: 'PUT', headers: j, body: JSON.stringify({ defaultPermissionMode: defaultMode }) });
  const { body: s } = await post(base, '/api/sessions', { title: 'w414', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => admin(`/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  if (folder) await set('folder', folder);
  await set('workMode', workMode); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode }), signal: AbortSignal.timeout(40000) });
  const events = []; let buf = '';
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1]; const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || !data) continue;
      let parsed; try { parsed = JSON.parse(data); } catch { continue; }
      events.push({ event, data: parsed });
      if (answer) await answer(event, parsed, { sessionId: s.id });
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  return { events, sessionId: s.id, saved, requests: [...seen] };
}
const kinds = (r, name) => r.events.filter((e) => e.event === name);
const yesCapability = (granted = true) => async (event, data, { sessionId }) => { if (event === 'capability') await admin(`/api/sessions/${sessionId}/capability/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ granted }) }); };
const yesAll = (granted = true) => async (event, data, { sessionId }) => {
  if (event === 'capability') await admin(`/api/sessions/${sessionId}/capability/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ granted }) });
  if (event === 'permission') await admin(`/api/sessions/${sessionId}/permission/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: true }) });
};
const RUN_ASK = { name: 'ask_user', args: { question: 'Can you run these commands in PowerShell for me?', choices: ['Yes, I will run them', 'No'] } };

// ================= 1. Plan mode inside a Code chat (the likeliest way the owner got there) =================
{
  const r = await reply({ mode: 'plan', workMode: 'code' });
  const b = r.requests[0]; const sys = systemText(b); const names = toolNames(b);
  check('P1', 'Plan mode in a Code chat: the model is NOT promised run_command (the old "You run commands yourself" text is gone) and is told it is in Plan mode', !/You run commands yourself/.test(sys) && /You are in Plan mode: you cannot run commands/.test(sys), sys.slice(sys.indexOf('Plan mode') - 10, sys.indexOf('Plan mode') + 120));
  check('P2', 'it is told never to ask the person to run a command and how to get out (request_capability with leave_plan_mode)', /Never ask the person to run a command in a terminal/.test(sys) && /leave_plan_mode/.test(sys));
  check('P3', 'the tools it really has match the text: no run_command, start_process, write_file or edit_file; request_capability and ask_user are there', !['run_command', 'start_process', 'write_file', 'edit_file', 'multi_edit'].some((n) => names.includes(n)) && ['request_capability', 'ask_user'].every((n) => names.includes(n)), names.join());
}
// ================= 2. The owner's exact case: the model asks the person to run commands =================
{
  const r = await reply({ mode: 'plan', workMode: 'code', script: [RUN_ASK, { name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'run the setup commands' } }, { name: 'run_command', args: { command: 'echo bootstrapped' } }], answer: yesAll(true) });
  check('O1', 'the "Bunny asked: can you run these commands in PowerShell?" card is NOT shown (no question event)', kinds(r, 'question').length === 0, `${kinds(r, 'question').length} question events`);
  const refusal = toolMsgs(r.requests[1])[0] ?? '';
  check('O2', 'the model is told, in its tool result, not to ask the person to run commands, that this is Plan mode, and to call request_capability with leave_plan_mode', /Do not ask the person to run commands/.test(refusal) && /Plan mode/.test(refusal) && /leave_plan_mode/.test(refusal), refusal.slice(0, 220));
  const cap = kinds(r, 'capability')[0]?.data;
  check('O3', 'the model asks to leave Plan mode: a card "Leave Plan mode" with its reason is shown to the person', cap?.capability === 'leave_plan_mode' && /Leave Plan mode/i.test(cap?.title ?? '') && /setup commands/.test(cap?.reason ?? ''), JSON.stringify(cap).slice(0, 200));
  const after = await (await fetch(`${base}/api/sessions/${r.sessionId}`)).json();
  check('O4', 'the window says yes: this chat is now in ASK mode (never Auto) and the model is told so, with the tools it now has', after.permissionMode === 'ask' && /now in Ask mode/.test(toolMsgs(r.requests[2])[1] ?? toolMsgs(r.requests[2]).join(' ')) && /run_command/.test(toolMsgs(r.requests[2]).join(' ')), `mode ${after.permissionMode}; ${toolMsgs(r.requests[2]).join(' | ').slice(0, 200)}`);
  check('O5', 'the next request carries run_command and start_process, and the old Plan-mode refusal tools-list had none', toolNames(r.requests[2]).includes('run_command') && toolNames(r.requests[2]).includes('start_process') && !toolNames(r.requests[0]).includes('run_command'), toolNames(r.requests[2]).join());
  const perm = kinds(r, 'permission')[0]?.data;
  check('O6', 'Bunny then runs the command ITSELF: because the chat is in Ask mode it first asks the person to allow it (a card for the command, not a request to type it), and the command ran', Boolean(perm) && /echo bootstrapped/.test(JSON.stringify(perm)) && /bootstrapped/.test(toolMsgs(r.requests[3]).join(' ')), `${JSON.stringify(perm).slice(0, 140)} | ${toolMsgs(r.requests[3]).join(' ').slice(0, 80)}`);
  check('O7', 'at no point does the reply end by telling the person to run it: the only question-like thing shown is the leave-plan card; the final text is the scripted "done"', kinds(r, 'question').length === 0 && (r.saved.messages.at(-1)?.content ?? '') === 'done', (r.saved.messages.at(-1)?.content ?? '').slice(0, 60));
}
// ================= 3. Saying no keeps Plan mode =================
{
  const r = await reply({ mode: 'plan', workMode: 'code', script: [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'run it' } }], answer: yesCapability(false) });
  const after = await (await fetch(`${base}/api/sessions/${r.sessionId}`)).json();
  check('N1', 'No on the card: the chat stays in Plan mode, the model gets no run tools, and the model is told the person said no', after.permissionMode === 'plan' && !toolNames(r.requests.at(-1)).includes('run_command') && /(declin|not|no)/i.test(toolMsgs(r.requests[1]).join(' ')), `mode ${after.permissionMode}; ${toolMsgs(r.requests[1]).join(' ').slice(0, 120)}`);
}
// ================= 4. Only the window may say yes; the mode can never become Auto =================
{
  seen = []; steps = [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'run it' } }];
  const { body: s } = await post(base, '/api/sessions', { title: 'w414-ho', providerId: 'openai', model: 'gpt-4o' });
  for (const [n, v] of [['folder', folderDir], ['workMode', 'code'], ['permissionMode', 'plan']]) await admin(`/api/sessions/${s.id}/setting/${n}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: v }) });
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'go', providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let plain = null; let code = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let cut; while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      if (/^event: capability/m.test(frame)) {
        const data = JSON.parse(/^data: (.*)$/m.exec(frame)[1]);
        plain = await fetch(`${base}/api/sessions/${s.id}/capability/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ granted: true }) }); // a program holding the launch token, not the window
        code = plain.status;
        await admin(`/api/sessions/${s.id}/capability/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ granted: false }) }); // let the reply finish
      }
    }
  }
  const after = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  check('H1', 'a plain request with the launch token (not the window) cannot answer the leave-plan card: 403, and the chat is still in Plan mode', code === 403 && after.permissionMode === 'plan', `status ${code}; mode ${after.permissionMode}`);
  const patch = await fetch(`${base}/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: 'ask' }) });
  check('H2', 'the permission mode itself cannot be changed over plain HTTP either (403), so the model cannot leave Plan mode by any other road', patch.status === 403, `status ${patch.status}`);
}
// the default mode being Auto must not leak into "leave plan mode"
{
  const r = await reply({ mode: 'plan', workMode: 'code', defaultMode: 'auto', script: [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'run it' } }], answer: yesCapability(true) });
  const after = await (await fetch(`${base}/api/sessions/${r.sessionId}`)).json();
  check('H3', 'with the default mode set to Auto, leaving Plan mode still goes to Ask (never Auto)', after.permissionMode === 'ask', `mode ${after.permissionMode}`);
  await admin('/api/settings', { method: 'PUT', headers: j, body: JSON.stringify({ defaultPermissionMode: 'ask' }) });
}
// ================= 5. leave_plan_mode when it makes no sense =================
{
  const a = await reply({ mode: 'ask', workMode: 'code', script: [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'x' } }] });
  check('L1', 'leave_plan_mode in a chat that is not in Plan mode shows no card and tells the model so', kinds(a, 'capability').length === 0 && /not in Plan mode/.test(toolMsgs(a.requests[1]).join(' ')), toolMsgs(a.requests[1]).join(' ').slice(0, 120));
  const b = await reply({ mode: 'plan', workMode: 'code', folder: null, script: [{ name: 'request_capability', args: { capability: 'leave_plan_mode', reason: 'x' } }] });
  check('L2', 'leave_plan_mode with no folder shows no card and points the model at code_mode', kinds(b, 'capability').length === 0 && /No folder is chosen/.test(toolMsgs(b.requests.at(-1)).join(' ')) && /code_mode/.test(toolMsgs(b.requests.at(-1)).join(' ')), toolMsgs(b.requests.at(-1)).join(' ').slice(0, 160));
}
// ================= 6. The question guard =================
{
  const r = await reply({ mode: 'plan', workMode: 'code', script: [RUN_ASK, RUN_ASK, RUN_ASK, RUN_ASK], answer: async (event, data, { sessionId }) => { if (event === 'question') await admin(`/api/sessions/${sessionId}/question/${data.id}`, { method: 'POST', headers: j, body: JSON.stringify({ answer: 'No' }) }); } });
  check('Q1', 'the same ask three times is refused each time with no card; the fourth is shown (a real choice may look like this)', kinds(r, 'question').length === 1 && toolMsgs(r.requests.at(-1)).length >= 3, `${kinds(r, 'question').length} question card(s)`);
  const phrases = [
    ['Can you run these commands in PowerShell for me?', true], ['Please paste the output of this command from your terminal', true], ['Could you execute the script in cmd and tell me what it prints?', true],
    ['Run the following commands in your shell: npm install', true], ['Type these commands into a terminal window', true],
    ['Which framework do you want to use, React or Vue?', false], ['What should the project be called?', false], ['Do you want me to continue with the plan?', false],
    ['Should I use npm or pnpm?', false], ['Which folder should the project go in?', false], ['I will run the commands now. Do you agree with the plan?', false],
    ['Which of these scripts should I run first: build or test?', null], ['Do you want me to run the commands now or review them first?', null],
  ];
  let wrong = [];
  for (const [q, want] of phrases) { const got = asksToRunCommands({ question: q }); if (want !== null && got !== want) wrong.push(`${q} -> ${got}`); }
  check('Q2', 'the guard (asksToRunCommands) catches the person-runs-it phrasings and lets ordinary questions through', wrong.length === 0, wrong.join(' | ') || `${phrases.filter((p) => p[1] !== null).length} phrases right`);
  const edge = phrases.filter((p) => p[1] === null).map(([q]) => `"${q}" -> ${asksToRunCommands({ question: q })}`);
  console.log(`INFO  genuine consent or choice questions that mention running: ${edge.join(' ; ')} (a question that matches is not shown and the model is told to run them itself; the fourth is shown)`);
  const choicesOnly = asksToRunCommands({ question: 'What next?', choices: [{ label: 'I will run the commands myself' }, { label: 'Cancel' }] });
  check('Q3', 'the guard also reads the choices (an option "I will run the commands myself")', choicesOnly === true);
  check('Q4', 'the guard does not crash on odd input (no question, null choices, numbers)', [{}, { question: null }, { question: 5, choices: null }, { question: 'x', choices: [null, 3, {}] }].every((q) => { try { asksToRunCommands(q); return true; } catch { return false; } }));
}
// ================= 7. Chat mode =================
{
  const r = await reply({ mode: 'ask', workMode: 'chat', folder: null, script: [RUN_ASK, { name: 'request_capability', args: { capability: 'code_mode', reason: 'run the setup commands' } }], answer: yesCapability(false) });
  check('C1', 'Chat mode: the same ask is refused (no card) and the model is told there is no folder and to call request_capability with code_mode', kinds(r, 'question').length === 0 && /request_capability with code_mode/.test(toolMsgs(r.requests[1]).join(' ')), toolMsgs(r.requests[1]).join(' ').slice(0, 200));
  const cap = kinds(r, 'capability')[0]?.data;
  check('C2', 'the code_mode card is shown, and says there is no folder yet (hasFolder false) so the person can pick one', cap?.capability === 'code_mode' && cap?.hasFolder === false, JSON.stringify(cap).slice(0, 180));
}
// ================= 8. Code chat whose folder is missing =================
{
  const gone = join(tmpdir(), 'bunny-qa-w414-does-not-exist');
  const r = await reply({ mode: 'ask', workMode: 'code', folder: gone });
  const b = r.requests[0]; const sys = systemText(b);
  check('F1', 'a Code chat whose folder is missing: no promise of run_command, the model is told to call request_capability with code_mode, and it has no run or file tools', !/You run commands yourself/.test(sys) && /no workspace folder is usable yet/.test(sys) && /code_mode/.test(sys) && !toolNames(b).includes('run_command'), toolNames(b).join());
  const notice = kinds(r, 'notice')[0]?.data;
  check('F2', 'the person is told once, in the chat, with the folder picker: "No folder is chosen ... Choose a folder to work in"', /No folder is chosen/.test(notice?.text ?? '') && notice?.folderPicker === true, JSON.stringify(notice));
}
// ================= 9. The normal case: Bunny runs the command itself =================
{
  const r = await reply({ mode: 'ask', workMode: 'code', script: [{ name: 'run_command', args: { command: 'echo ran-by-bunny' } }], answer: yesAll(true) });
  const sys = systemText(r.requests[0]);
  check('R1', 'Ask mode in a Code chat: the model is told it runs commands itself and has run_command', /You run commands yourself with run_command/.test(sys) && toolNames(r.requests[0]).includes('run_command'));
  check('R2', 'it runs the command itself after one allow card, and sees the real output', kinds(r, 'permission').length === 1 && /ran-by-bunny/.test(toolMsgs(r.requests[1]).join(' ')), toolMsgs(r.requests[1]).join(' ').slice(0, 80));
  const a = await reply({ mode: 'auto', workMode: 'code', script: [{ name: 'run_command', args: { command: 'echo auto-run' } }] });
  check('R3', 'Auto mode: it runs the command with no card at all', kinds(a, 'permission').length === 0 && /auto-run/.test(toolMsgs(a.requests[1]).join(' ')), toolMsgs(a.requests[1]).join(' ').slice(0, 80));
}
// ================= 10. A code_mode grant made while in Plan mode (the fourth way in) =================
{
  const r = await reply({ mode: 'plan', workMode: 'chat', folder: folderDir, script: [{ name: 'request_capability', args: { capability: 'code_mode', reason: 'work on the project' } }], answer: yesCapability(true) });
  const after = r.requests[1]; const sys = systemText(after); const text = toolMsgs(after).join(' ');
  const joined = sys + ' ' + text + ' ' + JSON.stringify((after.messages ?? []).filter((m) => m.role === 'user').map((m) => m.content));
  check('G1', 'code_mode granted in a Plan-mode chat: the model is NOT told it can run commands; it is given the Plan-mode wording instead', !/You run commands yourself/.test(joined) && /Plan mode/.test(joined), joined.slice(joined.indexOf('Ignore what') , joined.indexOf('Ignore what') + 160));
  check('G2', 'and it still has no run_command until the person leaves Plan mode', !toolNames(after).includes('run_command'), toolNames(after).join());
}

await new Promise((r) => upstream.close(r));
await rm(folderDir, { recursive: true, force: true }).catch(() => {});
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
void existsSync; void readFile; void writeFile;
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

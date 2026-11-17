/**
 * QA, LA-4b, W3-3 and W6-14 (card never cut): runs the real server (createApp with an invented data folder, a scripted
 * OpenAI-style model on a local port) and drives tool calls in every permission mode, answering the confirmation cards.
 *   node e2e/w6-la4b-w33-walk.mjs      (from a checkout that has test/helpers.js)
 * The model replies to a message "call <tool> <json arguments>" with that one tool call, then "done".
 */
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const helpers = await import(pathToFileURL(join(process.cwd(), 'test', 'helpers.js')).href);
const { startApp, post } = helpers;
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).slice(0, 230) : ''}`); };

const { base } = await startApp(t, { fake: false });
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
    const body = JSON.parse(raw);
    const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    const m = /^call (\w+) (.*)$/s.exec(asked);
    const done = body.messages.some((x) => x.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (m && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: m[1], arguments: m[2] } }] }) + 'data: [DONE]\n\n');
    else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
await fetch(base + '/api/settings', { method: 'PUT', headers: j, body: JSON.stringify({ customToolsEnabled: true }) });
await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });

async function run(mode, tool, args, { answer = true, workMode = 'code', seed = null } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-qa-w33-'));
  await mkdir(join(folder, 'sub'), { recursive: true });
  if (seed) await seed(folder);
  const { body: s } = await post(base, '/api/sessions', { title: 'qa', providerId: 'openai', model: 'gpt-4o' });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', workMode); await set('permissionMode', mode);
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: `call ${tool} ${JSON.stringify(args)}`, providerId: 'openai', model: 'gpt-4o' }), signal: AbortSignal.timeout(40000) });
  const cards = []; let buf = ''; let all = '';
  const reader = res.body.getReader(); const dec = new TextDecoder(); let timedOut = false;
  for (;;) {
    let chunk; try { chunk = await reader.read(); } catch { timedOut = true; break; }
    const { done, value } = chunk; if (done) break;
    const piece = dec.decode(value, { stream: true }); buf += piece; all += piece;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) {
        const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card);
        await fetch(`${base}/api/sessions/${s.id}/permission/${card.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: answer }) });
      }
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  const step = saved.messages.find((x) => x.kind === 'tool_call');
  const results = [...all.matchAll(/"result":"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]).join(' | ');
  return { cards, status: timedOut ? 'timeout' : step?.status ?? 'none', stream: all, results, step, timedOut };
}
const getJson = async (p) => (await fetch(base + p)).json();

const TOOL = { name: 'qa_hello', description: 'says hello', script: 'Write-Output "hello"' };
const SCHED = { name: 'qa-sched', prompt: 'look at the repo', every_minutes: 60 };
const CONN = { name: 'qa-conn', command: 'node', args: ['--version'] };

// ---- W3-3: Auto still asks for exactly three things
for (const mode of ['auto', 'ask', 'accept']) {
  const r = await run(mode, 'create_tool', TOOL);
  check(`A1 ${mode}`, 'create_tool shows one card', r.cards.length === 1, `${r.cards.length} cards, status ${r.status}`);
}
{
  const no = await run('auto', 'create_tool', { ...TOOL, name: 'qa_denied' }, { answer: false });
  check('A2', 'Auto: Deny on the create_tool card builds nothing and says denied', no.status === 'denied' && !/my_qa_denied/.test(JSON.stringify(await getJson('/api/settings'))), `status ${no.status}`);
  const yes = await run('auto', 'create_tool', { ...TOOL, name: 'qa_allowed' }, { answer: true });
  check('A3', 'Auto: Allow on the card builds it', yes.cards.length === 1 && yes.status === 'done', `status ${yes.status}; ${yes.results.slice(0, 80)}`);
}
{
  const a = await run('auto', 'schedule_task', { ...SCHED, may_change: true });
  check('B1', 'Auto: a schedule with may_change true asks once', a.cards.length === 1, `${a.cards.length} cards, status ${a.status}`);
  const b = await run('auto', 'schedule_task', { ...SCHED, name: 'qa-sched-b', may_change: false });
  check('B2', 'Auto: may_change false runs unasked', b.cards.length === 0 && b.status === 'done', `${b.cards.length} cards, status ${b.status}`);
  const c = await run('auto', 'schedule_task', { ...SCHED, name: 'qa-sched-c' });
  check('B3', 'Auto: a schedule with no may_change runs unasked', c.cards.length === 0 && c.status === 'done', `${c.cards.length} cards, status ${c.status}`);
  const d = await run('auto', 'schedule_task', { ...SCHED, name: 'qa-sched-d', may_change: true }, { answer: false });
  check('B4', 'Auto: Deny on the schedule card creates no schedule', d.status === 'denied', `status ${d.status}`);
  const e = await run('auto', 'schedule_task', { ...SCHED, name: 'qa-sched-e', may_change: 'true' });
  check('B5', 'Auto: may_change as the text "true" is not treated as true (strict boolean)', e.cards.length === 0, `${e.cards.length} cards, status ${e.status}; the stored task would then run changes unasked if the server coerces it`);
  const tasks = JSON.stringify(await getJson('/api/schedules').catch(() => ({})));
  const taskE = tasks.includes('qa-sched-e') ? tasks.match(/qa-sched-e[^}]*/)?.[0] : 'not listed';
  check('B6', 'what the text "true" is stored as (may_change must not be on if no card was shown)', !/may_?change"?\s*:\s*true/i.test(taskE ?? ''), taskE);
}
{
  const a = await run('auto', 'add_connector', CONN);
  check('C1', 'Auto: a local connector asks once with the exact command line', a.cards.length === 1 && /node/.test(a.cards[0].detail) && /--version/.test(a.cards[0].detail), a.cards[0]?.detail?.replace(/\s+/g, ' '));
  const b = await run('auto', 'add_connector', { name: 'qa-remote', url: 'https://example.invalid/mcp' });
  check('C2', 'Auto: a remote connector by address runs unasked', b.cards.length === 0, `${b.cards.length} cards, status ${b.status}; ${b.results.slice(0, 100)}`);
  const c = await run('auto', 'add_connector', { name: 'qa-blank', command: '   ', url: 'https://example.invalid/mcp2' });
  check('C3', 'Auto: a blank command with an address is a remote one (no card)', c.cards.length === 0, `${c.cards.length} cards`);
  const d = await run('auto', 'add_connector', CONN, { answer: false });
  check('C4', 'Auto: Deny on the connector card adds nothing', d.status === 'denied' && !JSON.stringify(await getJson('/api/settings')).includes('qa-conn'), `status ${d.status}`);
  const e = await run('auto', 'add_connector', { name: 'qa-sneaky', command: ' node ', url: 'https://example.invalid/m3', args: ['--version'] });
  check('C5', 'Auto: a command with spaces around it plus an address still asks', e.cards.length === 1, `${e.cards.length} cards`);
  const f = await run('auto', 'add_connector', { name: 'qa-evil', command: 'powershell', args: ['-c', 'echo hi'] });
  check('C6', 'a program that is not on the allowed list is refused (no card, nothing run)', f.cards.length <= 1 && /not allowed|not one of|cannot|can.t|only/i.test(f.results) , `${f.cards.length} cards; ${f.results.slice(-160)}`);
}
{
  const w = await run('auto', 'write_file', { path: 'a.txt', content: 'x' });
  check('D1', 'Auto: writing a file still runs unasked', w.cards.length === 0 && w.status === 'done', `${w.cards.length} cards, ${w.status}`);
  const rc = await run('auto', 'run_command', { command: 'echo hi' });
  check('D2', 'Auto: running a command still runs unasked', rc.cards.length === 0 && rc.status === 'done', `${rc.cards.length} cards, ${rc.status}`);
  const ky = await run('auto', 'computer_key', { key: 'a' });
  check('D3', 'Auto: a computer-use key press does not ask (computer use is off here, so it may be refused for that reason)', ky.cards.length === 0, `${ky.cards.length} cards; ${ky.results.slice(0, 100)}`);
  const m = await run('ask', 'run_command', { command: 'echo hi' });
  check('D4', 'Manual: a command still asks (unchanged)', m.cards.length === 1);
}

// ---- W6-14: a card is never cut
{
  const long = await run('auto', 'create_tool', { ...TOOL, name: 'qa_long', script: `Write-Output "${'a'.repeat(2100)}"` });
  check('E1', 'create_tool over 2,000 characters is refused with a plain message, no card', long.cards.length === 0 && /too long to show in full/i.test(long.results + long.stream), `${long.cards.length} cards; ${long.results.slice(0, 120)}`);
  const lc = await run('auto', 'add_connector', { name: 'qa-longc', command: 'node', args: ['-e', 'x'.repeat(2100)] });
  check('E2', 'a local connector over 2,000 characters is refused, no card', lc.cards.length === 0 && /too long to show in full/i.test(lc.results + lc.stream), `${lc.cards.length} cards; ${lc.results.slice(0, 120)}`);
  const rc = await run('ask', 'run_command', { command: `echo ${'a'.repeat(2100)} & echo the-hidden-tail` });
  check('E3', 'run_command over 2,000 characters is refused even in Manual; the hidden tail is never run', rc.cards.length === 0 && /too long to show in full/i.test(rc.results + rc.stream), `${rc.cards.length} cards`);
  const fit = await run('ask', 'run_command', { command: `echo ${'a'.repeat(1900)}` });
  check('E4', 'a command of 1,900 characters still asks and the card shows all of it', fit.cards.length === 1 && fit.cards[0].detail.length >= 1900 && !/not shown here/.test(fit.cards[0].detail), `${fit.cards[0]?.detail?.length} characters`);
  const exact = await run('ask', 'run_command', { command: 'e'.repeat(2000) });
  check('E5', 'a command of exactly 2,000 characters asks (limit is "over 2,000")', exact.cards.length === 1, `${exact.cards.length} cards`);
  const exact1 = await run('ask', 'run_command', { command: 'e'.repeat(2001) });
  check('E6', 'a command of 2,001 characters is refused', exact1.cards.length === 0 && /too long/i.test(exact1.results + exact1.stream), `${exact1.cards.length} cards`);
  const wf = await run('ask', 'write_file', { path: 'big.txt', content: 'x'.repeat(3000) });
  check('E7', 'a long file being written is cut on the card with a note saying how much is not shown', wf.cards.length === 1 && /1\d{3} more characters are not shown here/.test(wf.cards[0].detail), wf.cards[0]?.detail?.slice(-80));
}

// ---- LA-4b: the message when a search is cut off
{
  const seed = async (f) => { await writeFile(join(f, 'a.txt'), 'a'.repeat(45) + '!\n'); };
  const began = Date.now();
  const r = await run('auto', 'search_files', { query: '(a+)+$', regex: true }, { seed });
  const took = Date.now() - began;
  check('F1', 'a catastrophic regex is stopped and the tool result says: Search stopped after 5 s; narrow the folder or the pattern.', /Search stopped after 5 s; narrow the folder or the pattern\./.test(r.results), r.results.slice(-120));
  check('F2', 'the old wording is gone', !/too slow/.test(r.stream));
  check('F3', 'the reply finishes with the step failed or done (not stuck)', !r.timedOut && (r.status === 'failed' || r.status === 'done'), `status ${r.status}, took ${took} ms`);
  check('F4', 'the stop came well before 5 s (one file hits its own 1 s limit), so the words "after 5 s" are only roughly true here', took < 4500, `whole reply ${took} ms`);
  const ok = await run('auto', 'search_files', { query: 'a+', regex: true }, { seed });
  check('F5', 'a fine regex over the same folder finishes with matches and no stop message', !/Search stopped/.test(ok.results) && ok.status === 'done', ok.results.slice(0, 100));
}

// ---- W6-14: a local connector's first start shows progress; stopping it ends the whole tree
{
  const { readFileSync, existsSync } = await import('node:fs');
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  const fixture = join(process.cwd(), 'test', 'fixtures', 'mcp-slow-start-server.mjs');
  const pidFile = join(await mkdtemp(join(tmpdir(), 'bunny-qa-w614-')), 'pids.txt');
  // clear the earlier invented connectors so only this one starts
  for (const c of await getJson('/api/mcp')) await fetch(`${base}/api/mcp/${c.id}`, { method: 'DELETE' });
  const add = await post(base, '/api/mcp', { name: 'qa-slow', command: 'node', args: [fixture, '4000', pidFile], confirmLocal: true });
  check('G1', 'a local connector is added only with the confirmation flag (and the same call without it is refused)', add.status === 200 && (await post(base, '/api/mcp', { name: 'qa-slow2', command: 'node', args: [fixture, '0'] })).status === 400, `add ${add.status}`);
  const began = Date.now();
  const r = await run('auto', 'list_files', { depth: 1 });
  const took = Date.now() - began;
  const lines = [...r.stream.matchAll(/Starting qa-slow[^"\\]*/g)].map((m) => m[0]);
  check('G2', 'the first start says it can take a few minutes and counts the seconds while it waits', lines.length >= 2 && lines.some((l) => /first start can take a few minutes/.test(l)) && lines.some((l) => /… [1-9]\d*s/.test(l)), `${lines.length} progress lines, took ${took} ms: ${lines.slice(0, 3).join(' / ')}`);
  check('G3', 'the 4 s start finishes and the reply completes (not the short limit)', r.status === 'done' && took >= 3500 && took < 20000, `status ${r.status}, ${took} ms`);
  check('G4', 'the connector log lines shown are cleaned: no secret value, no colour codes, long lines cut', !/abc123secretvalue/.test(r.stream) && !/\u001b|\u001b/.test(r.stream) && !/x{250}/.test(r.stream), `secret in stream: ${/abc123secretvalue/.test(r.stream)}; long x run: ${/x{250}/.test(r.stream)}`);
  const pids = existsSync(pidFile) ? readFileSync(pidFile, 'utf8').trim().split(/\s+/).map(Number) : [];
  check('G5', 'the connector and its helper program both run', pids.length === 2 && pids.every(alive), `pids ${pids.join(',')}`);
  const list = await getJson('/api/mcp'); const id = list.find((c) => c.name === 'qa-slow')?.id;
  const del = await fetch(`${base}/api/mcp/${id}`, { method: 'DELETE' });
  await new Promise((res) => setTimeout(res, 1500));
  check('G6', 'removing the connector ends the program and the helper it started (the whole tree)', del.status === 200 && pids.length === 2 && pids.every((p) => !alive(p)), `alive after: ${pids.map(alive).join(',')}`);
  const set2 = await post(base, '/api/mcp', { name: 'qa-nosecret', command: 'node', args: [fixture, '0'], env: { API_KEY: 'sk-live-abc' }, confirmLocal: true });
  const chatAdd = await run('auto', 'add_connector', { name: 'qa-env', command: 'node', args: ['--version'], env: { API_KEY: 'sk-live-abc' } });
  check('G7', 'a key passed through the chat is not taken (card shows no secret value or the add is refused)', !/sk-live-abc/.test(chatAdd.cards.map((c) => c.detail).join('') + chatAdd.stream.replace(/"args"[^}]*/g, '')) || chatAdd.cards.length === 1, `${chatAdd.cards.length} cards; ${chatAdd.results.slice(-120)}`);
  void set2;
}

await new Promise((r) => upstream.close(r));
for (const f of cleanups) { try { await f(); } catch {} }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

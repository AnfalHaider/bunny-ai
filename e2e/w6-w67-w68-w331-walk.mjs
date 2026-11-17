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

const hintOf = (r) => (/\[hint: ([^\]]*)\]/.exec(r.results.replace(/\\n/g, ' ')) ?? [])[1] ?? null;
const cmd = (command, mode = 'auto') => run(mode, 'run_command', { command });

// ---- W6-7: a failed cmd or POSIX line says how PowerShell writes it
for (const [line, want] of [['grep foo missing.txt', 'grep -> findstr'], ['which node-qa-none', 'which -> where.exe'], ['export QA_X=1', 'export -> $env:NAME'], ['rm -rf nothing-here', 'rm -> del'], ['head -n 3 missing.txt', 'head ->'], ['sed s/a/b/ missing.txt', 'sed ->'], ['chmod +x a.sh', 'chmod ->'], ['touch a.txt', 'touch ->'], ['mkdir -p x/y/z', 'mkdir -p'], ['set QA_Y=2', 'set NAME=value ->'], ['cat missing.txt && echo after', 'cat ->']]) {
  const r = await cmd(line);
  check(`H ${line}`, `a failed "${line}" ends with a hint that names ${want}`, hintOf(r) !== null && hintOf(r).includes(want.replace(/ ->.*/, '')), `status ${r.status}; hint ${hintOf(r)}`);
}
{
  const ok = await cmd('echo fine');
  check('H20', 'a command that works has no hint', hintOf(ok) === null && ok.status === 'done', `status ${ok.status}`);
  const okPosixAlias = await cmd('ls');
  check('H21', 'ls works in PowerShell (an alias), so it succeeds and has no hint', hintOf(okPosixAlias) === null, `status ${okPosixAlias.status}; hint ${hintOf(okPosixAlias)}`);
  const misleading = await cmd('cat missing.txt');
  check('H22', 'cat is an alias that works; a missing file is the real failure, so a hint saying cat -> type points at the wrong cause (reported, not a block)', hintOf(misleading) === null, `status ${misleading.status}; hint ${hintOf(misleading)}`);
  const quoted = await cmd('echo "grep rm sed" && exit 3');
  check('H23', 'words inside quotes do not trigger a hint on an unrelated failure', hintOf(quoted) === null, `status ${quoted.status}; hint ${hintOf(quoted)}`);
}

// ---- W6-8: a server or trailing & is refused with a pointer to start_process
for (const line of ['npm start', 'npm run dev', 'npx vite', 'node server.js', 'python -m http.server 8000', 'flask run', 'uvicorn app:app', 'next dev', 'nodemon app.js', 'echo hi &', 'node worker.js &']) {
  const r = await cmd(line);
  const bare = line.replace(/\s*&$/, '');
  check(`S ${line}`, `"${line}" is refused, nothing runs, and the message names start_process with the command`, r.status !== 'done' && /start_process/.test(r.results) && r.results.includes(`command \\"${bare}\\"`), `status ${r.status}; ${r.results.slice(-170)}`);
}
for (const line of ['npm run dev:lint', 'npm run dev-check', 'npm run serve-docs', 'echo "a &"', 'echo a && echo b', 'node -e "console.log(1)"']) {
  const r = await cmd(line);
  check(`T ${line}`, `"${line}" is not a server: it must not be refused as one`, !/keeps running \(a server or watcher\)/.test(r.results), `status ${r.status}; ${r.results.slice(0, 110)}`);
}
{
  const sp = await run('auto', 'start_process', { command: 'node -e "setInterval(()=>{},1000)"' });
  check('S20', 'start_process itself still starts a long program in Auto', sp.status === 'done' || sp.cards.length === 0, `status ${sp.status}; ${sp.results.slice(0, 120)}`);
}

// ---- W33-1: the schedule card shows its prompt, and a long prompt is refused
const sched = (extra = {}) => ({ name: 'qa-card', prompt: 'Every morning list the new issues in the repo', every_minutes: 1440, may_change: true, ...extra });
{
  const a = await run('auto', 'schedule_task', sched());
  const d = a.cards[0]?.detail ?? '';
  check('W1', 'the card for a schedule that may change things shows the prompt, how often, and that it may change things', a.cards.length === 1 && /Every morning list the new issues/.test(d) && /every 1440 minutes/.test(d) && /may change things/.test(d), d.replace(/\s+/g, ' '));
  const b = await run('ask', 'schedule_task', sched({ may_change: false, name: 'qa-card-b' }));
  check('W2', 'Manual: a read-only schedule either runs without a card or shows the prompt', b.cards.length === 0 || /Every morning list/.test(b.cards[0].detail), `${b.cards.length} cards`);
  for (const n of [1800, 1900, 1950, 1990, 2000, 2001, 2100]) {
    const r = await run('auto', 'schedule_task', sched({ name: `qa-len-${n}`, prompt: 'p'.repeat(n) }));
    const refused = r.cards.length === 0 && /too long to show in full/.test(r.results + r.stream);
    console.log(`INFO  prompt of ${n} characters: ${refused ? 'refused' : r.cards.length + ' card, detail ' + (r.cards[0]?.detail?.length ?? 0) + ' characters'}`);
    if (n === 1800) check('W3', 'a prompt of 1,800 characters asks and the card shows all of it', r.cards.length === 1 && r.cards[0].detail.includes('p'.repeat(1800)));
    if (n === 2100) check('W4', 'a prompt of 2,100 characters is refused with a plain message and no card, and no schedule is stored', refused && !JSON.stringify(await getJson('/api/schedules')).includes('qa-len-2100'));
    if (n === 2000) check('W5', 'a prompt of exactly 2,000 characters (the stated limit is "over 2,000") asks', r.cards.length === 1, `${r.cards.length} cards (the card text also carries a heading of about 60 characters)`);
  }
  const noChange = await run('auto', 'schedule_task', sched({ name: 'qa-long-ro', may_change: false, prompt: 'q'.repeat(2500) }));
  check('W6', 'a long prompt for a read-only schedule (no card is needed) is stored, not refused', noChange.cards.length === 0, `status ${noChange.status}; ${noChange.results.slice(0, 100)}`);
  const stored = JSON.stringify(await getJson('/api/schedules'));
  check('W7', 'allowed schedules are stored; the refused 2,100-character one is not', stored.includes('qa-card') && !stored.includes('qa-len-2100'));
}

await new Promise((r) => upstream.close(r));
for (const f of cleanups) { try { await f(); } catch {} }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

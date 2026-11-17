/**
 * QA, v0.1.8 tool rows: W6-9 (read_file on a folder, read_url file://), W6-13 (download_file refusals), W6-15 (check_environment),
 * W6-17 (run_command timeout_seconds), W6-21 (tool results up to 50,000 characters), and the server side of W6-5 (cool-downs).
 * The real server (createApp, invented data folder) with a scripted OpenAI-style model on a local port; every answer through the real
 * confirmation cards. The model gets "call <tool> <json>" and replies with that one tool call; what the model is then SENT is recorded.
 *   node e2e/w6-tools-walk.mjs      (from a checkout that has test/helpers.js)
 */
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const { startApp, post } = await import(pathToFileURL(join(process.cwd(), 'test', 'helpers.js')).href);
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const sse = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 250) : ''}`); };

const { base } = await startApp(t, { fake: false });
let seen = [];
let mode429 = null; // when set, the upstream answers every chat call with this status and text
let hits = 0;
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"},{"id":"gpt-4o-mini"}]}'); return; }
    hits += 1;
    const body = JSON.parse(raw); seen.push(body);
    if (mode429) { res.writeHead(mode429.status, j); res.end(JSON.stringify({ error: { message: mode429.text } })); return; }
    const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    const m = /^call (\w+) (.*)$/s.exec(asked);
    const done = body.messages.some((x) => x.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    if (m && !done) res.end(sse({ tool_calls: [{ index: 0, id: 'c1', function: { name: m[1], arguments: m[2] } }] }) + 'data: [DONE]\n\n');
    else res.end(sse({ content: 'done' }) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
const getJson = async (p) => (await fetch(base + p)).json();

async function run(mode, tool, args, { answer = true, folder = null, seed = null, rules = null, model = 'gpt-4o' } = {}) {
  folder ??= await mkdtemp(join(tmpdir(), 'bunny-qa-w6t-'));
  if (seed) await seed(folder);
  if (rules) await fetch(`${base}/api/permission-rules`, { method: 'PUT', headers: j, body: JSON.stringify(rules(folder)) });
  const { body: s } = await post(base, '/api/sessions', { title: 'qa', providerId: 'openai', model });
  const set = (name, value) => fetch(`${base}/api/sessions/${s.id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
  await set('folder', folder); await set('workMode', 'code'); await set('permissionMode', mode);
  seen = [];
  const began = Date.now();
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: `call ${tool} ${JSON.stringify(args)}`, providerId: 'openai', model }), signal: AbortSignal.timeout(60000) });
  const cards = []; const progress = []; let buf = ''; let all = ''; let timedOut = false;
  const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    let chunk; try { chunk = await reader.read(); } catch { timedOut = true; break; }
    if (chunk.done) break;
    const piece = dec.decode(chunk.value, { stream: true }); buf += piece; all += piece;
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      if (/^event: permission/m.test(block)) {
        const card = JSON.parse(/^data: (.*)$/m.exec(block)[1]); cards.push(card);
        await fetch(`${base}/api/sessions/${s.id}/permission/${card.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: answer }) });
      } else if (/^event: tool/m.test(block)) {
        try { const d = JSON.parse(/^data: (.*)$/m.exec(block)[1]); if (d.status === 'running' && d.result) progress.push(d.result); } catch { /* ignore */ }
      }
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  const step = saved.messages.find((x) => x.kind === 'tool_call');
  const modelSaw = [...(seen.at(-1)?.messages ?? [])].reverse().find((x) => x.role === 'tool')?.content ?? '';
  const errEvent = (/^event: error\ndata: (.*)$/m.exec(all) ?? [])[1];
  return { folder, cards, progress, status: timedOut ? 'timeout' : step?.status ?? 'none', stream: all, step, modelSaw: String(modelSaw), ms: Date.now() - began, errEvent: errEvent ? JSON.parse(errEvent) : null, summary: step?.tool ?? '' };
}
const seedTree = async (f) => { await mkdir(join(f, 'sub'), { recursive: true }); await writeFile(join(f, 'sub', 'a.txt'), 'carrot'); await writeFile(join(f, 'sub', 'b.txt'), 'lettuce'); await writeFile(join(f, 'notes.txt'), 'hello from the workspace'); };
const fileUrl = (p) => pathToFileURL(p).href;

// ================= W6-9: read_file on a folder, read_url file:// =================
{
  const f = await mkdtemp(join(tmpdir(), 'bunny-qa-w69-')); await seedTree(f);
  const a = await run('auto', 'read_file', { path: 'sub' }, { folder: f });
  check('W69-1', 'read_file on a folder lists its contents instead of failing', /that is a folder/.test(a.modelSaw) && /a\.txt/.test(a.modelSaw) && /b\.txt/.test(a.modelSaw) && a.status === 'done', a.modelSaw.slice(0, 100));
  const b = await run('auto', 'read_file', { path: '.' }, { folder: f });
  check('W69-2', 'read_file on "." lists the workspace folder', /notes\.txt/.test(b.modelSaw) && /sub/.test(b.modelSaw), b.modelSaw.slice(0, 100));
  const big = await mkdtemp(join(tmpdir(), 'bunny-qa-w69b-'));
  for (let i = 0; i < 300; i++) await writeFile(join(big, `file-${String(i).padStart(3, '0')}.txt`), 'x');
  const c = await run('auto', 'read_file', { path: '.' }, { folder: big });
  const listed = (c.modelSaw.match(/file-\d{3}\.txt/g) ?? []).length;
  check('W69-3', 'a folder of 300 files lists at most 200 lines (the rest is cut, not an error)', c.status === 'done' && listed <= 200 && listed >= 100, `${listed} names`);
  const d = await run('auto', 'read_file', { path: '..' }, { folder: f });
  check('W69-4', 'read_file on the parent folder (outside the workspace) is refused', !/notes\.txt/.test(d.modelSaw) && /outside|inside|workspace|not allowed/i.test(d.modelSaw), d.modelSaw.slice(0, 120));
  const e = await run('auto', 'read_file', { path: 'C:\\Windows' }, { folder: f });
  check('W69-5', 'read_file on an absolute folder outside is refused', !/System32|win\.ini/i.test(e.modelSaw) && /outside|inside|workspace|not allowed/i.test(e.modelSaw), e.modelSaw.slice(0, 120));
  const r1 = await run('auto', 'read_url', { url: fileUrl(join(f, 'notes.txt')) }, { folder: f });
  check('W69-6', 'read_url on a file:// address inside the workspace reads the text', /hello from the workspace/.test(r1.modelSaw), r1.modelSaw.slice(0, 120));
  const r2 = await run('auto', 'read_url', { url: fileUrl(join(f, 'sub')) }, { folder: f });
  check('W69-7', 'read_url on a file:// folder inside lists it', /a\.txt/.test(r2.modelSaw), r2.modelSaw.slice(0, 100));
  for (const [label, url] of [['a file outside', 'file:///C:/Windows/win.ini'], ['a share on another computer', 'file://server/share/x.txt'], ['a UNC path', 'file:////server/share/x.txt'], ['a path that climbs out', fileUrl(join(f, '..', '..', 'Windows', 'win.ini'))], ['a device path', 'file:///\\\\.\\C:\\x'], ['the parent folder', fileUrl(join(f, '..'))]]) {
    const r = await run('auto', 'read_url', { url }, { folder: f });
    check(`W69-8 ${label}`, `read_url on ${label} (${url.slice(0, 40)}) is refused and shows no file text`, !/\[fonts\]|for 16-bit|hello from the workspace|notes\.txt/.test(r.modelSaw) && /not valid|another computer|inside the workspace|outside|not allowed/i.test(r.modelSaw), r.modelSaw.slice(0, 140));
  }
  // a junction inside the folder that points outside
  const outside = await mkdtemp(join(tmpdir(), 'bunny-qa-out-')); await writeFile(join(outside, 'secret.txt'), 'OUTSIDE-SECRET');
  try { execFileSync('cmd', ['/c', 'mklink', '/J', join(f, 'link'), outside], { stdio: 'ignore' }); } catch { /* may fail */ }
  if (existsSync(join(f, 'link'))) {
    const j1 = await run('auto', 'read_url', { url: fileUrl(join(f, 'link', 'secret.txt')) }, { folder: f });
    const j2 = await run('auto', 'read_file', { path: 'link/secret.txt' }, { folder: f });
    const j3 = await run('auto', 'read_file', { path: 'link' }, { folder: f });
    check('W69-9', 'a junction inside the workspace that points outside is not followed (file:// file, read_file file, read_file folder)', ![j1, j2, j3].some((x) => /OUTSIDE-SECRET/.test(x.modelSaw)) && [j1, j2, j3].every((x) => /outside|inside the workspace/i.test(x.modelSaw)),[j1, j2, j3].map((x) => x.modelSaw.slice(0, 50)).join(' | '));
  } else check('W69-9', 'junction test', false, 'could not make a junction on this machine');
  // the person's read rules apply to a file:// address too
  const g = await mkdtemp(join(tmpdir(), 'bunny-qa-w69r-')); await mkdir(join(g, 'secrets'), { recursive: true }); await writeFile(join(g, 'secrets', 'key.txt'), 'TOPSECRET-VALUE'); await writeFile(join(g, 'ok.txt'), 'fine');
  const deny = (folder) => ({ global: [{ kind: 'path', effect: 'deny', pattern: 'secrets/*', ops: 'reads' }] });
  const rr = await run('auto', 'read_url', { url: fileUrl(join(g, 'secrets', 'key.txt')) }, { folder: g, rules: deny });
  const ok = await run('auto', 'read_url', { url: fileUrl(join(g, 'ok.txt')) }, { folder: g, rules: deny });
  await fetch(`${base}/api/permission-rules`, { method: 'PUT', headers: j, body: JSON.stringify({ global: [] }) });
  check('W69-10', 'a deny rule on secrets/* stops read_url file:// of that file, while another file still reads', !/TOPSECRET-VALUE/.test(rr.modelSaw) && /Blocked|rule/i.test(rr.modelSaw) && /fine/.test(ok.modelSaw), `${rr.modelSaw.slice(0, 100)} | ${ok.modelSaw.slice(0, 20)}`);
}

// ================= W6-13: download_file =================
{
  const local = createServer((req, res) => { hits += 1000; res.end('FILE'); });
  await new Promise((r) => local.listen(0, '127.0.0.1', r));
  const port = local.address().port;
  const f = await mkdtemp(join(tmpdir(), 'bunny-qa-w613-'));
  const bad = [['this computer (127.0.0.1)', `http://127.0.0.1:${port}/x`], ['localhost', `http://localhost:${port}/x`], ['a private address', 'http://10.0.0.5/x'], ['a home-network address', 'http://192.168.1.1/x'], ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'], ['an IPv6 loopback', `http://[::1]:${port}/x`], ['an IPv4-in-IPv6 loopback', `http://[::ffff:7f00:1]:${port}/x`], ['a decimal-number address', 'http://2130706433/x'], ['a hex address', 'http://0x7f000001/x'], ['a file address', 'file:///C:/Windows/win.ini'], ['an ftp address', 'ftp://example.com/x'], ['an address with a name and password', 'http://user:pw@example.com/x'], ['no address', '']];
  hits = 0;
  for (const [label, url] of bad) {
    const r = await run('auto', 'download_file', { url, path: 'got.bin' }, { folder: f });
    check(`W613-1 ${label}`, `download_file from ${label} is refused and nothing is saved`, r.status !== 'done' || /not|refus|cannot|only|private|public|valid/i.test(r.modelSaw), r.modelSaw.slice(0, 110));
    if (!existsSync(join(f, 'got.bin'))) rows.push({ id: 'x', ok: true }); else check(`W613-1b ${label}`, 'a file was saved', false);
  }
  check('W613-2', 'none of the local download attempts reached the local server (it saw no request)', hits < 1000, `local server hits ${Math.floor(hits / 1000)}`);
  for (const [label, path] of [['outside the workspace', '..\\got.bin'], ['an absolute path outside', 'C:\\Windows\\Temp\\qa-got.bin'], ['inside .git', '.git/config'], ['no path', '']]) {
    const r = await run('auto', 'download_file', { url: 'https://example.invalid/x', path }, { folder: f });
    check(`W613-3 ${label}`, `a download to a path ${label} is refused (before any request)`, /outside|inside|not allowed|needs a path|\.git|Blocked/i.test(r.modelSaw), r.modelSaw.slice(0, 110));
  }
  const ask = await run('ask', 'download_file', { url: 'https://example.invalid/x', path: 'x.bin' }, { folder: f });
  check('W613-4', 'in Manual a download asks first (it writes into the workspace)', ask.cards.length === 1, `${ask.cards.length} cards`);
  const denyRule = await run('auto', 'download_file', { url: 'https://example.invalid/x', path: 'locked.bin' }, { folder: f, rules: () => ({ global: [{ kind: 'path', effect: 'deny', pattern: 'locked.*', ops: 'edits' }] }) });
  await fetch(`${base}/api/permission-rules`, { method: 'PUT', headers: j, body: JSON.stringify({ global: [] }) });
  check('W613-5', 'a deny rule for edits to locked.* stops a download to locked.bin even in Auto', /Blocked|rule/i.test(denyRule.modelSaw), denyRule.modelSaw.slice(0, 110));
  local.close();
}

// ================= W6-15: check_environment =================
{
  const mk = async (files) => { const f = await mkdtemp(join(tmpdir(), 'bunny-qa-w615-')); for (const [n, c] of Object.entries(files)) { await mkdir(join(f, n, '..'), { recursive: true }); await writeFile(join(f, n), c); } return f; };
  const plain = await run('auto', 'check_environment', {}, { folder: await mkdtemp(join(tmpdir(), 'bunny-qa-w615-')) });
  check('W615-1', 'with no requirement files it lists the installed tools and versions (node, npm, git)', /node/i.test(plain.modelSaw) && /npm/i.test(plain.modelSaw) && /git/i.test(plain.modelSaw) && /\d+\.\d+/.test(plain.modelSaw), plain.modelSaw.slice(0, 160));
  const tooNew = await run('auto', 'check_environment', {}, { folder: await mk({ 'package.json': JSON.stringify({ name: 'x', engines: { node: '>=999' } }) }) });
  check('W615-2', 'package.json engines node >=999 says Node is too old and what to do', /999/.test(tooNew.modelSaw) && /(too old|older|does not meet|need|install|upgrade|update)/i.test(tooNew.modelSaw), tooNew.modelSaw.slice(0, 200));
  const fine = await run('auto', 'check_environment', {}, { folder: await mk({ 'package.json': JSON.stringify({ name: 'x', engines: { node: '>=1' } }), '.python-version': '3.0\n' }) });
  check('W615-3', 'an easy requirement (node >=1) is met and no advice to change it', /node/i.test(fine.modelSaw) && !/(too old|upgrade node)/i.test(fine.modelSaw), fine.modelSaw.slice(0, 200));
  const nvm = await run('auto', 'check_environment', {}, { folder: await mk({ '.nvmrc': '99\n' }) });
  check('W615-4', '.nvmrc 99 is read', /99/.test(nvm.modelSaw), nvm.modelSaw.slice(0, 160));
  const toml = await run('auto', 'check_environment', {}, { folder: await mk({ 'pyproject.toml': '[project]\nname = "x"\nrequires-python = ">=9.9"\n' }) });
  check('W615-5', 'pyproject requires-python >=9.9 is read and flagged', /9\.9/.test(toml.modelSaw), toml.modelSaw.slice(0, 200));
  const folderNamed = await mkdtemp(join(tmpdir(), 'bunny-qa-w615-')); await mkdir(join(folderNamed, 'package.json'));
  const dir = await run('auto', 'check_environment', {}, { folder: folderNamed });
  check('W615-6', 'a folder named package.json is not read as a file and does not break the check', dir.status === 'done' && /node/i.test(dir.modelSaw), dir.modelSaw.slice(0, 120));
  const huge = await run('auto', 'check_environment', {}, { folder: await mk({ 'package.json': JSON.stringify({ name: 'x', pad: 'x'.repeat(70000), engines: { node: '>=999' } }) }) });
  check('W615-7', 'a package.json over 64 KB is not read (its >=999 requirement is not reported)', huge.status === 'done' && !/>=999|999/.test(huge.modelSaw), huge.modelSaw.slice(0, 160));
  const outside = await run('auto', 'check_environment', { path: '..' }, { folder: await mkdtemp(join(tmpdir(), 'bunny-qa-w615-')) });
  check('W615-8', 'check_environment with path .. (outside the workspace) is refused', /outside|inside|workspace|not allowed/i.test(outside.modelSaw), outside.modelSaw.slice(0, 120));
  const manual = await run('ask', 'check_environment', {}, { folder: await mkdtemp(join(tmpdir(), 'bunny-qa-w615-')) });
  check('W615-9', 'it is a read tool: it runs in Manual without a card', manual.cards.length === 0 && manual.status === 'done', `${manual.cards.length} cards`);
  const sub = await mkdtemp(join(tmpdir(), 'bunny-qa-w615-')); await mkdir(join(sub, 'app')); await writeFile(join(sub, 'app', '.nvmrc'), '88\n');
  const inSub = await run('auto', 'check_environment', { path: 'app' }, { folder: sub });
  check('W615-10', 'path "app" checks that sub-folder (.nvmrc 88 found there)', /88/.test(inSub.modelSaw), inSub.modelSaw.slice(0, 120));
}

// ================= W6-17: run_command timeout_seconds =================
{
  const f = await mkdtemp(join(tmpdir(), 'bunny-qa-w617-'));
  const short = await run('auto', 'run_command', { command: 'Start-Sleep -Seconds 8; "late"', timeout_seconds: 2 }, { folder: f });
  check('W617-1', 'timeout_seconds 2 stops a command that sleeps 8 s after about 2 s and says "stopped after 2 seconds"', /stopped after 2 seconds/.test(short.modelSaw) && short.ms < 7000 && !/late/.test(short.modelSaw), `${short.ms} ms; ${short.modelSaw.slice(0, 120)}`);
  const pidFile = join(f, 'pid.txt');
  const tree = await run('auto', 'run_command', { command: `node -e "require('fs').writeFileSync('pid.txt', String(process.pid)); setInterval(() => {}, 1000)"`, timeout_seconds: 3 }, { folder: f });
  await new Promise((r) => setTimeout(r, 1500));
  let alive = true; try { const pid = Number((await readFile(pidFile, 'utf8')).trim()); try { process.kill(pid, 0); } catch { alive = false; } } catch { alive = 'no pid file'; }
  check('W617-2', 'a timeout ends the program the command started (the whole tree), not only PowerShell', /stopped after 3 seconds/.test(tree.modelSaw) && alive === false, `alive ${alive}; ${tree.modelSaw.slice(0, 100)}`);
  const cd = await run('auto', 'run_command', { command: 'Start-Sleep -Seconds 12; "done-late"', timeout_seconds: 30 }, { folder: f });
  check('W617-3', 'a command allowed more than 10 s shows a countdown on its step line ("Running… 5 s of up to 30 s")', cd.progress.some((p) => /Running… \d+ s of up to 30 s/.test(p)) && /done-late/.test(cd.modelSaw), `progress: ${cd.progress.join(' / ')}`);
  const long = await run('auto', 'run_command', { command: 'echo quick', timeout_seconds: 601 }, { folder: f });
  check('W617-4', 'timeout_seconds 601 is capped: the step line says up to 10 min', /up to 10 min/.test(long.summary), long.summary);
  const five = await run('auto', 'run_command', { command: 'echo quick', timeout_seconds: 300 }, { folder: f });
  check('W617-5', 'timeout_seconds 300 shows up to 5 min', /up to 5 min/.test(five.summary), five.summary);
  for (const bad of [0, -5, 'abc', null, 1.5]) {
    const r = await run('auto', 'run_command', { command: 'echo ok-' + String(bad), timeout_seconds: bad }, { folder: f });
    check(`W617-6 ${JSON.stringify(bad)}`, `timeout_seconds ${JSON.stringify(bad)} does not break the command (runs with the default or a 1 s floor)`, /ok-/.test(r.modelSaw) || /stopped after/.test(r.modelSaw), r.modelSaw.slice(0, 100));
  }
  const noExtra = await run('auto', 'run_command', { command: 'echo plain' }, { folder: f });
  check('W617-7', 'with no timeout_seconds the step line has no "up to" note and the command runs', !/up to/.test(noExtra.summary) && /plain/.test(noExtra.modelSaw), noExtra.summary);
}

// ================= W6-21: tool results up to 50,000 characters =================
{
  const f = await mkdtemp(join(tmpdir(), 'bunny-qa-w621-'));
  const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1} of the file`).join('\n');
  await writeFile(join(f, 'mid.txt'), lines(1800)); // about 38,000 characters
  await writeFile(join(f, 'huge.txt'), lines(4000)); // about 90,000 characters
  await writeFile(join(f, 'giant.txt'), lines(9000)); // over 128 KB
  const mid = await run('auto', 'read_file', { path: 'mid.txt' }, { folder: f });
  check('W621-1', 'a 38,000-character file reaches the model whole (it used to be cut at 8,000)', mid.modelSaw.length > 36000 && /line 1800 of the file/.test(mid.modelSaw) && !/Cut to/.test(mid.modelSaw), `${mid.modelSaw.length} characters`);
  const huge = await run('auto', 'read_file', { path: 'huge.txt' }, { folder: f });
  check('W621-2', 'a 90,000-character file is cut to 50,000 with a note, the middle is left out, and the note says how to read the rest', huge.modelSaw.length > 49000 && huge.modelSaw.length < 52000 && /Cut to 50000 characters/.test(huge.modelSaw) && /start_line and end_line/.test(huge.modelSaw), `${huge.modelSaw.length} characters; ${huge.modelSaw.slice(-130)}`);
  check('W621-3', 'both the start and the end of the file are kept (middle left out)', /line 1 of the file/.test(huge.modelSaw) && /line 4000 of the file/.test(huge.modelSaw), '');
  const cmd = await run('auto', 'run_command', { command: '1..3000 | ForEach-Object { "output row $_ of the command" }' }, { folder: f });
  check('W621-4', 'command output over 50,000 characters is cut to 50,000 with a note', cmd.modelSaw.length > 49000 && cmd.modelSaw.length < 52000 && /Cut to 50000 characters/.test(cmd.modelSaw), `${cmd.modelSaw.length} characters`);
  const notes = join(f, '.bunny', 'notes');
  const saved = existsSync(notes) ? await readdir(notes) : [];
  check('W621-5', 'the whole output is saved in .bunny/notes and the note says so', saved.length >= 1 && /\.bunny\/notes/.test(cmd.modelSaw), `${saved.length} note files; ${cmd.modelSaw.slice(-140)}`);
  if (saved.length) {
    const body = await readFile(join(notes, saved.at(-1)), 'utf8');
    check('W621-6', 'the saved note holds the whole output (3,000 rows), and a .bunny/.gitignore keeps it out of the repository', /output row 3000 of the command/.test(body), `${body.length} characters`);
    check('W621-7', 'the folder .bunny has a .gitignore with *', existsSync(join(f, '.bunny', '.gitignore')) && (await readFile(join(f, '.bunny', '.gitignore'), 'utf8')).trim() === '*');
  }
  const giant = await run('auto', 'run_command', { command: '1..16000 | ForEach-Object { "output row $_ of the command, padded for size" }' }, { folder: f });
  check('W621-8', 'output over 128 KB is cut and the note says it is too large to be saved (run again with a narrower filter)', /too large to be saved/.test(giant.modelSaw), `${giant.modelSaw.length} characters; ${giant.modelSaw.slice(-160)}`);
  const incog = await mkdtemp(join(tmpdir(), 'bunny-qa-w621i-'));
  // a result that looks like a secret is never kept in a note
  const sec = await run('auto', 'run_command', { command: '1..4000 | ForEach-Object { "row $_ api_key=sk-live-abcdefghijklmnopqrstuvwx" }' }, { folder: incog });
  const secNotes = existsSync(join(incog, '.bunny', 'notes')) ? await readdir(join(incog, '.bunny', 'notes')) : [];
  check('W621-9', 'output that looks like it holds a secret is not saved to a note', secNotes.length === 0, `${secNotes.length} note files`);
}

// ================= W6-5 (server side): cool-downs =================
{
  const f = await mkdtemp(join(tmpdir(), 'bunny-qa-w65-'));
  const stamp = Date.now();
  mode429 = { status: 429, text: 'Rate limit reached for requests. Too many requests, please slow down.' };
  const busy = await run('auto', 'list_files', {}, { folder: f, model: 'gpt-4o' });
  const e = busy.errEvent ?? {};
  check('W65-1', 'a plain 429 gives an error event with a cool-down of about 2 minutes for THAT MODEL only', e.coolingScope === 'model' && e.coolingUntil > stamp + 100_000 && e.coolingUntil < stamp + 140_000, JSON.stringify({ scope: e.coolingScope, in: e.coolingUntil ? Math.round((e.coolingUntil - stamp) / 1000) + ' s' : null, reason: e.reason }));
  mode429 = { status: 429, text: 'Free usage limit reached for this account. Add credits to continue.' };
  const spent = await run('auto', 'list_files', {}, { folder: f, model: 'gpt-4o-mini' });
  const e2 = spent.errEvent ?? {};
  check('W65-2', 'a spent usage allowance rests the WHOLE provider for about an hour', e2.coolingScope === 'provider' && e2.coolingUntil > stamp + 3_500_000 && e2.coolingUntil < stamp + 3_700_000, JSON.stringify({ scope: e2.coolingScope, in: e2.coolingUntil ? Math.round((e2.coolingUntil - stamp) / 60000) + ' min' : null }));
  const models = await getJson('/api/models').catch(() => []);
  const cooled = models.filter((m) => m.providerId === 'openai');
  check('W65-3', 'the model list tells the page which models are cooling (coolingUntil is present on the provider\'s models and stays across messages)', cooled.length > 0 && cooled.every((m) => m.coolingUntil > Date.now()), JSON.stringify(cooled.map((m) => ({ id: m.id, until: m.coolingUntil ? Math.round((m.coolingUntil - Date.now()) / 60000) + ' min' : null }))));
  mode429 = { status: 500, text: 'internal server error 500' };
  const fiveHundred = await run('auto', 'list_files', {}, { folder: f, model: 'gpt-4o' });
  check('W65-4', 'a 500 error is a failure of the model (try the next) with no cool-down', (fiveHundred.errEvent?.scope === 'model') && !fiveHundred.errEvent?.coolingUntil, JSON.stringify(fiveHundred.errEvent ?? {}).slice(0, 160));
  mode429 = { status: 404, text: 'The model `gpt-4o` does not exist or is not available for account' };
  const gone = await run('auto', 'list_files', {}, { folder: f, model: 'test-model-1' });
  const afterGone = (await getJson('/api/models').catch(() => [])).find((m) => m.id === 'test-model-1');
  check('W65-5', 'a "model does not exist" answer marks that model unavailable for next time', gone.errEvent?.modelUnavailable === true && Boolean(afterGone?.unavailable), JSON.stringify({ ev: gone.errEvent?.modelUnavailable, listed: afterGone?.unavailable }));
  mode429 = null;
}

await new Promise((r) => upstream.close(r));
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => r.id !== 'x' && !r.ok);
console.log(`\n${rows.filter((r) => r.id !== 'x').length - bad.length} of ${rows.filter((r) => r.id !== 'x').length} passed`);
process.exit(bad.length ? 1 : 0);

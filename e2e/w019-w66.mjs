/**
 * QA, v0.1.9 W6-6: install a Node tool from GitHub as a local connector, with a card in every mode.
 * The REAL installer (real git clone, real npm) in the real app (invented data folder), a LOCAL git repository standing in for GitHub:
 * the "GitHub" answers come from a local fake, the clone is a file:// clone. Nothing is fetched from the network by this walk.
 * A scripted OpenAI-style model asks for install_from_github; the card is answered by the walk (no / yes).
 *   node e2e/w019-w66.mjs
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp } = await imp('test/helpers.js');
const { createToolInstaller } = await imp('src/server/toolInstall.js');
const NL = String.fromCharCode(10); const j = { 'content-type': 'application/json' };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : ''}`); };
const git = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=qa', '-c', 'user.email=qa@example.com', ...a], { cwd, encoding: 'utf8' }).trim();

// ---- the invented repository (a tiny stdio MCP server with one tool), plus hostile extras that must NOT run or survive
const SERVER = `import { createInterface } from 'node:readline';
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
createInterface({ input: process.stdin }).on('line', (l) => { let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'carrots', version: '1' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [{ name: 'carrot_count', description: 'How many carrots', inputSchema: { type: 'object', properties: {} } }] } });
  else if (m.method === 'tools/call') send({ id: m.id, result: { content: [{ type: 'text', text: '7 carrots' }] } });
  else if (m.id !== undefined && m.method) send({ id: m.id, error: { code: -32601, message: 'unknown' } }); });
`;
const work = mkdtempSync(join(tmpdir(), 'bunny-w019-w66-')); cleanups.push(() => rm(work, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }));
const MARK = join(work, 'SCRIPT-RAN.txt');
const repo = join(work, 'origin'); mkdirSync(repo); git(repo, 'init', '-q', '-b', 'main');
writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'carrot-server', version: '1.0.0', type: 'module', bin: 'server.mjs', scripts: { postinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(MARK.replace(/\\/g, '/'))}, 'ran')"`, preinstall: `node -e "require('fs').writeFileSync(${JSON.stringify(MARK.replace(/\\/g, '/'))}, 'ran')"` } }, null, 2));
writeFileSync(join(repo, 'package-lock.json'), JSON.stringify({ name: 'carrot-server', version: '1.0.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'carrot-server', version: '1.0.0' } } }));
writeFileSync(join(repo, 'server.mjs'), SERVER);
writeFileSync(join(repo, '.npmrc'), 'script-shell=C:/Windows/System32/cmd.exe' + NL + 'ignore-scripts=false' + NL);
git(repo, 'add', '-A'); git(repo, 'commit', '-q', '-m', 'first');
const state = { sha: git(repo, 'rev-parse', 'HEAD'), private: false, apiCalls: [], moveAfterCard: false, cardCalls: 0 };
const fakeGithub = async (url) => {
  const u = new URL(url); state.apiCalls.push(`${u.hostname}${u.pathname}`); const js = (v, s = 200) => new Response(JSON.stringify(v), { status: s });
  if (!['api.github.com', 'raw.githubusercontent.com'].includes(u.hostname)) throw new Error('walk refused a request to ' + u.hostname);
  if (u.hostname === 'api.github.com') {
    if (u.pathname === '/repos/acme/carrot-server') return js({ default_branch: 'main', stargazers_count: 7, pushed_at: '2026-11-17T10:00:00Z', private: state.private });
    if (u.pathname === '/repos/acme/carrot-server/commits/main') { state.cardCalls += 1; return js({ sha: state.moveAfterCard && state.cardCalls > 1 ? 'f'.repeat(40) : state.sha }); }
    if (u.pathname.startsWith('/repos/acme/carrot-server/git/trees/')) return js({ tree: git(repo, 'ls-files').split(NL).filter(Boolean).map((path) => ({ path, type: 'blob' })) });
    return js({ message: 'Not Found' }, 404);
  }
  if (u.pathname.endsWith('/package.json')) return new Response(readFileSync(join(repo, 'package.json'), 'utf8'), { status: 200 });
  return js({ message: 'Not Found' }, 404);
};

// ---- the app: the real installer, using the app's own connector store through a late-bound proxy
const holder = { app: null }; const dataDir = await mkdtemp(join(tmpdir(), 'bunny-w019-w66-data-')); cleanups.push(() => rm(dataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 }));
const proxy = { add: (c) => holder.app.mcp.add(c) };
const installer = createToolInstaller({ dataDir, mcp: proxy, fetchImpl: fakeGithub, cloneUrl: () => pathToFileURL(repo).href });

// ---- the scripted model
let script = () => ({ kind: 'text', text: 'ok' }); const seen = [];
const up = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
  if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
  const b = JSON.parse(raw); seen.push(b); const n = seen.length; const r = script(b, n);
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const fr = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}${NL}${NL}`;
  if (r.kind === 'tool') res.write(fr({ tool_calls: [{ index: 0, id: `call_${n}`, function: { name: r.name, arguments: JSON.stringify(r.args ?? {}) } }] })); else res.write(fr({ content: r.text ?? 'ok' }));
  res.end(`data: [DONE]${NL}${NL}`); }); });
await new Promise((r) => up.listen(0, '127.0.0.1', r)); cleanups.push(() => new Promise((r) => { up.closeAllConnections?.(); up.close(r); }));
const { app, base } = await startApp(t, { fake: false, toolInstaller: installer, dataDir, probe: null, discover: null }); holder.app = app;
await fetch(`${base}/api/providers/openai/connect`, { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${up.address().port}/v1` }) });
const toolsDir = join(dataDir, 'tools');
const newSession = async (mode) => { const s = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: j, body: JSON.stringify({ title: 'w66 ' + mode }) })).json(); await fetch(`${base}/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: mode }) }); return s.id; };
async function say(id, text, answer) { // answer: true/false to the card, or null to ignore (Plan mode shows none)
  const res = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: text, providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
  const cards = []; let out = ''; const dec = new TextDecoder();
  for await (const chunk of res.body) { const part = dec.decode(chunk, { stream: true }); out += part; for (const m of part.matchAll(/event: permission\ndata: (.*)/g)) { const card = JSON.parse(m[1]); cards.push(card); await fetch(`${base}/api/sessions/${id}/permission/${card.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: answer }) }); } }
  return { cards, out };
}
const askInstall = () => ({ kind: 'tool', name: 'install_from_github', args: { repo: 'acme/carrot-server' } });
const connectors = async () => (await (await fetch(`${base}/api/mcp`)).json());
const toolsFolder = () => (existsSync(toolsDir) ? readdirSync(toolsDir) : []);

try {
  // A. the card, in every mode (Auto included), and "no" installs nothing
  for (const mode of ['ask', 'accept', 'auto']) {
    seen.length = 0; script = (b, n) => (n === 1 ? askInstall() : { kind: 'text', text: 'carried on' });
    const id = await newSession(mode); const r = await say(id, 'install the carrot server from acme/carrot-server', false);
    const card = r.cards[0]; const detail = card?.detail ?? '';
    check(`A-${mode}-card`, `${mode}: exactly one card is shown (even in Auto)`, r.cards.length === 1, `${r.cards.length} card(s)`);
    check(`A-${mode}-text`, `${mode}: the card shows the repository, stars, the exact commit, where it goes, the exact npm command (scripts NOT run), the settings-files note, the start command, ON, and the warning`,
      /Install a tool from GitHub/.test(detail) && /acme\/carrot-server/.test(detail) && /7 stars/.test(detail) && detail.includes(`commit ${state.sha.slice(0, 7)} on main`) && detail.includes(join(dataDir, 'tools', `acme-carrot-server-${state.sha.slice(0, 7)}`)) && /npm ci --ignore-scripts --registry=https:\/\/registry\.npmjs\.org\//.test(detail) && /install scripts are NOT run/.test(detail) && /\.npmrc, \.yarnrc, \.pnpmfile\.cjs\) are deleted and ignored/.test(detail) && /node server\.mjs/.test(detail) && /switched ON/.test(detail) && /runs code from the internet/.test(detail), detail.split(NL).join(' | '));
    check(`A-${mode}-no`, `${mode}: a "no" installs nothing: no tools folder content, no connector, the model is told, the clone was never made`, toolsFolder().length === 0 && (await connectors()).length === 0 && /did not allow|carried on/.test(r.out) && !existsSync(MARK), `tools ${JSON.stringify(toolsFolder())}; connectors ${(await connectors()).length}`);
  }

  // B. a "yes" installs exactly the commit on the card; scripts did not run; hostile npm settings were deleted; the tool answers
  seen.length = 0; script = (b, n) => (n === 1 ? askInstall() : { kind: 'text', text: 'installed, thanks' });
  const sid = await newSession('ask'); const yes = await say(sid, 'install the carrot server', true);
  const folderName = `acme-carrot-server-${state.sha.slice(0, 7)}`; const folder = join(toolsDir, folderName);
  const list = await connectors(); const conn = list.find((c) => c.name === 'carrot-server');
  check('B1', 'yes: the connector exists, is local (node), switched ON, with its source (repo, sha, folder)', Boolean(conn) && conn.command === 'node' && conn.enabled === true && conn.source?.sha === state.sha && conn.source?.folder === folderName, JSON.stringify(conn ?? {}).slice(0, 240));
  check('B2', 'the code sits only in <data>\\tools\\<owner>-<repo>-<sha7> and the tools folder holds nothing else', toolsFolder().join() === folderName && existsSync(join(folder, 'server.mjs')), JSON.stringify(toolsFolder()));
  check('B3', 'the installed commit is exactly the one on the card', git(folder, 'rev-parse', 'HEAD') === state.sha, git(folder, 'rev-parse', 'HEAD'));
  check('B4', 'no install script of the repository ran (its preinstall and postinstall would have written a marker file)', !existsSync(MARK), existsSync(MARK) ? 'MARKER EXISTS: a script ran' : 'no marker');
  check('B5', 'the repository\'s own .npmrc (script-shell, ignore-scripts=false) was deleted before npm ran', !existsSync(join(folder, '.npmrc')), '');
  check('B6', 'the answer to the person says it was installed, scripts not run, switched on', /Installed acme\/carrot-server/.test(JSON.stringify(yes.out)) || /installed, thanks/.test(yes.out), yes.out.slice(0, 200).replace(/\s+/g, ' '));
  check('B7', 'only the fake GitHub was asked (api.github.com and raw.githubusercontent.com on this computer): the walk refused any other host', state.apiCalls.every((c) => /^(api\.github\.com|raw\.githubusercontent\.com)\//.test(c)), [...new Set(state.apiCalls)].join(' '));

  // C. the tool answers
  seen.length = 0; script = (b, n) => { if (n === 1) { const name = (b.tools ?? []).map((d) => d.function.name).find((x) => /carrot_count/.test(x)); return name ? { kind: 'tool', name, args: {} } : { kind: 'text', text: 'TOOL NOT OFFERED: ' + (b.tools ?? []).map((d) => d.function.name).join(',').slice(0, 200) }; } return { kind: 'text', text: 'the tool said ' + (JSON.stringify(b.messages.at(-1)).match(/\d+ carrots/)?.[0] ?? 'nothing') }; };
  const sid2 = await newSession('auto'); const use = await say(sid2, 'how many carrots?', true);
  check('C1', 'the installed connector\'s tool is offered to the model and its answer ("7 carrots") comes back', /the tool said 7 carrots/.test(use.out) || /7 carrots/.test(use.out), use.out.replace(/\s+/g, ' ').slice(-240));

  // D. the same commit twice is refused (already installed), and a moved branch installs nothing
  seen.length = 0; script = (b, n) => (n === 1 ? askInstall() : { kind: 'text', text: 'second' });
  const dup = await say(await newSession('ask'), 'install it again', true);
  check('D1', 'asking again for the same commit is refused ("already installed") and nothing changes', /already installed/.test(dup.out) && toolsFolder().length === 1, dup.out.replace(/\s+/g, ' ').slice(0, 220));

  // E. Plan mode refuses (no card, no install)
  const before = toolsFolder().length; seen.length = 0; script = (b, n) => (n === 1 ? askInstall() : { kind: 'text', text: 'plan done' });
  const plan = await say(await newSession('plan'), 'install the carrot server', true);
  const told = JSON.stringify(seen.at(-1)?.messages?.at(-1) ?? ''); check('E1', 'Plan mode refuses: no card is shown, nothing is installed, the model is told Plan mode is read-only', plan.cards.length === 0 && toolsFolder().length === before && /status":"denied/.test(plan.out) && /Plan mode is read-only|not available in this reply/.test(told), `${plan.cards.length} card(s); model was told: ${told.slice(0, 200)}`);

  // F. delete the connector: its folder goes with it; a tampered saved folder removes nothing
  const tamper = await holder.app.mcp.add({ name: 'tampered', command: 'node', args: ['x.mjs'], enabled: false, source: { repo: 'acme/x', sha: 'a'.repeat(40), folder: '..' } });
  const delT = await fetch(`${base}/api/mcp/${tamper.id}`, { method: 'DELETE' });
  check('F1', 'deleting a connector whose saved folder is "..": refused (400), the tools folder and everything beside it stay', delT.status === 400 && existsSync(toolsDir) && existsSync(dataDir), `HTTP ${delT.status}`);
  await holder.app.mcp.remove(tamper.id);
  const del = await fetch(`${base}/api/mcp/${conn.id}`, { method: 'DELETE' });
  check('F2', 'deleting the installed connector removes its folder and the connector', del.status === 200 && !existsSync(folder) && !(await connectors()).some((c) => c.id === conn.id), `HTTP ${del.status}; folder exists ${existsSync(folder)}; tools ${JSON.stringify(toolsFolder())}`);
  check('F3', 'the origin repository (outside the tools folder) was not touched by the removal', existsSync(join(repo, 'server.mjs')) && git(repo, 'rev-parse', 'HEAD') === state.sha, '');

  // G. refusals before any card: private, no package.json, a moved branch
  state.private = true; seen.length = 0; script = (b, n) => (n === 1 ? askInstall() : { kind: 'text', text: 'g' });
  const priv = await say(await newSession('ask'), 'install it', true);
  check('G1', 'a private repository is refused with plain words, no card', priv.cards.length === 0 && /public repositor/i.test(priv.out) && toolsFolder().length === 0, `${priv.cards.length} card(s); ${priv.out.replace(/\s+/g, ' ').slice(0, 160)}`);
  state.private = false;
  state.moveAfterCard = true; state.cardCalls = 0; seen.length = 0;
  const moved = await say(await newSession('ask'), 'install it', true); state.moveAfterCard = false;
  check('G2', 'the branch moves after the card was shown: nothing is installed ("repository changed after the card")', /changed after the card|newer commit/i.test(moved.out) && toolsFolder().length === 0, `tools ${JSON.stringify(toolsFolder())}; ${moved.out.replace(/\s+/g, ' ').slice(0, 200)}`);
  const odd = await say(await newSession('ask'), 'install it', true);
  void odd;
  // H. a helper must not be able to install (not offered), and the tool is described as asking
  const src = readFileSync(join(process.cwd(), 'src/server/appTools.js'), 'utf8'); const line = src.split(NL).find((l) => l.includes("fn('install_from_github'")) ?? '';
  check('H1', 'the install_from_github tool description tells the model the person sees a card and must say yes, that scripts are not run', /must say yes/.test(line) && /scripts are NOT run/.test(line), line.slice(0, 200));
} catch (e) { console.log('ABORT', e.stack ?? e.message); rows.push({ id: 'X', ok: false }); }
try { await holder.app.localMcp.stopAll?.(); } catch { /* x */ }
for (const f of cleanups.reverse()) { try { await f(); } catch { /* x */ } }
const bad = rows.filter((r) => !r.ok); console.log(`${NL}${rows.length - bad.length} of ${rows.length} passed`); process.exit(bad.length ? 1 : 0);

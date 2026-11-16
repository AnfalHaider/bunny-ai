import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startApp, post } from './helpers.js';
import { translateChains, detectDevServer } from '../src/server/workspace.js';
import { parseImport } from '../src/server/import.js';

/**
 * Q-2 audit (QA, 2026-11-16): the behaviours verified by hand-driving every screen, turned into tests.
 * Tests that pin a behaviour that is correct today are plain tests. A test for a defect found in the audit is
 * marked { todo: 'Q2-n' }: it states the correct behaviour, is reported but does not fail the gate while the
 * defect stands, and starts to pass when the Builder fixes it (then remove the todo).
 * The write-up, with evidence, is docs/plans/audit-q2.md.
 */

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');
const sse = (delta) => `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
const j = { 'content-type': 'application/json' };

/**
 * A model server with a few personalities: "bad-model" answers 429; "tooler" asks for write_file
 * (then says done); anything else answers "ok".
 */
async function modelServer(t) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"},{"id":"bad-model"},{"id":"tooler"}]}'); return; }
      const body = JSON.parse(raw);
      seen.push(body);
      if (body.model === 'bad-model') { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"error":{"message":"Rate limit exceeded"}}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const afterTool = body.messages.some((m) => m.role === 'tool');
      if (body.model === 'tooler' && !afterTool) {
        res.end(sse({ tool_calls: [{ index: 0, id: 'call_1', function: { name: 'write_file', arguments: JSON.stringify({ path: 'note.txt', content: 'carrots\n' }) } }] }) + 'data: [DONE]\n\n');
      } else res.end(sse({ content: afterTool ? 'done' : 'ok' }) + 'data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { seen, url: `http://127.0.0.1:${server.address().port}/v1` };
}

async function app(t) {
  const { base } = await startApp(t, { fake: false });
  const { url, seen } = await modelServer(t);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: url });
  return { base, seen };
}
const setting = (base, id, name, value) => fetch(`${base}/api/sessions/${id}/setting/${name}`, { method: 'PATCH', headers: j, body: JSON.stringify({ value }) });
const say = async (base, id, content, extra = {}) => (await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content, providerId: 'openai', model: 'tooler', workMode: 'code', ...extra }) })).text();
const codeSession = async (base, mode) => {
  const folder = await mkdtemp(join(tmpdir(), 'bunny-q2-unit-'));
  const { body: s } = await post(base, '/api/sessions', { title: 'q2', providerId: 'openai', model: 'tooler' });
  await setting(base, s.id, 'folder', folder);
  await setting(base, s.id, 'workMode', 'code');
  await setting(base, s.id, 'permissionMode', mode);
  return { id: s.id, folder };
};

// ---------------------------------------------------------------- permission modes (HIGH)

test('Auto mode lets the model write a file in the chosen folder (the harness works)', async (t) => {
  const { base } = await app(t);
  const { id, folder } = await codeSession(base, 'auto');
  await say(base, id, 'write the note');
  assert.equal(await readFile(join(folder, 'note.txt'), 'utf8'), 'carrots\n');
});

test('Q2-1: Plan mode never writes, even when the model calls write_file anyway', async (t) => {
  const { base, seen } = await app(t);
  const { id, folder } = await codeSession(base, 'plan');
  await say(base, id, 'write the note');
  const offered = seen[0].tools.map((d) => d.function.name);
  assert.ok(!offered.includes('write_file'), 'Plan mode should not even offer write_file');
  assert.equal(existsSync(join(folder, 'note.txt')), false, 'a file was written in Plan mode');
});

// ---------------------------------------------------------------- fallback (MEDIUM)

test('a model that answers 429 is replaced by the next one and the reply is saved', async (t) => {
  const { base } = await app(t);
  const { body: s } = await post(base, '/api/sessions', { title: 'fallback', providerId: 'openai', model: 'bad-model' });
  await say(base, s.id, 'hello', { model: 'bad-model', workMode: 'chat' });
  await say(base, s.id, 'hello', { model: 'gpt-4o', workMode: 'chat', retry: true, fellBackFrom: 'bad-model' });
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  assert.ok(saved.messages.some((m) => m.role === 'assistant' && m.content === 'ok'));
  assert.equal(saved.messages.filter((m) => m.role === 'user').length, 1, 'the user message is saved once');
});

test('Q2-11: once a fallback model has answered, the failed attempt is not left in the chat as a red "could not finish" line', async (t) => {
  const { base } = await app(t);
  const { body: s } = await post(base, '/api/sessions', { title: 'fallback', providerId: 'openai', model: 'bad-model' });
  await say(base, s.id, 'hello', { model: 'bad-model', workMode: 'chat' });
  await say(base, s.id, 'hello', { model: 'gpt-4o', workMode: 'chat', retry: true, fellBackFrom: 'bad-model' });
  const saved = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
  assert.equal(saved.messages.filter((m) => m.kind === 'error').length, 0, JSON.stringify(saved.messages.map((m) => m.kind ?? m.role)));
});

test('Q2-10: a model that sends nothing is given up on within 45 seconds (it is 120 s today, three times over before the person hears anything)', async () => {
  const src = await read('src/server/chat.js');
  const ms = Number(/DEFAULT_STALL_MS\s*=\s*([\d_]+)/.exec(src)?.[1].replace(/_/g, ''));
  assert.ok(ms > 0 && ms <= 45_000, `DEFAULT_STALL_MS is ${ms}`);
});

test('Q2-12: the "answered instead" note does not say "busy" when the model simply did not answer', async () => {
  const src = await read('src/ui/i18n-agent.js');
  assert.ok(/'model\.answeredInstead\w+'/.test(src) || !/answeredInstead'?:\s*'[^']*was busy/.test(src), 'only a "was busy" wording exists');
});

// ---------------------------------------------------------------- run_command and "&" (MEDIUM)

test('translateChains turns && and || into PowerShell 5.1 form and leaves quoted text alone', () => {
  assert.equal(translateChains('a && b'), 'a; if ($?) { b }');
  assert.equal(translateChains('a || b'), 'a; if (-not $?) { b }');
  assert.equal(translateChains('echo "x && y"'), 'echo "x && y"');
});

test('Q2-8: a trailing & (background job) is not passed to Windows PowerShell 5.1, which rejects it', () => {
  const out = translateChains('npx serve -l 3001 &');
  assert.ok(!/(^|[^&])&\s*$/.test(out), `still ends with a bare &: ${out}`);
});

// ---------------------------------------------------------------- dev server detection

test('detectDevServer reads the dev script and its port from package.json', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-q2-dev-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'node server.js --port 4177' } }));
  const d = await detectDevServer(dir);
  assert.equal(d.port, 4177);
  assert.equal(d.command, 'npm run dev');
  assert.equal(await detectDevServer(await mkdtemp(join(tmpdir(), 'bunny-q2-none-'))), null);
});

// ---------------------------------------------------------------- import

test('importing a transcript with "## You" / "## Assistant" headings makes two messages', () => {
  const p = parseImport('## You\nhi there\n\n## Assistant\nhello back');
  assert.deepEqual(p.messages.map((m) => m.role), ['user', 'assistant']);
});

test('Q2-16: a transcript written as "User: ..." / "Assistant: ..." on one line is understood', { todo: 'Q2-16: src/server/import.js:98 only matches a label that stands alone on its line; the app answers "No messages were found in that file."' }, () => {
  const p = parseImport('User: hi there\nAssistant: hello back');
  assert.equal(p.messages.length, 2);
});

// ---------------------------------------------------------------- screens that are wired (source checks, same idea as the existing structure tests)

const panes = async () => ({ html: await read('src/ui/index.html'), js: (await Promise.all(['chat.js', 'browser-pane.js', 'pane-layout.js', 'embed.js', 'api.js'].map((f) => read(`src/ui/${f}`)))).join('\n') });

test('the Tasks, Terminal and Browser panes have code that fills them', async () => {
  const { js } = await panes();
  for (const id of ['tasks-content', 'terminal-output', 'browser-tabs-content']) assert.ok(js.includes(`'${id}'`), `no code uses #${id}`);
});

test('Q2-4: the Changes pane has code that fills it and a Refresh that does something', { todo: 'Q2-4: src/ui/index.html:312-315 is markup only; nothing in src/ui/*.js uses #diff-content or #pane-diff-refresh and the server has no route that lists changed files' }, async () => {
  const { js } = await panes();
  assert.ok(js.includes("'diff-content'") && js.includes("'pane-diff-refresh'"), 'no UI code touches the Changes pane');
});

test('Q2-5: the Files pane has code that fills it', { todo: 'Q2-5: src/ui/index.html:354-356 is markup only; nothing in src/ui/*.js uses #file-content and the server has no route that lists or reads a folder for the UI' }, async () => {
  const { js } = await panes();
  assert.ok(js.includes("'file-content'"), 'no UI code touches the Files pane');
});

test('Q2-7: the Plan pane has code that fills it and a way to reach it', { todo: 'Q2-7: #pane-plan (src/ui/index.html:362-364) is never filled and #tab-plan is not visible; the toolbar has no Plan button' }, async () => {
  const { js } = await panes();
  assert.ok(js.includes("'plan-content'"), 'no UI code touches the Plan pane');
});

test('Q2-6: the Session pane shows more than "This computer", the project, the context meter, connectors and outputs', { todo: 'Q2-6: src/ui/chat.js:1267-1320 renderRail and src/ui/index.html:261-285 show five things; the folder, branch, model, mode, effort, counts, changed files, tasks and programs are missing' }, async () => {
  const { html, js } = await panes();
  const rail = html.slice(html.indexOf('id="rail"'), html.indexOf('id="side-pane"'));
  const has = ['rail-model', 'rail-folder', 'rail-branch', 'rail-mode', 'rail-messages', 'rail-tokens'].filter((id) => rail.includes(id) || js.includes(`'${id}'`));
  assert.ok(has.length >= 4, `found ${has.length} of the six details the pane should show`);
});

// ---------------------------------------------------------------- composer and palette

test('Q2-3: choosing a permission mode or effort before the first message does not send a request for session "null"', async () => {
  const js = await read('src/ui/chat.js');
  const handler = /\$\('permission-mode'\)\?\.addEventListener\('change', async \(e\) => \{([\s\S]*?)\}\);/.exec(js)?.[1] ?? '';
  assert.ok(/state\.sessionId\s*(&&|\?)|if \(!state\.sessionId\)/.test(handler), 'the handler does not check for a session');
});

test('Q2-2: the chosen permission mode survives a redraw of the composer in a new chat', async () => {
  const js = await read('src/ui/chat.js');
  assert.ok(!/^\s*if \(permMode\) permMode\.value = state\.session\?\.permissionMode \?\?/m.test(js), 'renderComposerHeader resets the mode select unconditionally');
});

test('Q2-14: the command palette can be driven from the keyboard (Arrow keys and Enter)', { todo: 'Q2-14: src/ui/chat.js:3198 only listens for "input" on #palette-input' }, async () => {
  const js = await read('src/ui/chat.js');
  assert.ok(/palette-input'\)\.addEventListener\('keydown'/.test(js), 'no keydown handler on the palette input');
});

test('Q2-15: the palette\'s Settings and Providers commands open the Settings window instead of leaving the chat', { todo: 'Q2-15: src/ui/chat.js:2959-2960 set location.href to settings.html / providers.html' }, async () => {
  const js = await read('src/ui/chat.js');
  const cmds = /const PALETTE_COMMANDS = \[([\s\S]*?)\n\];/.exec(js)?.[1] ?? '';
  assert.ok(!/location\.href/.test(cmds), 'a palette command navigates the whole page');
});

test('Q2-17: no screen uses window.prompt, which the desktop (Electron) app does not support', async () => {
  const files = ['chat.js', 'browser-pane.js', 'api.js', 'embed.js', 'pane-layout.js'];
  for (const f of files) assert.ok(!/window\.prompt\(|[^.\w]prompt\(/.test((await read(`src/ui/${f}`)).replace(/\/\/.*$/gm, '')), `${f} calls prompt()`);
});

test('Q2-18: "New terminal" (＋) opens another shell when one is already running', { todo: 'Q2-18: src/ui/chat.js:168 terminalStart returns at once when state.terminalId is set, so ＋ does nothing' }, async () => {
  const js = await read('src/ui/chat.js');
  assert.ok(!/async function terminalStart\(\) \{\s*if \(state\.terminalId\) return;/.test(js), '＋ is a no-op while a shell exists');
});

// ---------------------------------------------------------------- browser pane

test('Q2-9: the browser pane tells the person when a page is not reachable instead of showing a browser error page', async () => {
  const js = await read('src/ui/browser-pane.js');
  assert.ok(/chrome-error|ERR_CONNECTION|not reachable|could not reach|is not running/i.test(js), 'no handling for an unreachable page');
});

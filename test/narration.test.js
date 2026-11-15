import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp, post } from './helpers.js';
import { parseTextToolCalls, stripToolMarkup } from '../src/server/chat.js';
import { translateChains, decodeText, createWorkspace } from '../src/server/workspace.js';
import { stoppedReport } from '../src/server/app.js';

const windows = process.platform === 'win32';

test('&& and || become what Windows PowerShell 5.1 understands; quoted text is left alone', () => {
  assert.equal(translateChains('cd rea && npm run build'), 'cd rea; if ($?) { npm run build }');
  assert.equal(translateChains('a && b || c'), 'a; if ($?) { b; if (-not $?) { c } }');
  assert.equal(translateChains('echo "x && y" && dir'), 'echo "x && y"; if ($?) { dir }');
  assert.equal(translateChains('npm test'), 'npm test');
});

test('a file PowerShell saved as UTF-16 reads as words, not as boxes', () => {
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"error":"x"}', 'utf16le')]);
  assert.equal(decodeText(utf16), '{"error":"x"}');
  assert.equal(decodeText(Buffer.from([0xef, 0xbb, 0xbf, 0x68, 0x69])), 'hi');
  assert.equal(decodeText(Buffer.from('plain')), 'plain');
});

test('run_command runs in a subfolder with cwd, and a silent failure says where its output went', { skip: !windows }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-ws-'));
  await writeFile(join(root, 'marker.txt'), '');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(root, 'sub'));
  await writeFile(join(root, 'sub', 'inner.txt'), '');
  const ws = createWorkspace(root);
  const listed = await ws.run('run_command', { command: 'Get-ChildItem -Name', cwd: 'sub' });
  assert.match(String(listed), /inner\.txt/);
  assert.doesNotMatch(String(listed), /marker\.txt/);
  const chained = await ws.run('run_command', { command: 'echo one && echo two' });
  assert.match(String(chained), /one[\s\S]*two/);
  const silent = await ws.run('run_command', { command: 'cmd /c "exit 1" > out.txt' });
  assert.match(String(silent), /exit code 1\].*read that file/);
});

test('tool calls a model writes as text are read, in both common forms, and only for offered tools', () => {
  const offered = new Set(['run_command', 'read_file']);
  const xml = 'Let me build it.\n<tool_call>\n<function=run_command>\n<parameter=command>\nnpm run build\n</parameter>\n<parameter=cwd>\nrea\n</parameter>\n</function>\n</tool_call>';
  const calls = parseTextToolCalls(xml, offered);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'run_command');
  assert.deepEqual(JSON.parse(calls[0].function.arguments), { command: 'npm run build', cwd: 'rea' });
  assert.equal(stripToolMarkup(xml), 'Let me build it.');
  const json = '<tool_call>{"name": "read_file", "arguments": {"path": "a.txt"}}</tool_call>';
  assert.deepEqual(JSON.parse(parseTextToolCalls(json, offered)[0].function.arguments), { path: 'a.txt' });
  assert.equal(parseTextToolCalls('<function=computer_type><parameter=text>hi</parameter></function>', offered).length, 0);
  assert.equal(parseTextToolCalls('No tools here.', offered).length, 0);
});

test('the stopped report lists the last steps and says how to carry on', () => {
  const text = stoppedReport(['Read a', 'Run b', 'Run c', 'Write d', 'Run e', 'Run f (failed)']);
  assert.match(text, /6 in all/);
  assert.match(text, /- Run f \(failed\)/);
  assert.doesNotMatch(text, /- Read a/);
  assert.match(text, /\*\*continue\*\*/);
});

/**
 * A model that narrates, writes its tool call as text (not as a proper call), and then
 * stops without a word, also when asked for its answer.
 */
async function narratingProvider(t) {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
      const body = JSON.parse(raw);
      const toolTurns = body.messages.filter((m) => m.role === 'tool').length;
      const text = toolTurns === 0
        ? 'Looking at the files first.\n<tool_call>\n<function=list_files>\n<parameter=path>\n.\n</parameter>\n</function>\n</tool_call>'
        : '';
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`${text ? `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` : ''}data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return `http://127.0.0.1:${server.address().port}/v1`;
}

test('a written-out tool call runs, the words before it stay with the step, and a silent end gets a report', async (t) => {
  const { base } = await startApp(t, { fake: false });
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: await narratingProvider(t) });
  const { body: session } = await post(base, '/api/sessions', { title: 'Narrate' });
  const folder = await mkdtemp(join(tmpdir(), 'bunny-narrate-'));
  await writeFile(join(folder, 'hello.txt'), 'hi');
  await fetch(`${base}/api/sessions/${session.id}/setting/folder`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: folder }) });
  const res = await fetch(`${base}/api/sessions/${session.id}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'do it', providerId: 'openai', model: 'gpt-4o', workMode: 'code' }),
  });
  const stream = await res.text();
  assert.match(stream, /event: tool/);
  assert.match(stream, /I stopped before writing my report/);
  const saved = await (await fetch(`${base}/api/sessions/${session.id}`)).json();
  const step = saved.messages.find((m) => m.kind === 'tool_call');
  assert.equal(step.note, 'Looking at the files first.');
  const reply = saved.messages.at(-1);
  assert.equal(reply.role, 'assistant');
  assert.doesNotMatch(reply.content, /tool_call|Looking at the files/);
  assert.match(reply.content, /Send \*\*continue\*\*/);
});

test('the working bunny picks words that match the step', async () => {
  const { moodOf, WORDS } = await import('../src/ui/bunny-working.js');
  assert.deepEqual(moodOf('Read src/app.js'), { kind: 'reading', about: 'src/app.js' });
  assert.equal(moodOf('Run npm run build').kind, 'running');
  assert.equal(moodOf('Write analysis/scenario.json').kind, 'writing');
  assert.equal(moodOf('Search "login"').kind, 'searching');
  assert.equal(moodOf('helper › Read a.txt').kind, 'reading');
  assert.equal(moodOf('Something new').kind, 'waiting');
  assert.ok(moodOf(`Read ${'x'.repeat(80)}`).about.length <= 42);
  assert.ok(WORDS.failed.includes('Thumping at that error'));
  assert.ok(WORDS.running.includes('Thumping'));
});

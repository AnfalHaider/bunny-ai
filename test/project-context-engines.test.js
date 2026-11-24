/**
 * PROJECT-CONTEXT §5: the engines get the same parts in one block. Claude Code in the first prompt of a session and when a part changes (saying it replaces the earlier one);
 * Codex in every turn. Stand-in engines only (BUNNY_FAKE_ENGINE): no real program, account or network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { json, post, startApp } from './helpers.js';

const put = (base, path, body) => json(base, path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function setup(t, engine) {
  const dump = join(await mkdtemp(join(tmpdir(), 'bunny-pc-eng-')), 'prompts.txt');
  const keep = { fake: process.env.BUNNY_FAKE_ENGINE, script: process.env.BUNNY_FAKE_ENGINE_SCRIPT, log: process.env.BUNNY_FAKE_PROMPT_LOG };
  process.env.BUNNY_FAKE_ENGINE = '1';
  process.env.BUNNY_FAKE_ENGINE_SCRIPT = JSON.stringify({ steps: [{ say: 'ok' }] });
  process.env.BUNNY_FAKE_PROMPT_LOG = dump; // the stand-in appends what it was sent, one JSON line per turn
  t.after(() => { for (const [k, v] of [['BUNNY_FAKE_ENGINE', keep.fake], ['BUNNY_FAKE_ENGINE_SCRIPT', keep.script], ['BUNNY_FAKE_PROMPT_LOG', keep.log]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  const { base } = await startApp(t);
  await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000' });
  await put(base, '/api/settings', { engine });
  assert.equal((await post(base, `/api/engines/${engine}/download`, {})).status, 202);
  for (let i = 0; i < 100; i += 1) { if ((await json(base, '/api/engines')).body.engines.find((e) => e.id === engine).downloaded) break; await new Promise((r) => setTimeout(r, 50)); }
  const folder = await mkdtemp(join(tmpdir(), 'bunny-pc-eng-folder-'));
  const project = (await post(base, '/api/projects', { name: 'Carrot shop', instructions: 'Plain HTML, no framework.' })).body;
  await post(base, `/api/projects/${project.id}/memory`, { kind: 'decision', text: 'Use tabs, not spaces.' });
  const session = (await post(base, '/api/sessions', { title: 'Engine chat', workMode: 'code', folder, projectId: project.id })).body;
  const say = (content) => fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: 'openai', model: 'test-model-1', workMode: 'code' }) }).then((r) => r.text());
  // Claude Code reads one JSON user message on stdin; Codex gets turn/start params: both are decoded to the text the engine was sent
  const decode = (raw) => { try { const j = JSON.parse(raw); return j?.message?.content?.[0]?.text ?? JSON.stringify(j?.input ?? j); } catch { return raw; } };
  const prompts = async () => (await readFile(dump, 'utf8').catch(() => '')).split(/[\r\n]+/).filter(Boolean).map((line) => decode(JSON.parse(line).input));
  return { base, project, session, say, prompts };
}

test('Claude Code: the first prompt carries the project block; a resumed turn does not; a changed memory is sent again and says it replaces the earlier one', async (t) => {
  const { base, project, say, prompts } = await setup(t, 'claude-code');
  await say('first message');
  const first = (await prompts())[0];
  assert.match(first, /Project instructions for Carrot shop:\nPlain HTML, no framework\./);
  assert.match(first, /\[decision\] Use tabs, not spaces\./);
  assert.match(first, /first message/);
  assert.doesNotMatch(first, /This replaces the project context/);
  await say('second message');
  const second = (await prompts())[1];
  assert.doesNotMatch(second, /Carrot shop/, 'a resumed Claude Code turn does not carry it again');
  assert.match(second, /second message/);
  await post(base, `/api/projects/${project.id}/memory`, { kind: 'fact', text: 'Hosting is a static bucket.' });
  await say('third message');
  const third = (await prompts())[2];
  assert.match(third, /This replaces the project context given earlier\./);
  assert.match(third, /static bucket/);
});

test('Codex: every turn carries the project block (its threads do not last)', async (t) => {
  const { say, prompts } = await setup(t, 'codex');
  await say('first message');
  await say('second message');
  const all = await prompts();
  assert.equal(all.length, 2);
  for (const p of all) {
    assert.match(p, /Project instructions for Carrot shop/);
    assert.match(p, /Use tabs, not spaces\./);
  }
});

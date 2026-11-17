import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppTools } from '../src/server/appTools.js';
import { createSkillStore } from '../src/server/skills.js';
import { createMcpStore } from '../src/server/mcpStore.js';

// W4-11 P-4: a plugin can be updated from its source.
const skill = (name, body, description = `about ${name}`) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

function github(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files.current).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
    if (m && files.current[m[1]] !== undefined) return new Response(files.current[m[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  };
}

const V1 = {
  'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how v1' }),
  'skills/grow/SKILL.md': skill('grow', 'Water them every morning.'),
  'skills/pick/SKILL.md': skill('pick', 'Pick when the tops are thick.'),
  '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' }, soil: { url: 'https://soil.example.com/mcp' } } }),
};
const V2 = {
  'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how v2' }),
  'skills/grow/SKILL.md': skill('grow', 'Water them every second morning.', 'How to grow carrots, v2'),
  'skills/store/SKILL.md': skill('store', 'Keep them cool and damp.'),
  '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' }, market: { url: 'https://market.example.com/mcp' } } }),
};

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-p4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const skills = createSkillStore({ file: join(dir, 'skills.json') });
  const mcp = createMcpStore({ file: join(dir, 'mcp.json') });
  let settings = {};
  const files = { current: V1 };
  const tools = createAppTools({ skills, mcp, getSettings: () => settings, saveSettings: async (patch) => { settings = { ...settings, ...patch }; }, fetchImpl: github(files) });
  const { record } = await tools.installFromGithub('https://github.com/bunny/carrot-helper');
  return { skills, mcp, tools, files, record, settings: () => settings };
}

test('P-4: skills are updated in place (their state stays), new ones added, gone ones removed; connectors kept, new ones OFF, gone ones removed', async (t) => {
  const s = await setup(t);
  const [weather] = (await s.mcp.list()).filter((c) => c.name === 'weather');
  await s.mcp.setStatus(weather.id, { status: 'connected', tools: [{ name: 'look', readOnlyHint: true }] });
  await s.mcp.update(weather.id, { trustReadOnly: true });
  const mine = await s.skills.add({ name: 'my-own', description: 'not from the plugin', instructions: 'mine', enabled: true });
  const growBefore = (await s.skills.list()).find((x) => x.name === 'grow');
  await s.skills.update(growBefore.id, { enabled: false }); // the person switched this one off
  s.files.current = V2;
  const r = await s.tools.updatePlugin(s.record.id);
  assert.equal(r.ok, true);
  assert.deepEqual([r.skillsUpdated, r.skillsAdded, r.skillsRemoved], [1, 1, 1]);
  assert.deepEqual([r.connectorsKept, r.connectorsAdded, r.connectorsRemoved], [1, 1, 1]);
  const all = await s.skills.list();
  const grow = all.find((x) => x.name === 'grow');
  assert.equal(grow.id, growBefore.id, 'updated where it was');
  assert.match(grow.instructions, /every second morning/);
  assert.equal(grow.description, 'How to grow carrots, v2');
  assert.equal(grow.enabled, false, 'it stays off');
  assert.equal(all.find((x) => x.name === 'pick'), undefined, 'gone from the source, gone here');
  assert.ok(all.find((x) => x.name === 'store'), 'new skill added');
  assert.equal(all.find((x) => x.name === 'store').enabled, false, 'on only if all the plugin\'s skills were on, and one was off');
  assert.ok(all.find((x) => x.id === mine.id), 'the person\'s own skill is untouched');
  const connectors = await s.mcp.list();
  assert.deepEqual(connectors.map((c) => c.name).sort(), ['market', 'weather']);
  assert.equal(connectors.find((c) => c.name === 'weather').trustReadOnly, true, 'a kept connector keeps its trust');
  assert.equal(connectors.find((c) => c.name === 'market').enabled, false, 'a new connector arrives OFF');
  const record = s.settings().plugins[0];
  assert.equal(record.description, 'Carrot know-how v2');
  assert.equal(record.skills.length, 2);
  assert.equal(record.connectors.length, 2);
});

test('P-4: an update never switches a connector on, and a plugin that was all on gets its new skills on', async (t) => {
  const s = await setup(t);
  for (const c of await s.mcp.list()) await s.mcp.update(c.id, { enabled: true });
  s.files.current = V2;
  await s.tools.updatePlugin(s.record.id);
  const connectors = await s.mcp.list();
  assert.equal(connectors.find((c) => c.name === 'weather').enabled, true, 'an old connector keeps its own state');
  assert.equal(connectors.find((c) => c.name === 'market').enabled, false, 'the new one is off even though the plugin was on');
  assert.equal((await s.skills.list()).find((x) => x.name === 'store').enabled, true);
});

test('P-4: a plugin that is gone, or one that came from a file, says so plainly', async (t) => {
  const s = await setup(t);
  assert.equal((await s.tools.updatePlugin('00000000-0000-4000-8000-000000000000')).code, 'plugin.notFound');
  const bundle = await s.tools.installBundle({ name: 'from-file', connectors: [], skills: [{ name: 'f', instructions: 'x' }] });
  const r = await s.tools.updatePlugin(bundle.id);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'plugin.noSource');
});

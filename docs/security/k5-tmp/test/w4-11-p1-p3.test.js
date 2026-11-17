import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGithubPlugin } from '../src/server/pluginImport.js';
import { createAppTools } from '../src/server/appTools.js';

// W4-11 P-1 (plugin layouts) and P-3 (connectors in .mcp.json that need a key, or are legacy SSE).
function fakeGithub(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
    if (m && files[m[1]] !== undefined) return new Response(files[m[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  };
}
const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\nDo ${name}.`;

test('P-1: skills under a nested plugin folder and under .claude/skills are found', async () => {
  const nested = await readGithubPlugin('https://github.com/o/many', { fetchImpl: fakeGithub({ 'plugins/alpha/skills/one/SKILL.md': skill('one', 'First'), 'plugins/beta/skills/two/SKILL.md': skill('two', 'Second') }) });
  assert.deepEqual(nested.skills.map((s) => s.name).sort(), ['one', 'two']);
  const dot = await readGithubPlugin('https://github.com/o/dot', { fetchImpl: fakeGithub({ '.claude/skills/three/SKILL.md': skill('three', 'Third') }) });
  assert.deepEqual(dot.skills.map((s) => s.name), ['three']);
  const plain = await readGithubPlugin('https://github.com/o/plain', { fetchImpl: fakeGithub({ 'skills/four/SKILL.md': skill('four', 'Fourth') }) });
  assert.deepEqual(plain.skills.map((s) => s.name), ['four']);
  // a SKILL.md that is only an example deep inside docs is still not taken
  await assert.rejects(readGithubPlugin('https://github.com/o/docs', { fetchImpl: fakeGithub({ 'docs/examples/deep/more/SKILL.md': skill('x', 'y') }) }), /no skills/);
});

test('P-3: a plain connector is added on, a legacy SSE one is skipped with the reason, one that needs headers is added OFF and said so', async () => {
  const mcp = JSON.stringify({ mcpServers: {
    plain: { url: 'https://plain.example.com/mcp' },
    legacy: { type: 'sse', url: 'https://legacy.example.com/sse' },
    keyed: { url: 'https://keyed.example.com/mcp', headers: { Authorization: 'Bearer ${TOKEN}' } },
  } });
  const plugin = await readGithubPlugin('https://github.com/o/mixed', { fetchImpl: fakeGithub({ 'skills/a/SKILL.md': skill('a', 'A'), '.mcp.json': mcp }) });
  assert.deepEqual(plugin.connectors, [{ name: 'plain', url: 'https://plain.example.com/mcp' }, { name: 'keyed', url: 'https://keyed.example.com/mcp', enabled: false }]);
  assert.ok(plugin.skipped.some((s) => /legacy.*older SSE server/.test(s)));
  assert.ok(plugin.skipped.some((s) => /keyed.*needs a key or sign-in.*switched off/.test(s)));
  // installing it keeps the "off"
  const added = [];
  let settings = {};
  const tools = createAppTools({
    skills: { add: async (s) => ({ id: `sk-${s.name}`, ...s }), remove: async () => {} },
    mcp: { add: async (c) => { added.push(c); return { id: `c-${c.name}`, ...c }; }, remove: async () => {} },
    getSettings: () => settings, saveSettings: async (patch) => { settings = { ...settings, ...patch }; },
    fetchImpl: fakeGithub({ 'skills/a/SKILL.md': skill('a', 'A'), '.mcp.json': mcp }),
  });
  await tools.installFromGithub('https://github.com/o/mixed');
  assert.deepEqual(added.map((c) => [c.name, c.enabled]), [['plain', true], ['keyed', false]]);
});

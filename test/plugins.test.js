import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGithubPlugin, parseGithubUrl } from '../src/server/pluginImport.js';
import { createAppTools } from '../src/server/appTools.js';

/** A stand-in GitHub holding one plugin repository. */
function fakeGithub(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
    if (m && files[m[1]] !== undefined) return new Response(files[m[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  };
}

const files = {
  'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how', version: '1.0.0' }),
  'skills/grow/SKILL.md': '---\nname: grow\ndescription: How to grow carrots\n---\nWater them every morning.',
  'skills/grow/references/soil.md': 'Sandy soil is best.',
  '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' }, files: { command: 'npx', args: ['-y', 'some-server'] } } }),
  'hooks/pre.sh': 'echo hi',
};

test('a GitHub plugin is read: its skills with their references, remote connectors, and what was left out', async () => {
  assert.deepEqual(parseGithubUrl('https://github.com/bunny/carrot-helper'), { owner: 'bunny', repo: 'carrot-helper', ref: 'HEAD', base: '' });
  const plugin = await readGithubPlugin('https://github.com/bunny/carrot-helper', { fetchImpl: fakeGithub(files) });
  assert.equal(plugin.name, 'carrot-helper');
  assert.equal(plugin.skills[0].name, 'grow');
  assert.match(plugin.skills[0].instructions, /Water them every morning\.[\s\S]*Reference: references\/soil\.md[\s\S]*Sandy soil/);
  assert.deepEqual(plugin.connectors, [{ name: 'weather', url: 'https://weather.example.com/mcp' }]);
  assert.ok(plugin.skipped.some((s) => /local connector "files" \(npx -y some-server\): add it with add_connector/.test(s)));
  assert.ok(plugin.skipped.some((s) => /1 hooks file/.test(s)));
  await assert.rejects(readGithubPlugin('https://example.com/x', { fetchImpl: fakeGithub(files) }), /not a GitHub repository link/);
  await assert.rejects(readGithubPlugin('https://github.com/bunny/empty', { fetchImpl: fakeGithub({ 'README.md': 'hi' }) }), /no skills/);
});

test('a plugin the model installs is added switched OFF (P-6), and recorded', async () => {
  const added = { skills: [], connectors: [] };
  let settings = {};
  const tools = createAppTools({
    skills: { add: async (s) => { added.skills.push(s); return { id: `s${added.skills.length}` }; } },
    mcp: { add: async (c) => { added.connectors.push(c); return { id: `c${added.connectors.length}`, name: c.name }; } },
    getSettings: () => settings,
    saveSettings: async (patch) => { settings = { ...settings, ...patch }; return settings; },
    fetchImpl: fakeGithub(files),
  });
  const result = await tools.run('install_plugin', { url: 'https://github.com/bunny/carrot-helper' });
  assert.match(result, /Installed carrot-helper: 1 skill\(s\) \[grow\], 1 connector\(s\)/);
  assert.match(result, /add it with add_connector/);
  assert.match(result, /switched OFF/);
  assert.equal(added.skills[0].enabled, false);
  assert.deepEqual(added.connectors[0], { name: 'weather', url: 'https://weather.example.com/mcp', enabled: false });
  assert.equal(settings.plugins[0].name, 'carrot-helper');
  assert.deepEqual(settings.plugins[0].skills, ['s1']);
});

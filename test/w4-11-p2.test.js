import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readGithubPlugin } from '../src/server/pluginImport.js';

// W4-11 P-2: a plugin's commands become skills named plugin:command, and its agents become helper briefs; hooks stay skipped and are listed.
function fakeGithub(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
    if (m && files[m[1]] !== undefined) return new Response(files[m[1]], { status: 200 });
    return new Response('not found', { status: 404 });
  };
}

const REPO = {
  'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how' }),
  'skills/grow/SKILL.md': '---\nname: grow\ndescription: How to grow carrots\n---\nWater them every morning.',
  'commands/harvest.md': '---\ndescription: Work out when to harvest\n---\nAsk for the sowing date, then count 70 days.',
  'agents/scout.md': '---\ndescription: Looks over a field\n---\nWalk the rows and report what is ready.',
  'hooks/pre.sh': 'echo hi',
  'node_modules/dep/commands/bad.md': 'should never be imported',
};

test('P-2: a command becomes a skill named plugin:command, an agent a helper brief, and hooks stay listed as skipped', async () => {
  const plugin = await readGithubPlugin('https://github.com/bunny/carrot-helper', { fetchImpl: fakeGithub(REPO) });
  const byName = Object.fromEntries(plugin.skills.map((s) => [s.name, s]));
  assert.deepEqual(Object.keys(byName).sort(), ['agent:carrot-helper:scout', 'carrot-helper:harvest', 'grow']);
  const command = byName['carrot-helper:harvest'];
  assert.equal(command.description, 'Work out when to harvest');
  assert.match(command.instructions, /command \/harvest of the carrot-helper plugin/);
  assert.match(command.instructions, /count 70 days/);
  const agent = byName['agent:carrot-helper:scout'];
  assert.match(agent.description, /^Helper brief: Looks over a field/);
  assert.match(agent.instructions, /call run_subagent with this brief/);
  assert.match(agent.instructions, /report what is ready/);
  assert.ok(plugin.skipped.some((s) => /hooks and scripts made for other apps. They don.t run in Bunny yet/.test(s)));
  assert.ok(!plugin.skipped.some((s) => /commands|agents/.test(s)), 'commands and agents are no longer skipped');
  assert.ok(!plugin.skills.some((s) => /bad/.test(s.name)), 'nothing from node_modules');
});

test('P-2: a plugin with only commands is a plugin (it is not "no skills")', async () => {
  const plugin = await readGithubPlugin('https://github.com/bunny/only-commands', { fetchImpl: fakeGithub({ 'commands/ping.md': 'Say pong.' }) });
  assert.deepEqual(plugin.skills.map((s) => s.name), ['only-commands:ping']);
});

test('P-2: commands and agents count in the same limit of 40 as skills, and the rest are counted in a note', async () => {
  const files = {};
  for (let i = 0; i < 38; i += 1) files[`skills/s${i}/SKILL.md`] = `---\nname: s${i}\ndescription: d${i}\n---\nx`;
  for (let i = 0; i < 5; i += 1) files[`commands/c${i}.md`] = `Do ${i}.`;
  const plugin = await readGithubPlugin('https://github.com/bunny/many', { fetchImpl: fakeGithub(files) });
  assert.equal(plugin.skills.length, 40);
  assert.ok(plugin.skipped.some((s) => /^3 more commands or agents were not imported/.test(s)), plugin.skipped.join(' | '));
});

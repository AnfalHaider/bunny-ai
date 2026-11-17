import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mcpResultText } from '../src/server/mcp.js';
import { frontmatter, firstSentence } from '../src/server/pluginImport.js';
import { createAppTools } from '../src/server/appTools.js';
import { createSkillStore } from '../src/server/skills.js';
import { createMcpStore } from '../src/server/mcpStore.js';

// W4-11 slice C: D-1 (what the model reads from a connector), S-1 (a long skill in parts), S-2 (skill descriptions).

test('D-1: text parts are joined as text, not as escaped JSON', () => {
  const r = mcpResultText({ content: [{ type: 'text', text: 'line1\nline2' }, { type: 'text', text: 'line3' }], isError: false });
  assert.equal(r.text, 'line1\nline2\nline3');
  assert.equal(r.isError, false);
});

test('D-1: structuredContent shows as indented JSON when there is no text', () => {
  const r = mcpResultText({ content: [], structuredContent: { count: 2, items: ['a', 'b'] } });
  assert.equal(r.text, JSON.stringify({ count: 2, items: ['a', 'b'] }, null, 2));
});

test('D-1: an answer with isError is marked, so the step fails and the model is told', () => {
  const r = mcpResultText({ content: [{ type: 'text', text: 'no such file' }], isError: true });
  assert.equal(r.isError, true);
  assert.equal(r.text, 'The tool reported an error: no such file');
});

test('D-1: resources, links and pictures become short lines; nothing is empty', () => {
  const r = mcpResultText({ content: [
    { type: 'resource', resource: { uri: 'file:///a.txt', text: 'inside' } },
    { type: 'resource', resource: { uri: 'file:///b.bin', mimeType: 'application/octet-stream' } },
    { type: 'resource_link', name: 'Docs', uri: 'https://example.test/d' },
    { type: 'image', mimeType: 'image/png', data: 'A'.repeat(4096) },
  ] });
  assert.equal(r.text, 'inside\n[resource: file:///b.bin, application/octet-stream]\n[link: Docs https://example.test/d]\n[image: image/png, 3 KB, not shown here]');
  assert.equal(mcpResultText(null).text, '(the tool returned nothing)');
  assert.equal(mcpResultText({ content: [] }).text, '(the tool returned no text)');
});

test('S-2: front matter reads one-line, folded (>-) and literal (|) descriptions, and plain continuation lines', () => {
  const one = frontmatter('---\nname: a\ndescription: Does the thing\n---\nBody');
  assert.equal(one.data.description, 'Does the thing');
  const folded = frontmatter('---\nname: b\ndescription: >-\n  Does the other\n  thing well.\nversion: 2\n---\nBody');
  assert.equal(folded.data.description, 'Does the other thing well.');
  assert.equal(folded.data.version, '2');
  const literal = frontmatter('---\nname: c\ndescription: |\n  First line.\n  Second line.\n---\nBody');
  assert.equal(literal.data.description, 'First line.\nSecond line.');
  const quoted = frontmatter('---\nname: d\ndescription: "Quoted\n  over two lines"\n---\nBody');
  assert.equal(quoted.data.description, 'Quoted over two lines');
});

test('S-2: with no description the first sentence of the text that is not a heading is used', () => {
  assert.equal(firstSentence('# Title\n\n```js\ncode\n```\nUse this when you need to count carrots. More text.'), 'Use this when you need to count carrots. More text.');
  assert.equal(firstSentence('# Only a heading'), '');
});

test('S-1: a skill of 30,000 characters comes in parts of 8,000, every part reaches the model whole, and the marker in the middle is in one of them', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-skill-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const skills = createSkillStore({ file: join(dir, 'skills.json') });
  const mcp = createMcpStore({ file: join(dir, 'mcp.json') });
  const body = `${'a'.repeat(14_000)}MIDDLE-MARKER${'b'.repeat(16_000)}`;
  await skills.add({ name: 'long-one', description: 'a long one', instructions: body, enabled: true });
  const tools = createAppTools({ skills, mcp, getSettings: () => ({}), saveSettings: async () => {} });
  const parts = [];
  let part = 1;
  for (;;) {
    const got = await tools.run('read_skill', { name: 'long-one', part });
    parts.push(got);
    assert.doesNotMatch(got, /characters left out|Cut to/);
    if (/That was the last part/.test(got)) break;
    assert.match(got, new RegExp(`part ${part} of 4`));
    part += 1;
    assert.ok(part <= 10);
  }
  assert.equal(parts.length, 4);
  const joined = parts.map((p) => p.split('\n').slice(1, -1).join('\n')).join('');
  assert.equal(joined, body);
  assert.equal(parts.filter((p) => p.includes('MIDDLE-MARKER')).length, 1);
  // a short skill is returned whole, as before
  await skills.add({ name: 'short-one', description: 's', instructions: 'be brief', enabled: true });
  assert.equal(await tools.run('read_skill', { name: 'short-one' }), 'be brief');
});

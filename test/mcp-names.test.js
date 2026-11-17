import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { functionName, toToolDefinitions, connectorTools } from '../src/server/mcp.js';
import { createMcpStore } from '../src/server/mcpStore.js';

// W4-11 R-3 and R-4: a provider answers 400 to every message when one function name is not [a-zA-Z0-9_-]{1,64} or appears twice.
const OK = /^[a-zA-Z0-9_-]{1,64}$/;

test('R-3: a tool name with dots and slashes, and one of 70 characters, become names a provider accepts', () => {
  const defs = toToolDefinitions([{ name: 'a.b/c' }, { name: 'x'.repeat(70) }, { name: 'plain_tool' }], { prefix: 'notes' });
  for (const d of defs) assert.match(d.function.name, OK, d.function.name);
  assert.equal(defs[0].function.name, 'notes__a_b_c');
  assert.equal(defs[2].function.name, 'notes__plain_tool'); // a good name is left as it is
  assert.equal(defs[1].function.name.length, 64);
});

test('R-3: two long names that start alike stay apart, and a name is the same every time', () => {
  const a = functionName('p', `${'y'.repeat(80)}one`);
  const b = functionName('p', `${'y'.repeat(80)}two`);
  assert.notEqual(a, b);
  assert.equal(a, functionName('p', `${'y'.repeat(80)}one`));
  assert.match(a, OK);
});

test('R-4: two connectors of the same name, and two names that clean to the same text, give unique names, each mapped to its own tool', () => {
  const servers = [
    { id: 's1', name: 'Notes', tools: [{ name: 'a.b', readOnly: true }, { name: 'a/b', readOnly: true }] },
    { id: 's2', name: 'Notes', tools: [{ name: 'a.b', readOnly: true }] },
  ];
  const { definitions, index } = connectorTools(servers);
  const names = definitions.map((d) => d.function.name);
  assert.equal(new Set(names).size, 3, names.join(', '));
  for (const n of names) assert.match(n, OK);
  const owners = names.map((n) => `${index.get(n).server.id}:${index.get(n).tool.name}`);
  assert.deepEqual(owners.sort(), ['s1:a.b', 's1:a/b', 's2:a.b']);
});

test('Plan mode offers only the tools that read', () => {
  const { definitions } = connectorTools([{ id: 's', name: 'X', tools: [{ name: 'look', readOnly: true }, { name: 'change' }] }], { planMode: true });
  assert.deepEqual(definitions.map((d) => d.function.name), ['x__look']);
});

test('R-4: the same address twice is refused, with the first one named', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-mcp-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = createMcpStore({ file: join(dir, 'mcp.json') });
  const first = await store.add({ name: 'One', url: 'https://example.test/mcp' });
  await assert.rejects(store.add({ name: 'Two', url: 'https://EXAMPLE.test/mcp/' }), (err) => err.code === 'mcp.duplicate' && err.existing === first.id && /One/.test(err.message));
  assert.equal((await store.list()).length, 1);
  await store.add({ name: 'Other', url: 'https://example.test/other' });
  assert.equal((await store.list()).length, 2);
});

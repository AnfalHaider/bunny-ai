import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { resetProfile } from './helpers.js';
import { heldProvider } from './pictures/held-provider.mjs';

// AGENT-FLOW F7: three connectors of 30 tools each (90 tools: over the limit, so their definitions are deferred). The stand-in model calls a tool before loading it (refused), loads it with
// find_tools, and calls it (runs, once). The tool list of the next request is read from the saved steps.
const connectors = [];
async function connector(name) {
  const calls = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      const result = r.method === 'tools/list'
        ? { tools: Array.from({ length: 30 }, (_, i) => ({ name: `t${i}`, description: `${name} tool number ${i}`, inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } })) }
        : r.method === 'tools/call' ? (calls.push(r.params.name), { content: [{ type: 'text', text: `ran ${r.params.name}` }] }) : {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  connectors.push(server);
  return { calls, url: `http://127.0.0.1:${server.address().port}/mcp` };
}
test.afterEach(async ({ request }) => {
  await request.delete('/api/providers/custom-deferred-model').catch(() => {}); for (const s of connectors.splice(0)) await new Promise((r) => { s.closeAllConnections?.(); s.close(r); }); });

test('three 30-tool connectors: a call before loading is refused, find_tools loads one, and the call then runs once', async ({ request }) => {
  test.setTimeout(90_000);
  await resetProfile(request);
  // a scripted model (a custom provider is reached for real, even in test mode): it calls bravo__t7 before loading it, then find_tools, then bravo__t7 again
  const model = await heldProvider([{ tool: ['bravo__t7', {}] }, { tool: ['find_tools', { names: ['bravo__t7'] }] }, { tool: ['bravo__t7', {}] }, { final: 'All three calls were made.' }]);
  await request.post('/api/providers/custom', { data: { name: 'Deferred model', baseUrl: model.url } });
  const a = await connector('Alpha');
  const b = await connector('Bravo');
  const c = await connector('Charlie');
  for (const [name, x] of [['Alpha', a], ['Bravo', b], ['Charlie', c]]) {
    const added = await (await request.post('/api/mcp', { data: { name, url: x.url } })).json();
    await request.get(`/api/mcp/${added.id}/tools`); // its tools are on file, then the person trusts its read-only labels
    await request.patch(`/api/mcp/${added.id}`, { data: { trustReadOnly: true } });
  }
  await request.put('/api/settings', { data: { defaultPermissionMode: 'auto' } });
  const session = await (await request.post('/api/sessions', { data: { title: 'deferred' } })).json();
  // Auto mode with the connectors' read-only labels trusted: the loaded tool runs without a card (a card would be the same as for any connector tool: tests/pv-tools covers Ask mode)
  await request.patch(`/api/sessions/${session.id}/setting/permissionMode`, { data: { value: 'auto' } });
  const sent = await request.post(`/api/sessions/${session.id}/messages`, { data: { providerId: 'custom-deferred-model', model: 'picture-model', content: 'use the bravo tool number 7' } });
  const streamed = await sent.text();
  expect(sent.status(), streamed.slice(0, 300)).toBe(200);
  const names = (body) => (body.tools ?? []).map((d) => d.function.name);
  const toolSaid = (body) => String(body.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '');
  const [first, second, third, fourth] = model.requests;
  expect(names(first)).toContain('find_tools');
  expect(names(first), 'a deferred tool is not in the request').not.toContain('bravo__t7');
  expect(names(first).length, 'the 90 connector tools are not all sent').toBeLessThan(60);
  expect(toolSaid(second)).toContain("bravo__t7 is not loaded in this reply, so it was not run. Load it first with find_tools(names: ['bravo__t7'])");
  expect(toolSaid(third)).toContain('Loaded for this reply, call them now');
  expect(names(third), 'after loading, the tool is offered in the next request of the same reply').toContain('bravo__t7');
  expect(toolSaid(fourth)).toContain('ran t7');
  const chat = JSON.stringify(await (await request.get(`/api/sessions/${session.id}`)).json());
  expect(chat).toContain('Look for tools');
  await model.close();
  expect(b.calls).toEqual(['t7']); // it ran once, only after it was loaded; the other connectors were never called
  expect(a.calls).toEqual([]);
  expect(c.calls).toEqual([]);
});

test('a helper is sent every tool it may use (not the deferred list), without find_tools, and its calls to a connector tool work', async ({ request }) => {
  test.setTimeout(90_000);
  await resetProfile(request);
  const x = await connector('Alpha');
  const y = await connector('Bravo');
  const z = await connector('Charlie');
  for (const [name, c] of [['Alpha', x], ['Bravo', y], ['Charlie', z]]) {
    const added = await (await request.post('/api/mcp', { data: { name, url: c.url } })).json();
    await request.get(`/api/mcp/${added.id}/tools`);
    await request.patch(`/api/mcp/${added.id}`, { data: { trustReadOnly: true } });
  }
  // the parent starts a helper; the helper (its own request) calls a connector tool; both then answer
  const model = await heldProvider([{ tool: ['run_subagent', { task: 'use the bravo tool number 3', job: 'chat' }] }, { tool: ['bravo__t3', {}] }, { final: 'helper report' }, { final: 'parent done' }]);
  await request.post('/api/providers/custom', { data: { name: 'Deferred model', baseUrl: model.url } });
  const session = await (await request.post('/api/sessions', { data: { title: 'helper list' } })).json();
  await request.patch(`/api/sessions/${session.id}/setting/permissionMode`, { data: { value: 'auto' } });
  const sent = await request.post(`/api/sessions/${session.id}/messages`, { data: { providerId: 'custom-deferred-model', model: 'picture-model', content: 'ask a helper to use the bravo tool' } });
  await sent.text();
  await model.close();
  const names = (body) => (body.tools ?? []).map((d) => d.function.name);
  const [parent, helper] = model.requests;
  expect(names(parent)).toContain('find_tools');
  expect(names(parent)).not.toContain('bravo__t3');
  expect(names(helper), 'the helper has every connector tool it may use').toContain('bravo__t3');
  expect(names(helper), 'and no find_tools').not.toContain('find_tools');
  expect(y.calls, 'the helper called the connector tool').toEqual(['t3']);
});

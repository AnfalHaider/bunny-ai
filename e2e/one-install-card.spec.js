import { test, expect } from '@playwright/test';
import { STANDIN_MCP_PORT, STANDIN_MCP_HOST } from './setup.js';
import { createServer } from 'node:http';
import { resetProfile } from './helpers.js';

// AGENT-FLOW F10: the stand-in model adds a stand-in connector; ONE card, one click, and it uses the connector's tool in the same reply. Light and dark, desktop and phone width. Invented content only.

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
let model; let mcp; let modelPort; let mcpUrl;
test.beforeAll(async () => {
  mcp = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
      const m = JSON.parse(raw || '{}');
      res.writeHead(200, { 'content-type': 'application/json' });
      const result = m.method === 'tools/list' ? { tools: [{ name: 'ping', description: 'Reply with PONG', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] }
        : m.method === 'tools/call' ? { content: [{ type: 'text', text: 'PONG-FROM-STAND-IN' }] }
          : { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'stand-in', version: '1' } };
      if (m.id === undefined) { res.end('{}'); return; }
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    });
  });
  await new Promise((r) => mcp.listen(STANDIN_MCP_PORT, '127.0.0.1', r));
  mcpUrl = `https://${STANDIN_MCP_HOST}/mcp`; // public-looking (IA-0); the server's test transport sends it to the stand-in above
  model = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method !== 'POST' && !req.url.endsWith('/models')) { res.writeHead(200); res.end('ok'); return; }
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
      const body = JSON.parse(raw); const done = body.messages.filter((x) => x.role === 'tool').length;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const ping = (body.tools ?? []).find((t) => /ping/i.test(t.function?.name ?? ''));
      let out;
      if (done === 0) out = call('add_connector', { name: 'Stand-in docs', url: mcpUrl });
      else if (done === 1 && ping) out = call(ping.function.name, {});
      else out = frame({ content: done === 1 ? 'The connector did not load.' : 'Used it: done.' });
      res.end(`${out}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => model.listen(0, '127.0.0.1', r));
  modelPort = model.address().port;
});
test.afterAll(async () => { await new Promise((r) => { model.closeAllConnections?.(); model.close(r); }); await new Promise((r) => { mcp.closeAllConnections?.(); mcp.close(r); }); });

test.beforeEach(async ({ request, page }) => {
  await resetProfile(request);
  for (const s of await (await request.get('/api/mcp')).json()) await request.delete(`/api/mcp/${s.id}`);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  expect((await request.post('/api/providers/custom', { data: { name: 'Scripted', baseUrl: `http://127.0.0.1:${modelPort}/v1` } })).ok()).toBeTruthy();
  page.on('dialog', (d) => d.accept());
});
test.afterEach(async ({ request }) => {
  for (const s of await (await request.get('/api/mcp')).json()) await request.delete(`/api/mcp/${s.id}`);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null } });
});

async function ask(page) {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'chat'); });
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
  await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: 'Auto' }).first().click();
  await page.locator('#input').fill('I need docs lookup'); await page.locator('#send').click();
}

for (const [scheme, width] of [['light', 1100], ['dark', 390]]) {
  test(`one card (${scheme}, ${width}px): Install and switch on, and the same reply uses the connector's tool`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
    await ask(page);
    const card = page.locator('.live-permission');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('h4')).toHaveText('Install and switch on Stand-in docs?');
    await expect(card).toContainText('Adds a connector at'); await expect(card).toContainText(mcpUrl);
    await expect(card.getByRole('button')).toHaveText(['Install and switch on', 'Install, keep off', "Don't install"]);
    if (width <= 400) { // on a phone every button of the card is at least 44 px tall (touch size)
      for (const b of await card.getByRole('button').all()) expect((await b.boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await page.evaluate(() => { window.__later = 0; new MutationObserver((list) => { for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches?.('.live-permission, .capability-card') || n.querySelector?.('.live-permission, .capability-card'))) window.__later += 1; }).observe(document.body, { childList: true, subtree: true }); });
    await card.getByRole('button', { name: 'Install and switch on' }).click();
    await expect(page.locator('#stop')).toBeHidden({ timeout: 30_000 });
    expect(await page.evaluate(() => window.__later), 'no second card after the answer').toBe(0);
    await expect(page.locator('body')).toContainText('PONG-FROM-STAND-IN');
    await expect(page.locator('.msg.assistant .body').last()).toContainText('Used it: done.');
    const list = await (await request.get('/api/mcp')).json();
    expect(list.map((c) => [c.name, c.enabled])).toEqual([['Stand-in docs', true]]);
  });
}

test('Install, keep off: one card, the connector is added but off, and its tool is not used', async ({ page, request }) => {
  await ask(page);
  await page.locator('.live-permission').getByRole('button', { name: 'Install, keep off' }).click({ timeout: 20_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 30_000 });
  const list = await (await request.get('/api/mcp')).json();
  expect(list.map((c) => [c.name, c.enabled])).toEqual([['Stand-in docs', false]]);
  await expect(page.locator('body')).not.toContainText('PONG-FROM-STAND-IN');
});

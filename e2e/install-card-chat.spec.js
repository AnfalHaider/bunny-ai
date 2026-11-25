import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { resetProfile } from './helpers.js';

// F10 / INSTALL-ANYWHERE: the ONE install card in a chat. The scripted model asks to add a connector; the card shows the address, the "can change at any time" line and three buttons; "Install, keep off" adds it off;
// "Don't install" adds nothing. Light 1100 px and dark 390 px (no sideways scroll; the 44 px touch targets are part of the f9-f10 merge). Invented address; nothing is fetched.
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
function script(body) {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/add the notes connector/.test(asked) && tools === 0) return call('add_connector', { name: 'Notes', url: 'https://mcp.example-notes.test/mcp' });
  return frame({ content: 'ok' });
}
let server; let port;
test.setTimeout(75_000);
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
      if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`${script(JSON.parse(raw))}data: [DONE]\n\n`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.afterAll(async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); });
test.beforeEach(async ({ request, page }) => {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  expect((await request.post('/api/providers/custom', { data: { name: 'Scripted', baseUrl: `http://127.0.0.1:${port}/v1` } })).ok()).toBeTruthy();
  page.on('dialog', (d) => d.accept());
});
test.afterEach(async ({ request }) => {
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null } });
  await resetProfile(request);
});

async function open(page) {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'chat'); });
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
}

for (const [scheme, width] of [['light', 1100], ['dark', 390]]) {
  for (const [button, installed] of [['Install, keep off', true], ["Don't install", false]]) {
    test(`the one install card in a chat (${scheme}, ${width}px): ${button}`, async ({ page, request }) => {
      await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
      await open(page);
      await page.locator('#input').fill('add the notes connector'); await page.locator('#send').click();
      const card = page.locator('.live-permission');
      await expect(card).toBeVisible({ timeout: 20_000 });
      await expect(card).toContainText('Install and switch on Notes?');
      await expect(card).toContainText('https://mcp.example-notes.test/mcp');
      await expect(card.getByRole('button', { name: 'Install and switch on' })).toBeVisible();
      await expect(card.getByRole('button', { name: 'Install, keep off' })).toBeVisible();
      await expect(card.getByRole('button', { name: "Don't install" })).toBeVisible();
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over).toBeLessThanOrEqual(1);
      await card.getByRole('button', { name: button, exact: true }).click();
      await expect(page.locator('#stop')).toBeHidden({ timeout: 25_000 });
      const list = await (await request.get('/api/mcp')).json();
      if (installed) expect(list.map((s) => [s.name, s.enabled])).toEqual([['Notes', false]]); else expect(list).toEqual([]);
    });
  }
}

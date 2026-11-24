import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetProfile } from './helpers.js';

// AGENT-FLOW F9: Allow for this chat. Ask mode, three edits in one folder: the first card offers "Allow once", the kind button and "Don't allow", with the tick that shows the exact rule; one click on the kind and the next
// two do not ask, each shows the small chip; the Working folder card lists the kind and Forget removes it. A scripted stand-in model, invented content, light and dark, desktop and phone width.

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
function script(body) {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/write three files/.test(asked) && tools < 3) return call('write_file', { path: `src/a/file${tools + 1}.js`, content: `export const n = ${tools + 1};\n` });
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
});

async function open(page) {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'code'); });
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
}
async function useFolder(page, dir) {
  if (page.viewportSize().width >= 700) await page.locator('#mode-code').click();
  if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click();
  await page.locator('input[aria-label="Folder path"]').fill(dir);
  await page.getByRole('button', { name: 'Use folder' }).click();
  await expect(page.locator('#folder-chip')).toHaveAttribute('title', /Working folder/);
}
const pickMode = async (page, label) => { await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: label }).first().click(); };

for (const [scheme, width] of [['light', 1100], ['dark', 390]]) {
  test(`Allow for this chat (${scheme}, ${width}px): the first edit asks with the kind, one click and the next two do not ask; the chip shows; Forget brings the card back`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
    const dir = mkdtempSync(join(tmpdir(), 'bunny-f9-e2e-')); mkdirSync(join(dir, 'src', 'a'), { recursive: true });
    await open(page); await useFolder(page, dir); await pickMode(page, 'Manual');
    await page.locator('#input').fill('write three files'); await page.locator('#send').click();
    const card = page.locator('.live-permission');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole('button', { name: 'Allow once' })).toBeVisible();
    await expect(card.getByRole('button', { name: "Don't allow" })).toBeVisible();
    const kindButton = card.getByRole('button', { name: /in this chat$/ });
    await expect(kindButton).toContainText('src/a/');
    await expect(card.locator('.kind-tick')).toContainText('Also save as a rule for this folder');
    await expect(card.locator('.kind-tick')).toContainText('Saves exactly: Allow edits to src/a/** in');
    // phone: touch-sized buttons and no sideways scroll
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await kindButton.click();
    await expect(page.locator('#stop')).toBeHidden({ timeout: 25_000 });
    for (const n of [1, 2, 3]) expect(existsSync(join(dir, 'src', 'a', `file${n}.js`))).toBe(true);
    await expect(page.locator('.live-permission')).toHaveCount(0); // the second and third never asked
    await expect(page.locator('.tool-call .tag.is-allowed').first()).toContainText('allowed for this chat');
    // the Working folder card lists it, and Forget removes it
    await page.locator('#folder-chip').click();
    const list = page.locator('#allowed-kinds');
    await expect(list).toContainText('Allowed in this chat'); await expect(list).toContainText('Edits in src/a/');
    await list.getByRole('button', { name: /^Forget Edits in/ }).click();
    await expect(page.locator('#allowed-kinds')).toContainText('Nothing is allowed for this chat');
  });
}

import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetProfile } from './helpers.js';

// OFFICE-MAKE: a Code chat shows the outline card (Manual), Allow writes the file, the Changes pane lists it and Undo removes it; a Chat-mode chat makes a file card with Open, Save as… and (desktop only) Show in folder,
// and the card is still there after a reload. A scripted stand-in model, invented content, both themes, desktop and phone width.

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
function script(body) {
  const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
  const tools = body.messages.filter((m) => m.role === 'tool').length;
  if (/make the report/.test(asked)) return tools === 0 ? call('make_word', { path: 'reports/q3.docx', blocks: [{ type: 'heading', level: 1, text: 'Quarter three' }, { type: 'paragraph', text: 'Invented **numbers**.' }, { type: 'table', rows: [['a', 'b'], ['1', '2']] }] }) : frame({ content: 'Made the report.' });
  if (/make the deck/.test(asked)) return tools === 0 ? call('make_powerpoint', { path: 'Invented deck.pptx', slides: [{ title: 'Hello', bullets: ['one', 'two'] }, { title: 'Bye' }] }) : frame({ content: 'The deck is ready.' });
  return frame({ content: 'ok' });
}
let server; let port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method !== 'POST' && !req.url.endsWith('/models')) { res.writeHead(200); res.end('ok'); return; }
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
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

async function open(page, mode) {
  await page.goto('/');
  await page.evaluate((m) => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', m); }, mode);
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
}
async function useFolder(page, dir) {
  await page.locator('#mode-code').click();
  if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click();
  await page.locator('input[aria-label="Folder path"]').fill(dir);
  await page.getByRole('button', { name: 'Use folder' }).click();
  await expect(page.locator('#folder-chip')).toHaveAttribute('title', /Working folder/);
}
const pickMode = async (page, label) => { await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: label }).first().click(); };

for (const [scheme, width] of [['light', 1100], ['dark', 390]]) {
  test(`Code chat (${scheme}, 1100px): Manual shows the outline, Allow writes the .docx, Changes lists it, Undo removes it`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width: 1100, height: 900 });
    const dir = mkdtempSync(join(tmpdir(), 'bunny-office-e2e-'));
    await open(page, 'code'); await useFolder(page, dir); await pickMode(page, 'Manual');
    await page.locator('#input').fill('make the report'); await page.locator('#send').click();
    const card = page.locator('.live-permission');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Make Word file reports/q3.docx');
    await expect(card).toContainText('Word file reports/q3.docx'); await expect(card).toContainText('3 blocks'); await expect(card).toContainText('Quarter three');
    await expect(card).not.toContainText('"blocks"');
    await card.getByRole('button', { name: 'Allow', exact: true }).click();
    await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
    expect(existsSync(join(dir, 'reports', 'q3.docx'))).toBe(true);
    expect(readFileSync(join(dir, 'reports', 'q3.docx')).subarray(0, 2).toString()).toBe('PK');
    await page.locator('.toolbar [data-view="diff"]').click();
    const pane = page.locator('#diff-content');
    await expect(pane.locator('.checkpoint-card .change-row .path')).toHaveText('reports/q3.docx');
    await pane.getByRole('button', { name: 'Undo to here' }).click();
    await expect(pane.locator('.checkpoint-done')).toHaveText('Undone');
    expect(existsSync(join(dir, 'reports', 'q3.docx'))).toBe(false);
  });

  test(`Chat mode (${scheme}, ${width}px): a file card with Open and Save as, kept after a reload; no outline card, no folder`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
    await open(page, 'chat');
    await page.locator('#input').fill('make the deck'); await page.locator('#send').click();
    const card = page.locator('.made-card');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText('Invented deck.pptx'); await expect(card).toContainText('PowerPoint');
    await expect(card.getByRole('button', { name: /^Open / })).toBeVisible(); await expect(card.getByRole('button', { name: /^Save .* as$/ })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Show / })).toHaveCount(0); // a plain browser has no folder to show
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    const downloadPromise = page.waitForEvent('download');
    await card.getByRole('button', { name: /^Save .* as$/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Invented deck.pptx');
    const chats = await (await page.request.get('/api/sessions')).json();
    await page.goto(`/?s=${chats[0].id}`);
    await expect(page.locator('.made-card')).toBeVisible({ timeout: 15_000 });
  });
}

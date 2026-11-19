import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// CLI-ENGINES: the engine chip in a Code chat's composer row: hidden until an engine is downloaded; a one-line menu before the first message; fixed afterwards. Stand-in engine, nothing real.
test.beforeEach(async ({ request }) => {
  await resetProfile(request).catch(() => {});
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {});
  await request.put('/api/settings', { data: { engine: 'bunny' } }).catch(() => {});
});

test('the engine chip is hidden with no engine downloaded; with one it lists Bunny and the engine, one line each, and the choice sticks for the new chat', async ({ page, request }) => {
  await page.goto('/src/ui/index.html');
  await page.evaluate(() => localStorage.setItem('bunny.workMode', 'code'));
  await page.reload();
  await expect(page.locator('#engine-chip')).toBeHidden();
  await request.post('/api/engines/claude-code/download', { data: {} });
  for (let i = 0; i < 80; i += 1) { const j = await (await request.get('/api/engines')).json(); if (j.engines.find((e) => e.id === 'claude-code').downloaded) break; await page.waitForTimeout(100); }
  await page.reload();
  const chip = page.locator('#engine-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Bunny');
  await chip.click();
  const items = page.locator('#engine-menu button');
  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toContainText('Claude Code · Account');
  await items.nth(1).click();
  await expect(chip).toContainText('Claude Code · Account');
});

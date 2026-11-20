import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// AGENT-FLOW F6: the Brave Search key row in Settings: a password field, no echo, set and remove, and what Brave costs is said plainly.
const KEY = 'BSA-e2e-key-0123456789abcdef';

test('the Brave Search key row: password field, saved without echo, removed; the cost note is shown', async ({ page, request }) => {
  await resetProfile(request);
  await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
  const row = page.locator('#brave-row');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Brave needs a card to sign up');
  await expect(row).toContainText('Bunny sends your searches to Brave when a key is set');
  await expect(page.locator('#brave-state')).toHaveText('No key: DuckDuckGo only.');
  await expect(page.locator('#brave-remove')).toBeHidden();
  const field = page.locator('#brave-key');
  await expect(field).toHaveAttribute('type', 'password');
  await expect(field).toHaveAttribute('autocomplete', 'off');
  // a key that does not look like one is refused, and nothing is saved
  await field.fill('short');
  await page.locator('#brave-save').click();
  await expect(page.locator('#brave-err')).toContainText('does not look like a Brave Search key');
  await expect(page.locator('#brave-state')).toHaveText('No key: DuckDuckGo only.');
  // a good key: saved, the field is emptied, and the key appears nowhere on the page
  await field.fill(KEY);
  await page.locator('#brave-save').click();
  await expect(page.locator('#brave-state')).toHaveText('A key is saved.');
  await expect(field).toHaveValue('');
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(KEY);
  await expect(page.locator('#brave-remove')).toBeVisible();
  // the server says only that a key is set, and never the key
  const status = await request.get('/api/web-search');
  expect(await status.json()).toEqual({ braveKey: true });
  expect(JSON.stringify(await (await request.get('/api/settings')).json())).not.toContain(KEY);
  // it stays after a reload, still without the key
  await page.reload();
  await expect(page.locator('#brave-state')).toHaveText('A key is saved.');
  expect(await page.evaluate(() => document.documentElement.outerHTML)).not.toContain(KEY);
  // removed
  await page.locator('#brave-remove').click();
  await expect(page.locator('#brave-state')).toHaveText('No key: DuckDuckGo only.');
  await expect(page.locator('#brave-remove')).toBeHidden();
  expect(await (await request.get('/api/web-search')).json()).toEqual({ braveKey: false });
});

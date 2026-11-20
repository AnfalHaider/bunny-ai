import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// v0.1.15 small items. The command palette matches chats from the chat list; when the list arrives after the palette was opened and typed into, the palette must redraw.
test('the command palette shows a chat that arrives in the list after it was opened', async ({ page, request }) => {
  await resetProfile(request);
  await request.post('/api/sessions', { data: { title: 'Zebra stripes research' } });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let holding = false;
  await page.route('**/api/sessions?archived=1', async (route) => {
    if (!holding) { holding = true; await gate; } // the first list request is held
    await route.continue();
  });
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('zebra');
  await expect(page.locator('.palette-item .palette-hint', { hasText: /^chat$/ })).toHaveCount(0); // no list yet
  release();
  await expect(page.locator('.palette-item', { hasText: 'Zebra stripes research' })).toBeVisible({ timeout: 8000 });
});

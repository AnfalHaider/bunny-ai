import { test, expect } from '@playwright/test';

import {
  resetProfile, connectAnthropic, pickFirstModel, chat, connectAndChat,
} from './helpers.js';

// The workspace surfaces: the command palette, importing history, and the
// settings that govern which models may be used.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('the command palette opens with Ctrl+K and runs a command', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');

  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-backdrop')).toBeVisible();
  await expect(page.locator('#palette-input')).toBeFocused();

  // Typing narrows the list.
  await page.locator('#palette-input').fill('compact');
  await expect(page.locator('#palette-list .palette-item')).toHaveCount(1);
  await page.locator('#palette-list .palette-item').first().click();
  await expect(page.locator('#palette-backdrop')).toBeHidden();
});

test('the command palette finds a chat by name', async ({ page }) => {
  await connectAndChat(page, 'a chat about penguins');
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('penguins');
  await expect(page.locator('#palette-list .palette-item')).toHaveCount(1);
  await expect(page.locator('#palette-list')).toContainText('penguins');
});

test('a transcript from another tool can be imported', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');

  await page.locator('#import').click();
  await expect(page.locator('#import-backdrop')).toBeVisible();
  await page.locator('#import-text').fill(
    '# Old chat\n\n## You\n\nhello from before\n\n## Assistant\n\nand hello back\n',
  );
  await page.locator('#import-run').click();

  // The imported chat opens, with its transcript intact.
  await page.waitForURL(/s=[0-9a-f-]{36}/);
  await expect(page.locator('.msg.user .body')).toHaveText('hello from before');
  await expect(page.locator('.msg.assistant .body')).toHaveText('and hello back');
});

test('an empty import is refused with a message', async ({ page }) => {
  await page.goto('/');
  await page.locator('#import').click();
  await page.locator('#import-run').click();
  await expect(page.locator('#import-error')).toContainText(/nothing/i);
});

test('the settings screen shows what each provider was used for', async ({ page }) => {
  await connectAndChat(page, 'count this');
  await page.goto('/src/ui/settings.html');

  await expect(page.locator('#usage')).toContainText('anthropic');
  await expect(page.locator('#usage')).toContainText(/tokens/);
});

test('the settings screen saves an allowed-model list', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/src/ui/settings.html');

  await page.locator('#allowlist').fill('offline/bunny-code');
  await page.locator('#save-models').click();
  await expect(page.locator('#save-models')).toHaveText('Saved');

  await page.reload();
  await expect(page.locator('#allowlist')).toHaveValue('offline/bunny-code');

  // The picker now offers only that model.
  await page.goto('/');
  await page.locator('#picker-button').click();
  await expect(page.locator('.picker-panel [role="option"][data-model]:not([data-section])')).toHaveCount(1);
});

test('the settings screen saves a model alias', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/src/ui/settings.html');

  await page.locator('#aliases').fill('fast = offline/bunny-code');
  await page.locator('#save-models').click();
  await expect(page.locator('#save-models')).toHaveText('Saved');

  await page.reload();
  await expect(page.locator('#aliases')).toHaveValue('fast = offline/bunny-code');
});

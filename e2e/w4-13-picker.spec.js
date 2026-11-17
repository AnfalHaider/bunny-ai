import { test, expect } from '@playwright/test';

// W4-13: the model picker shows one row per model with every provider as a tag (Free, Free daily), filters that combine with AND,
// and "N of M models". The models are invented (Falcon Flash, Harbor and so on); /api/models is answered by the test.
const row = (providerId, providerName, id, displayName, freeKind, contextLength = 256000) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength });
const MODELS = [
  row('harbor', 'Harbor', 'falcon-flash', 'Falcon Flash', 'free', 1_000_000),
  row('meadow', 'Meadow', 'falcon-flash', 'Falcon Flash', 'daily', 1_000_000),
  row('quill', 'Quill', 'falcon-flash', 'Falcon Flash', null, 1_000_000),
  row('harbor', 'Harbor', 'otter-3-coder', 'Otter 3 Coder', 'daily'),
  row('meadow', 'Meadow', 'otter-3-coder', 'Otter 3 Coder', 'daily'),
  row('harbor', 'Harbor', 'willow-7b', 'Willow 7B', 'free', 128000),
  row('quill', 'Quill', 'willow-7b', 'Willow 7B', null, 128000),
  row('harbor', 'Harbor', 'birch-large', 'Birch Large', null),
  row('meadow', 'Meadow', 'birch-large', 'Birch Large', null),
  row('meadow', 'Meadow', 'reef-image', 'Reef Image', 'daily', 0),
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/models*', (route) => route.fulfill({ json: MODELS }));
  await page.goto('/');
  await page.locator('#picker-button').click();
});

const models = (page) => page.locator('.picker-panel .picker-model');

test('one row per model, every provider a tag, Free first, then Free daily, then the rest', async ({ page }) => {
  await expect(models(page)).toHaveCount(5);
  const falcon = page.locator('.picker-panel .picker-model', { hasText: 'Falcon Flash' }).first();
  await expect(falcon.locator('.picker-tag')).toHaveText(['HarborFree', 'MeadowFree daily', 'Quill']);
  // the same model on Meadow only: Free daily; a model with no tag at all (unknown or paid) shows only its providers
  await expect(page.locator('.picker-panel .picker-model', { hasText: 'Birch Large' }).first().locator('.picker-free')).toHaveCount(0);
  // Auto is there when nothing is filtered
  await expect(page.locator('.picker-panel .picker-auto')).toBeVisible();
});

test('Filters: Free only, and Provider, combine with AND; the count says how many match; filtering hides Auto', async ({ page }) => {
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: /Free only/ }).click();
  await expect(page.locator('.picker-count')).toHaveText('4 of 5 models'); // Birch Large has no free provider
  await expect(page.locator('.picker-panel .picker-auto')).toHaveCount(0);
  await page.getByRole('button', { name: 'Quill', exact: true }).click();
  // a model must have a provider that fits Provider AND Free together: Quill serves two models, but neither is free there
  await expect(page.locator('.picker-panel .picker-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Quill', exact: true }).click();
  await page.getByRole('button', { name: 'Meadow', exact: true }).click();
  await expect(page.locator('.picker-count')).toHaveText('3 of 5 models'); // Falcon, Otter, Reef: free on Meadow
  await expect(page.getByRole('button', { name: /Filters · 2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.picker-count')).toBeHidden();
  await expect(models(page)).toHaveCount(5);
});

test('choosing a model uses its first provider (the order Bunny tries them)', async ({ page }) => {
  await page.locator('.picker-panel .picker-model', { hasText: 'Falcon Flash' }).first().click();
  await expect(page.locator('#picker-button')).toContainText('falcon-flash');
  await expect(page.locator('#picker-button')).toContainText('Harbor');
});

test('no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: 'Filters' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

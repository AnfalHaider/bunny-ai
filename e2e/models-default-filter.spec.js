import { test, expect } from '@playwright/test';
import { resetProfile, connectAnthropic } from './helpers.js';

// W0-4: on a fresh profile (the default "Show models" setting) a person who connects Anthropic with a key must not be told
// "No models available". Every other e2e test sets modelFilter 'all', so this one runs on the default.
test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  await request.put('/api/settings', { data: { modelFilter: 'free-nvidia', providerId: '', model: '' } });
});
test.afterAll(async ({ request }) => {
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
});

test('default filter: connected Anthropic models are hidden but never "No models available", and one click shows them', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');
  // The picker button says models are hidden, not that there are none.
  await expect(page.locator('#picker-button')).toContainText(/models? (is|are) hidden/);
  await expect(page.locator('#picker-button')).not.toContainText('No models available');
  // The empty state offers "Show all models", and "Add a provider" is not shown: a provider is connected.
  await expect(page.getByRole('button', { name: 'Show all models' })).toBeVisible();
  await expect(page.getByText('Add a provider')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all models' }).click();
  await expect(page.locator('#picker-button')).not.toContainText(/hidden|No models/);
  await page.locator('#picker-button').click();
  await expect(page.locator('.picker-panel [role="option"][data-model]:not([data-section])')).toHaveCount(3);
  // The setting stuck.
  expect((await (await page.request.get('/api/settings')).json()).modelFilter).toBe('all');
});

test('default filter: with no provider connected the empty state still says "Add a provider"', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Add a provider' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show all models' })).toHaveCount(0);
});

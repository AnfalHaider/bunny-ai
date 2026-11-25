import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) {
    await request.delete(`/api/providers/${p.id}`);
  }
});

test('the providers page lists ModelScope, SiliconFlow and Gitee AI with a link to get a key', async ({ page }) => {
  await page.goto('/src/ui/providers.html');
  for (const name of ['ModelScope', 'SiliconFlow', 'Gitee AI', 'DeepSeek']) {
    const row = page.locator('#available .row', { hasText: name }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: 'Get a key' })).toBeVisible();
  }
});

test('a custom provider is added from the form, shows as Custom, and can be removed', async ({ page }) => {
  await page.goto('/src/ui/providers.html');
  await page.fill('#custom-name', 'Team gateway');
  await page.fill('#custom-url', 'https://llm.example.com/v1');
  await page.fill('#custom-key', 'sk-team-1234567890');
  await page.click('#custom-add');
  const row = page.locator('#connected .row', { hasText: 'Team gateway' });
  await expect(row).toBeVisible();
  await expect(row.locator('.tag', { hasText: 'Custom' })).toBeVisible();
  await expect(page.locator('#custom-name')).toHaveValue('');

  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Remove Team gateway' }).click();
  await expect(page.locator('#connected .row', { hasText: 'Team gateway' })).toHaveCount(0);
  await expect(page.locator('#available .row', { hasText: 'Team gateway' })).toHaveCount(0);
});

test('Settings offers GitHub sign-in and explains what Google sign-in needs', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  const github = page.locator('#github-row');
  await expect(github.getByRole('button', { name: 'Use GitHub CLI sign-in' })).toBeVisible();
  await github.getByRole('button', { name: 'Paste a token' }).click();
  await page.fill('#github-token', 'not-a-token');
  await page.click('#github-token-save');
  await expect(page.locator('#github-err')).toContainText('does not look like a GitHub token');

  const google = page.locator('#google-row');
  await expect(google.getByRole('button', { name: 'Sign in with Google' })).toBeDisabled();
  await expect(page.locator('#google-desc')).toContainText('Google sign-in is switched off because Bunny AI has no Google client ID yet');
  await page.locator('.account-apps summary').click();
  await page.fill('#google-client-id', 'test.apps.googleusercontent.com');
  await page.locator('#google-client-id').dispatchEvent('change');
  await expect(google.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
  // Put it back: the profile is shared by the whole run.
  await page.fill('#google-client-id', '');
  await page.locator('#google-client-id').dispatchEvent('change');
});

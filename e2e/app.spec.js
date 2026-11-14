import { test, expect } from '@playwright/test';

import { resetProfile, connectAnthropic } from './helpers.js';

// One spec per user-visible promise. The whole run shares one server (and so
// one profile), which BUNNY_RESET_PROFILE=1 only empties at boot. Tests that
// connect a provider would then leak into every later test, so each test puts
// the profile back to empty first. Doing it through the same public API a
// person uses keeps the tests honest: no hidden test-only backdoor.
test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('the chat screen loads under the Bunny AI name', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Bunny AI');
  await expect(page.locator('.brand')).toContainText('Bunny AI');
  await expect(page.getByRole('heading', { name: 'Start a conversation' })).toBeVisible();
});

test('an empty profile says how to get a model', async ({ page }) => {
  await page.goto('/');
  // With nothing connected the composer must explain itself rather than fail silently.
  await expect(page.locator('#empty-text')).toContainText(/provider/i);
  await expect(page.locator('#picker-button')).toContainText(/no models/i);
});

test('every provider from the picker screen is listed', async ({ page }) => {
  await page.goto('/src/ui/providers.html');
  for (const name of [
    'Nvidia', 'OpenCode Go', 'OpenCode Console', 'Anthropic', 'GitHub Copilot',
    'OpenAI', 'Google', 'OpenRouter', 'Vercel AI Gateway', 'Ollama',
  ]) {
    await expect(page.locator('#available')).toContainText(name);
  }
});

test('every connect button has its own name', async ({ page }) => {
  await page.goto('/src/ui/providers.html');
  await page.waitForSelector('#available .row');
  // Ten buttons all reading "＋ Connect" are indistinguishable to a screen
  // reader. Object.assign never reflects aria-* onto the DOM, so this is a
  // regression guard for that class of bug.
  const names = await page.getByRole('button', { name: /^(Connect |Sign in with )/ }).evaluateAll(
    (nodes) => nodes.map((n) => n.getAttribute('aria-label')),
  );
  expect(names.length).toBeGreaterThanOrEqual(9);
  expect(new Set(names).size).toBe(names.length);
  expect(names.every((n) => n && (n.startsWith('Connect ') || n.startsWith('Sign in with ')))).toBe(true);
});

test('settings reports test mode is on', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await expect(page.locator('#fake-mode')).toHaveText('on');
});

test('theme choice survives a reload', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.reload();
  await expect(page.locator('#theme')).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.locator('#theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('connect, pick a model, chat, and reload into the same thread', async ({ page }) => {
  // 1. Connect a provider. Test mode answers the probe offline, so this needs no key.
  await page.goto('/src/ui/providers.html');
  await page.waitForSelector('#available .row');
  await page.getByRole('button', { name: 'Connect Anthropic' }).click();
  await expect(page.locator('#f-anthropic-apiKey')).toBeVisible();
  await page.locator('#f-anthropic-apiKey').fill('sk-test-000000000000');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('#connected')).toContainText('Anthropic');

  // 2. The chat screen now offers that provider's models.
  await page.goto('/');
  await page.locator('#picker-button').click();
  const option = page.locator('.picker-panel [role="option"]').first();
  await expect(option).toBeVisible();
  const modelId = await option.getAttribute('data-model');
  await option.click();

  // 3. Send a message and see the reply stream in.
  await page.locator('#input').fill('Say hello in five words.');
  await page.locator('#send').click();
  await expect(page.locator('.msg.user .body')).toHaveText('Say hello in five words.');
  await expect(page.locator('.msg.assistant .body')).not.toHaveText('…', { timeout: 15_000 });
  // Wait for the stream to finish, not just to start: #stop is only visible while
  // tokens are still arriving, and the reply is saved server-side when it ends.
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  const reply = await page.locator('.msg.assistant .body').textContent();
  expect(reply?.trim().length ?? 0).toBeGreaterThan(0);

  // 4. It was saved, named, and is restored after a reload.
  await page.reload();
  await expect(page.locator('.msg.user .body')).toHaveText('Say hello in five words.');
  await expect(page.locator('.msg.assistant .body')).toHaveText(reply ?? '');
  await expect(page.locator('#sessions a')).toHaveCount(1);
  await expect(page.locator('#picker-button')).not.toContainText(/no models/i);
  expect(modelId).toBeTruthy();
});

test('the picker filters models by search', async ({ page }) => {
  await page.goto('/src/ui/providers.html');
  await page.waitForSelector('#available .row');
  await page.getByRole('button', { name: 'Connect Anthropic' }).click();
  await expect(page.locator('#f-anthropic-apiKey')).toBeVisible();
  await page.locator('#f-anthropic-apiKey').fill('sk-test-000000000000');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('#connected')).toContainText('Anthropic');

  await page.goto('/');
  await page.locator('#picker-button').click();
  await expect(page.locator('.picker-panel [role="option"]')).toHaveCount(3);

  await page.getByRole('searchbox', { name: 'Search models' }).fill('code');
  await expect(page.locator('.picker-panel [role="option"]')).toHaveCount(1);
  await expect(page.locator('.picker-panel [role="option"]').first()).toHaveAttribute('data-model', /code/);

  await page.getByRole('searchbox', { name: 'Search models' }).fill('zzz');
  await expect(page.locator('.picker-empty')).toHaveText('No models match.');
});

test('Enter sends and Shift+Enter adds a line', async ({ page }) => {
  await page.goto('/src/ui/providers.html');
  await page.waitForSelector('#available .row');
  await page.getByRole('button', { name: 'Connect Anthropic' }).click();
  await expect(page.locator('#f-anthropic-apiKey')).toBeVisible();
  await page.locator('#f-anthropic-apiKey').fill('sk-test-000000000000');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('#connected')).toContainText('Anthropic');

  await page.goto('/');
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel [role="option"]').first().click();

  const input = page.locator('#input');
  await input.fill('first');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('first\n');

  await input.fill('send me');
  await input.press('Enter');
  await expect(page.locator('.msg.user .body')).toHaveText('send me');
});

test('a phone-width window does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ['/', '/src/ui/providers.html', '/src/ui/settings.html']) {
    await page.goto(path);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect.soft(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
  }
});

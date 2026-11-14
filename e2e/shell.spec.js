import { test, expect } from '@playwright/test';

import {
  resetProfile, connectAnthropic, pickFirstModel, chat, connectAndChat,
} from './helpers.js';

// The shell: languages, alerts, windows, and the installable app.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('the interface can speak another language', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#language').selectOption('es');
  await expect(page.locator('#language')).toHaveValue('es');

  await page.goto('/');
  await expect(page.locator('#new-chat')).toHaveText('Nuevo chat');
  await expect(page.locator('#send')).toHaveText('Enviar');
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
});

test('a language that is written right to left is marked as such', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#language').selectOption('ar');
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('#new-chat')).toHaveText('محادثة جديدة');
});

test('the language choice survives a reload', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#language').selectOption('fr');
  await page.goto('/');
  await page.reload();
  await expect(page.locator('#new-chat')).toHaveText('Nouvelle conversation');
});

test('notifications can be switched on', async ({ page }) => {
  await page.context().grantPermissions(['notifications']);
  await page.goto('/src/ui/settings.html');
  await page.locator('#notifications').check();
  await expect(page.locator('#notifications-state')).toHaveText('on');

  await page.reload();
  await expect(page.locator('#notifications')).toBeChecked();
});

test('a chat can be opened in its own window', async ({ page, context }) => {
  await connectAndChat(page, 'a chat worth a window of its own');
  const popupPromise = context.waitForEvent('page');
  await page.locator('#popout').click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.locator('.msg.user .body')).toHaveText('a chat worth a window of its own');
});

test('the app can be installed as a desktop app', async ({ page }) => {
  const manifest = await page.request.get('/src/ui/manifest.webmanifest');
  expect(manifest.status()).toBe(200);
  const body = await manifest.json();
  expect(body.name).toBe('Bunny AI');
  expect(body.display).toBe('standalone');
  expect(body.start_url).toBeTruthy();

  // The icon and the service worker are there too.
  expect((await page.request.get('/src/ui/icon.svg')).status()).toBe(200);
  expect((await page.request.get('/src/ui/sw.js')).status()).toBe(200);
});

test('an artifact shows a thumbnail and can be printed', async ({ page, context }) => {
  await connectAndChat(page, 'make me something to keep');
  await page.locator('.msg.assistant .msg-actions button[data-act="artifact"]').last().click();
  await expect(page.locator('#artifact-view')).toBeVisible();

  // Back to the list: it shows what the artifact is, before it is opened.
  await page.getByRole('button', { name: 'All artifacts' }).click();
  await expect(page.locator('#artifact-list')).toBeVisible();
  await expect(page.locator('#artifact-list .artifact-thumb')).toHaveCount(1);
  await expect(page.locator('#artifact-list .artifact-preview')).not.toHaveText('');
  await page.locator('#artifact-list .artifact-row').first().click();

  // Printing opens the artifact on its own, so the page prints the document.
  const popupPromise = context.waitForEvent('page');
  await page.locator('#artifact-view').getByRole('button', { name: 'Print' }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');
  await expect(popup.locator('body')).toContainText('This is a local test reply');
});

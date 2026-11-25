import { test, expect } from '@playwright/test';

import {
  resetProfile, connectAnthropic, pickFirstModel, chat, connectAndChat,
} from './helpers.js';

// The shell: languages, alerts, windows, and the installable app.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

// ENGLISH ONLY (owner, 2026-11-24): there is no Language picker, and an old saved language other than English shows English.
test('Settings has no Language section or picker', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await expect(page.locator('#language')).toHaveCount(0);
  await expect(page.locator('[data-section="language"]')).toHaveCount(0);
});

for (const old of ['es', 'fr', 'ar']) {
  test(`an old saved language (${old}) shows no non-English text and no right-to-left layout`, async ({ page, request }) => {
    const put = await request.put('/api/settings', { data: { language: old } });
    expect((await put.json()).language).toBe('en'); // the server turns it back to English
    await page.goto('/');
    await expect(page.locator('#new-chat')).toHaveText('New chat');
    await expect(page.locator('#send')).toHaveText('Send');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await page.goto('/src/ui/settings.html');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await page.locator('body').innerText()).not.toMatch(/Nuevo chat|Enviar|Nouvelle conversation|محادثة/);
  });
}

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

  // SB-2: printing draws the artifact in a hidden SANDBOXED frame of its own (no popup of Bunny's origin), so the page prints the document and nothing runs as Bunny.
  const pagesBefore = context.pages().length;
  await page.locator('#artifact-view').getByRole('button', { name: 'Print' }).click();
  const printFrame = page.locator('iframe[sandbox="allow-scripts allow-modals"]');
  await expect(printFrame).toHaveCount(1);
  await expect(printFrame).toHaveAttribute('srcdoc', /This is a local test reply/);
  expect(await printFrame.getAttribute('sandbox')).not.toMatch(/same-origin/);
  expect(context.pages().length).toBe(pagesBefore); // no popup opened
});

// Google, the honest note (owner, 2026-11-24): with no Google client ID the button is off, the reason is said plainly, and the steps to turn it on are on the page.
test('Google sign-in without a client ID: the button is off, the reason is plain, and "How to connect Google" shows the steps', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await expect(page.locator('#google-desc')).toContainText('no Google client ID yet');
  await expect(page.locator('#google-actions button')).toBeDisabled();
  await expect(page.locator('#google-howto')).toBeVisible();
  await expect(page.locator('#google-howto li')).toHaveCount(4);
});

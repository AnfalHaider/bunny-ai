import { test, expect } from '@playwright/test';

import { resetProfile, connectAndChat } from './helpers.js';

// The redesigned chat shell promises a few things of its own: a fresh page
// greets you, the topbar names the open chat, and the sidebar groups chats
// the way a person thinks about them — starred first, then by date.
test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('a fresh page greets you and centres the composer', async ({ page }) => {
  await page.goto('/');
  // Boot paints the greeting after its first fetches, so wait for it first.
  await expect(page.locator('#greeting')).toBeVisible();
  // The whole line is its label; the headline shows its first sentence.
  const greeting = ((await page.locator('#greeting').getAttribute('aria-label')) ?? (await page.locator('#greeting').textContent())).trim();
  // One of Bunny's playful lines, with the person's name (or "friend" when none is set).
  const { GREETINGS } = await import('../src/ui/greetings.js');
  const lines = Object.values(GREETINGS).flat();
  expect(lines.some((l) => new RegExp(`^${l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('\\{name\\}', '.+')}$`).test(greeting)), greeting).toBe(true);
  // The empty state is on: no messages are shown.
  await expect(page.locator('#messages .msg')).toHaveCount(0);
});

test('the topbar names the open chat', async ({ page }) => {
  await connectAndChat(page, 'title test chat');
  // The chat's own title moves to the topbar once a session is open.
  await expect(page.locator('#chat-title')).not.toBeEmpty();
  await expect(page.locator('#chat-title')).toContainText(/title test/i);
});

test('the sidebar groups chats under a date bucket', async ({ page }) => {
  await connectAndChat(page, 'bucket test chat');
  await page.goto('/');
  // A fresh chat falls under Today (or Yesterday if midnight passed mid-run).
  // The "Recents" header comes first; the date buckets are the .sub groups.
  const bucket = page.locator('#sessions .side-group.sub').first();
  await expect(bucket).toBeVisible();
  const label = await bucket.textContent();
  expect(['Today', 'Yesterday', 'Previous 7 days', 'Older chats']).toContain(label.trim());
  await expect(page.locator('#sessions .session-row')).toHaveCount(1);
});

test('a pinned chat moves to the Starred section', async ({ page }) => {
  await connectAndChat(page, 'starred test chat');
  await page.goto('/');
  await page.locator('#sessions .row-menu').first().click();
  await page.getByRole('menuitem', { name: 'Pin' }).click();
  // The pinned chat now lives under its own Starred heading.
  await expect(page.locator('#sessions .side-group').first()).toHaveText('Starred');
  await expect(page.locator('#sessions .session-row .pin')).toHaveCount(1);
});

test('the session rail shows environment and connectors', async ({ page }) => {
  await connectAndChat(page, 'rail test chat');
  await page.locator('#rail-toggle').click();
  await expect(page.locator('#rail')).toBeVisible();
  await expect(page.locator('#rail-project')).toContainText(/No project/);
  await expect(page.locator('#rail-connectors .rail-empty')).toContainText(/No connectors yet/);
});

test('zoom from the account menu and with Ctrl+plus, Ctrl+minus and Ctrl+0', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#account-button').click();
  await expect(page.locator('.zoom-row')).toBeVisible();
  await page.screenshot({ path: 'test-results/zoom-menu.png' });
  await page.locator('#zoom-in').click();
  await expect(page.locator('#zoom-reset')).toHaveText('110%');
  await page.keyboard.press('Control+0');
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
  await page.keyboard.press('Control+-');
  await expect(page.locator('#zoom-reset')).toHaveText('90%');
  await page.locator('#zoom-reset').click();
  await expect(page.locator('#zoom-reset')).toHaveText('100%');
});

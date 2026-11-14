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
  const greeting = (await page.locator('#greeting').textContent()).trim();
  expect(['Good morning', 'Good afternoon', 'Good evening']).toContain(greeting);
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

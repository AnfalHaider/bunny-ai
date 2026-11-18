import { test, expect } from '@playwright/test';

import { resetProfile } from './helpers.js';

// CHAT-SWITCH (v0.1.13): opening a chat is done in the same page. A window marker survives every switch (a reload would lose it), Back and Forward move between the chats, a modifier
// click still opens a real new page, and the state of the chat that was opened (branch chip, highlighted row, project filter) is the state of that chat.
test.beforeEach(async ({ request }) => { await resetProfile(request); });

async function twoProjects(request) {
  const one = await (await request.post('/api/projects', { data: { name: 'Project One' } })).json();
  const two = await (await request.post('/api/projects', { data: { name: 'Project Two' } })).json();
  const a = await (await request.post('/api/sessions', { data: { title: 'Alpha chat', projectId: one.id } })).json();
  const b = await (await request.post('/api/sessions', { data: { title: 'Beta chat', projectId: two.id } })).json();
  await request.patch(`/api/sessions/${a.id}`, { data: { branch: 'bunny/alpha-branch' } });
  await request.patch(`/api/sessions/${b.id}`, { data: { branch: 'bunny/beta-branch' } });
  return { one, two, a, b };
}
const row = (page, title) => page.locator('#sessions .session-link', { hasText: title });
const mark = (page) => page.evaluate(() => window.__samePage ?? null);

test('switching between chats of two projects keeps the same page and shows the right state for each', async ({ page, request }) => {
  const { a, b } = await twoProjects(request);
  await page.addInitScript(() => localStorage.setItem('bunny.workMode', 'code'));
  await page.goto('/');
  await expect(row(page, 'Alpha chat')).toBeVisible();
  await page.evaluate(() => { window.__samePage = 'still here'; });

  await row(page, 'Alpha chat').click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${a.id}$`));
  await expect(row(page, 'Alpha chat')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#branch-text')).toContainText('bunny/alpha-branch');
  expect(await mark(page), 'the page was not reloaded').toBe('still here');

  await row(page, 'Beta chat').click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${b.id}$`));
  await expect(row(page, 'Beta chat')).toHaveAttribute('aria-current', 'page');
  await expect(row(page, 'Alpha chat')).not.toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#branch-text')).toContainText('bunny/beta-branch');
  expect(await mark(page)).toBe('still here');
});

test('Back and Forward move between the chats without reloading', async ({ page, request }) => {
  const { a, b } = await twoProjects(request);
  await page.addInitScript(() => localStorage.setItem('bunny.workMode', 'code'));
  await page.goto('/');
  await page.evaluate(() => { window.__samePage = 'still here'; });
  await row(page, 'Alpha chat').click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${a.id}$`));
  await row(page, 'Beta chat').click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${b.id}$`));
  await expect(page.locator('#branch-text')).toContainText('bunny/beta-branch');

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`\\?s=${a.id}$`));
  await expect(row(page, 'Alpha chat')).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#branch-text')).toContainText('bunny/alpha-branch');
  expect(await mark(page), 'Back did not reload the page').toBe('still here');

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`\\?s=${b.id}$`));
  await expect(page.locator('#branch-text')).toContainText('bunny/beta-branch');
  expect(await mark(page), 'Forward did not reload the page').toBe('still here');

  await page.goBack();
  await page.goBack(); // back to the page with no chat open
  await expect(page).not.toHaveURL(/\?s=/);
  expect(await mark(page)).toBe('still here');
});

test('a Ctrl click on a chat still opens a real new page, and the page it was clicked in stays on its chat', async ({ page, request, context }) => {
  const { a, b } = await twoProjects(request);
  await page.goto('/');
  await row(page, 'Alpha chat').click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${a.id}$`));
  await page.evaluate(() => { window.__samePage = 'first page'; });
  const [fresh] = await Promise.all([context.waitForEvent('page'), row(page, 'Beta chat').click({ modifiers: ['Control'] })]);
  await fresh.waitForLoadState();
  await expect(fresh).toHaveURL(new RegExp(`\\?s=${b.id}$`));
  expect(await fresh.evaluate(() => window.__samePage ?? null), 'a real new page has no marker').toBeNull();
  expect(await mark(page)).toBe('first page');
  await expect(page).toHaveURL(new RegExp(`\\?s=${a.id}$`));
  await fresh.close();
});

test('the project filter follows a chat opened from another project (the command palette)', async ({ page, request }) => {
  const { one, a, b } = await twoProjects(request);
  await page.goto('/');
  await page.evaluate(() => { window.__samePage = 'still here'; });
  await page.locator('#project-filter').selectOption(one.id);
  await row(page, 'Alpha chat').click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${a.id}$`));
  await expect(row(page, 'Beta chat')).toHaveCount(0); // the filter hides the other project's chats
  await page.keyboard.press('Control+k');
  await page.locator('#palette-input').fill('Beta chat');
  await page.locator('.palette-item', { hasText: 'Beta chat' }).first().click();
  await expect(page).toHaveURL(new RegExp(`\\?s=${b.id}$`));
  await expect(row(page, 'Beta chat')).toHaveAttribute('aria-current', 'page'); // it is shown: the filter moved to its project
  expect(await page.locator('#project-filter').inputValue()).not.toBe(one.id);
  expect(await mark(page)).toBe('still here');
});

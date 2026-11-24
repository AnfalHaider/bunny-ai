import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// SETTINGS-OVERHAUL (v0.1.15): one saving style with a "Saved" mark, clear errors, a help line on every setting, Code chats with headings.
test.beforeEach(async ({ request }) => { await resetProfile(request); });

test('every setting row has a help line beside its name', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  const missing = await page.evaluate(() => [...document.querySelectorAll('.row .meta-col')].filter((c) => c.querySelector('.name') && !c.querySelector('.desc')).map((c) => c.querySelector('.name').textContent.trim()));
  expect(missing).toEqual([]);
});

test('Models: no Save button; an alias line without " = " saves nothing and says why; a good one saves with a Saved mark', async ({ page, request }) => {
  await page.goto('/src/ui/settings.html');
  await expect(page.locator('#save-models')).toHaveCount(0);
  await page.locator('#aliases').fill('fast = gpt-4o-mini\nqa-aliases');
  await page.locator('#aliases').blur();
  await expect(page.locator('#aliases-err')).toHaveText('Not saved: line 2 has no " = ". Write it as name = model.');
  expect(((await (await request.get('/api/settings')).json()).aliases ?? {})).toEqual({});
  await page.locator('#aliases').fill('fast = gpt-4o-mini');
  await page.locator('#aliases').blur();
  await expect(page.locator('#aliases-err')).toHaveText('');
  await expect.poll(async () => (await (await request.get('/api/settings')).json()).aliases).toEqual({ fast: 'gpt-4o-mini' });
  await expect(page.locator('#aliases').locator('xpath=ancestor::div[contains(@class,"right")]').locator('.sv')).toHaveText('Saved');
});

test('Models: an allowed-models list with no model I know is refused, nothing is saved', async ({ page, request }) => {
  await page.route('**/api/models', (route) => route.fulfill({ json: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] })); // a stand-in list of models
  await page.goto('/src/ui/settings.html');
  await page.locator('#allowlist').fill('gpt-4o-minni');
  await page.locator('#allowlist').blur();
  await expect(page.locator('#allowlist-err')).toContainText('is not a model I know');
  await expect(page.locator('#allowlist-err')).toContainText('Did you mean gpt-4o-mini?');
  expect((await (await request.get('/api/settings')).json()).allowlist ?? []).toEqual([]);
});

test('Code chats has its own headings, and a switch shows a Saved mark', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  await expect(page.locator('[data-section="code"] h2').first()).toHaveText('Code chats');
  await expect(page.locator('[data-section="code"] .grp-head')).toHaveText(['Effort and branches', 'Long jobs', 'Helpers', 'After a reply', 'New tasks']);
  const toggle = page.locator('[data-section="code"] input[type="checkbox"]').first();
  await toggle.click();
  await expect(toggle.locator('xpath=ancestor::div[contains(@class,"right")]').locator('.sv')).toHaveText('Saved');
});

// Quick ask has one home (v0.1.15 drawing): on/off and shortcut (desktop), searching by itself, and why it may be dimmed.
test('Quick ask is one section: "searches by itself" is there and not under Capabilities; the dimmed row says why', async ({ page, request }) => {
  await request.put('/api/settings', { data: { pcSearchEnabled: false } });
  await page.goto('/src/ui/settings.html?embed=1&section=quickask');
  await expect(page.locator('[data-section="quickask"] #pc-bar-auto')).toHaveCount(1);
  await expect(page.locator('[data-section="capabilities"] #pc-bar-auto')).toHaveCount(0);
  await expect(page.locator('#pc-bar-why')).toContainText('Search this PC is off');
  await expect(page.locator('#quickask-browser-note')).toBeVisible(); // a browser tab: the on/off switch and shortcut are the desktop window's
});

test('Permissions is its own section (mode and rules); Code chats no longer holds them', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=permissions');
  await expect(page.locator('[data-section="permissions"] #default-permission')).toHaveCount(1);
  await expect(page.locator('[data-section="permissions"] #perm-rules')).toBeVisible();
  await expect(page.locator('[data-section="code"] #perm-rules')).toHaveCount(0);
  await expect(page.locator('[data-section="code"] #default-permission')).toHaveCount(0);
});

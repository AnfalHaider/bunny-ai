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
  await expect(page.locator('[data-section="code"] .grp-head')).toHaveText(['Branches', 'Long jobs', 'Helpers', 'After a reply', 'New tasks']);
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

test('merged sections: Notifications in Appearance, Connection and Default effort in Models, Privacy in Usage and data; the old sections are gone', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  for (const gone of ['notifications', 'privacy', 'connection']) await expect(page.locator(`section[data-section="${gone}"]`)).toHaveCount(0);
  await expect(page.locator('section[data-section="appearance"] #notifications')).toHaveCount(1);
  await expect(page.locator('section[data-section="models"] #cur-provider')).toHaveCount(1);
  await expect(page.locator('section[data-section="models"] #default-effort')).toHaveCount(1);
  await expect(page.locator('section[data-section="usage"] #storage')).toHaveCount(1);
  await expect(page.locator('section[data-section="usage"] h2').first()).toHaveText('Usage and data');
  await page.goto('/');
  await expect(page.locator('#settings-nav-list [data-section="notifications"], #settings-nav-list [data-section="privacy"], #settings-nav-list [data-section="connection"]')).toHaveCount(0);
});

test('Appearance: "Code" is no longer a heading here; the group is "Code blocks"', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=appearance');
  await expect(page.locator('#code-look')).toHaveText('Code blocks');
});

test('the rule form: each of its four fields has its own help line, and every control that has a name has help', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=permissions');
  for (const [id, help] of [['rules-folder', 'rules-help-folder'], ['rules-kind', 'rules-help-kind'], ['rules-pattern', 'rules-help-pattern'], ['rules-effect', 'rules-help-effect']]) {
    await expect(page.locator('#' + id)).toHaveAttribute('aria-describedby', help);
    await expect(page.locator('#' + help)).toBeVisible();
  }
  await expect(page.locator('#rules-notes')).toHaveCount(1);
});

for (const [scheme, width] of [['light', 360], ['dark', 390]]) {
  test(`Sign-in apps inputs fit a phone (${width} px, ${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/src/ui/settings.html?embed=1&section=profile');
    await page.locator('.account-apps summary').click();
    const over = await page.evaluate((w) => ['github-client-id', 'google-client-id', 'google-client-secret'].map((id) => { const r = document.getElementById(id).getBoundingClientRect(); return r.right > w || r.left < 0 ? id : null; }).filter(Boolean), width);
    expect(over).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
}

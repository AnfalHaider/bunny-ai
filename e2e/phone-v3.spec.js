import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// v0.1.14 PHONE-LAYOUT, Design's drawing "phone layout v3" (the owner approved it): the chat top bar is  ☰ · title · chip · ⋯  under 900 px, with the rest in the ⋯ menu (a bottom sheet under 480 px,
// a small menu from 480 to 899 px); Settings is a list page under 640 px and two panes from 640 to 899 px. From 900 px nothing changes. BUNNY_SHOTS_DIR also writes pictures.
const SHOTS = process.env.BUNNY_SHOTS_DIR;
const MODELS = [{ providerId: 'quill', providerName: 'Quill', id: 'otter', displayName: 'Otter 3 Coder', freeKind: null, free: false, contextLength: 128000 }];
const PIXEL = { id: 'a1a1a1a1a1a1a1a1', label: 'Pixel 8', ip: '192.168.1.40', signedInAt: '2026-11-19T09:02:00.000Z', lastSeen: '2026-11-19T09:20:00.000Z', level: 'chats', asked: true };

test.beforeEach(async ({ request }) => { await resetProfile(request); await request.put('/api/settings', { data: { modelFilter: 'all' } }); });

async function load(page, w, h, { chip = false } = {}) {
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript(() => { localStorage.setItem('bunny.workMode', 'chat'); });
  await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
  if (chip) {
    await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { enabled: true, url: 'http://192.168.1.24:52814', signedIn: 1, autoChats: [], devices: [PIXEL], anyEverything: false, hasPasscode: true } }) : r.continue()));
    await page.route('**/api/remote/log', (r) => r.fulfill({ json: { entries: [] } }));
    await page.addInitScript(() => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; });
  }
  await page.goto('/');
  await expect(page.locator('#send')).toBeVisible();
  if (chip) await expect(page.locator('#remote-chip')).toBeVisible();
  await page.waitForTimeout(200);
}
const box = (page, sel) => page.locator(sel).first().evaluate((e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; });
const shot = async (page, name) => { if (SHOTS) await page.waitForTimeout(450); if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

for (const w of [360, 390, 412]) {
  test(`${w} px: the bar is ☰ · title · chip · ⋯ (with the overview from 390), all on the screen, and ⋯ opens a bottom sheet of 44 px rows`, async ({ page }) => {
    await load(page, w, 740, { chip: true });
    await page.locator('#new-chat').click({ force: true }).catch(() => {});
    const vis = async (sel) => (await page.locator(sel).first().isVisible());
    expect(await vis('#sidebar-toggle')).toBe(true);
    expect(await vis('#remote-chip')).toBe(true);
    expect(await vis('#more-button')).toBe(true);
    for (const sel of ['#export', '.toolbar [data-view="terminal"]', '.toolbar [data-view="diff"]', '.toolbar [data-view="browser"]', '.toolbar [data-view="file"]', '.toolbar [data-view="tasks"]', '#popout']) expect(await vis(sel), sel + ' is in the sheet, not on the bar').toBe(false);
    expect(await vis('#rail-toggle'), 'the overview stays from 390').toBe(w >= 390);
    await page.evaluate(() => { document.querySelector('#chat-title').textContent = 'Fix the failing sync test with a long name that must shorten'; });
    const title = await box(page, '#chat-title');
    expect(title.width, 'the title has room').toBeGreaterThan(60);
    for (const sel of ['#sidebar-toggle', '#chat-title', '#remote-chip', '#more-button']) { const b = await box(page, sel); expect(b.right, sel).toBeLessThanOrEqual(w + 0.5); expect(b.left, sel).toBeGreaterThanOrEqual(-0.5); }
    const chip = await box(page, '#remote-chip'); const more = await box(page, '#more-button');
    expect(chip.right).toBeLessThanOrEqual(more.left + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await shot(page, `bar-${w}x740-closed`);
    await page.locator('#more-button').click();
    const menu = page.locator('#more-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Export', 'Session overview', 'Terminal', 'Changes', 'Browser', 'Files', 'Tasks and plan']);
    const m = await box(page, '#more-menu');
    expect(m.bottom, 'a bottom sheet').toBeGreaterThanOrEqual(739);
    expect(m.left).toBeLessThanOrEqual(0.5); expect(m.right).toBeGreaterThanOrEqual(w - 0.5);
    for (const h of await menu.getByRole('menuitem').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(43.5);
    await shot(page, `bar-${w}x740-sheet`);
    // a row presses the real button
    await page.evaluate(() => { window.__pressed = []; for (const v of ['terminal', 'diff', 'browser', 'file', 'tasks']) document.querySelector(`.toolbar [data-view="${v}"]`).addEventListener('click', (e) => { window.__pressed.push(v); e.stopImmediatePropagation(); }, true); document.querySelector('#export').addEventListener('click', (e) => { window.__pressed.push('export'); e.stopImmediatePropagation(); }, true); });
    await menu.getByRole('menuitem', { name: 'Terminal' }).click();
    await expect(menu).toBeHidden();
    await page.locator('#more-button').click();
    await menu.getByRole('menuitem', { name: 'Export' }).click();
    expect(await page.evaluate(() => window.__pressed)).toEqual(['terminal', 'export']);
    await page.locator('#more-button').click();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });
}

for (const w of [480, 600, 720]) {
  test(`${w} px: Export, the overview, Terminal and Changes stay on the bar; Browser, Files, Tasks and the window button are in a small menu under ⋯`, async ({ page }) => {
    await load(page, w, 800, { chip: true });
    const vis = (sel) => page.locator(sel).first().isVisible();
    for (const sel of ['#sidebar-toggle, #sidebar-collapse', '#remote-chip', '#export', '#rail-toggle', '.toolbar [data-view="terminal"]', '.toolbar [data-view="diff"]', '#more-button']) expect(await vis(sel), sel).toBe(true);
    for (const sel of ['.toolbar [data-view="browser"]', '.toolbar [data-view="file"]', '.toolbar [data-view="tasks"]', '#popout']) expect(await vis(sel), sel).toBe(false);
    for (const sel of ['#chat-title', '#remote-chip', '#more-button']) { const b = await box(page, sel); expect(b.right, sel).toBeLessThanOrEqual(w + 0.5); }
    expect((await box(page, '#chat-title')).width).toBeGreaterThan(20);
    await page.locator('#more-button').click();
    const menu = page.locator('#more-menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Browser', 'Files', 'Tasks and plan', 'Open in its own window']);
    const m = await box(page, '#more-menu');
    expect(m.top).toBeGreaterThan(30); expect(m.bottom).toBeLessThan(500); expect(m.right).toBeLessThanOrEqual(w + 0.5);
    expect(await page.locator('.more-scrim').isVisible()).toBe(false);
    if (w === 720) await shot(page, 'bar-720x800-menu');
  });
}

test('from 900 px nothing changes: every control is on the bar and the ⋯ button is not shown', async ({ page }) => {
  await load(page, 1100, 760);
  for (const sel of ['#export', '#rail-toggle', '.toolbar [data-view="terminal"]', '.toolbar [data-view="diff"]', '.toolbar [data-view="browser"]', '.toolbar [data-view="file"]', '.toolbar [data-view="tasks"]', '#popout']) expect(await page.locator(sel).first().isVisible(), sel).toBe(true);
  expect(await page.locator('#more-button').isVisible()).toBe(false);
});

async function openSettingsList(page) {
  await page.locator('#sidebar-toggle').click();
  await page.locator('#settings-open').click();
  await expect(page.locator('#settings-backdrop')).toBeVisible();
}

for (const w of [360, 390, 412]) {
  test(`${w} px: Settings is a list page; a tap opens a section full screen and ‹ Settings goes back; the search filters the rows`, async ({ page }) => {
    await load(page, w, 740);
    await openSettingsList(page);
    const win = page.locator('#settings-window');
    await expect(win).toHaveAttribute('data-page', 'list');
    await expect(page.locator('.settings-nav')).toBeVisible();
    await expect(page.locator('#settings-search')).toBeVisible();
    await expect(page.locator('.settings-body')).toBeHidden();
    const rows = page.locator('#settings-nav-list [data-section]');
    // SETTINGS-OVERHAUL (approved drawing): its 12 sections (Profile, Appearance, Memory and instructions, Models, Capabilities, Quick ask, Permissions, Code chats, Engines, Desktop app, Usage and data, About) plus the three pages the drawing left as they were (Providers and abilities, Customize, Automation). Language is gone (English only).
    expect((await rows.allInnerTexts()).map((t) => t.trim())).toEqual(['Profile', 'Appearance', 'Memory and instructions', 'Quick ask', 'Capabilities', 'Providers and abilities', 'Models', 'Customize', 'Automation', 'Permissions', 'Code chats', 'Engines', 'Desktop app', 'Usage and data', 'About']);
    for (const h of await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(45.5);
    for (const b of await rows.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }))) { expect(b[0]).toBeGreaterThanOrEqual(0); expect(b[1]).toBeLessThanOrEqual(w + 0.5); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
    await shot(page, `settings-${w}x740-list`);
    await page.locator('#settings-search').fill('theme');
    await expect(rows.filter({ hasText: 'Appearance' })).toBeVisible();
    await expect(rows.filter({ hasText: 'Providers and abilities' })).toBeHidden();
    await page.locator('#settings-search').fill('');
    await rows.filter({ hasText: 'Appearance' }).click();
    await expect(win).toHaveAttribute('data-page', 'section');
    await expect(page.locator('.settings-body')).toBeVisible();
    await expect(page.locator('.settings-nav')).toBeHidden();
    await expect(page.locator('#settings-back')).toBeVisible();
    await expect(page.locator('#settings-section-name')).toHaveText('Appearance');
    const f = await box(page, '#settings-frame');
    expect(f.width).toBeGreaterThanOrEqual(w - 1);
    await expect(page.frameLocator('#settings-frame').locator('[data-section="appearance"]')).toBeVisible({ timeout: 10000 });
    await shot(page, `settings-${w}x740-section`);
    await page.locator('#settings-back').click();
    await expect(win).toHaveAttribute('data-page', 'list');
    await expect(page.locator('.settings-nav')).toBeVisible();
    await page.locator('#settings-close').click();
    await expect(page.locator('#settings-backdrop')).toBeHidden();
  });
}

test('720 px: Settings is two panes (a 190 px list, the section beside it) and there is no back button', async ({ page }) => {
  await load(page, 720, 800);
  await openSettingsList(page);
  const nav = await box(page, '.settings-nav');
  expect(nav.width).toBeGreaterThan(185); expect(nav.width).toBeLessThan(200);
  await expect(page.locator('.settings-body')).toBeVisible();
  await expect(page.locator('#settings-back')).toBeHidden();
  const f = await box(page, '#settings-frame');
  expect(f.left).toBeGreaterThanOrEqual(nav.right - 1);
  expect(f.right).toBeLessThanOrEqual(720.5);
  await shot(page, 'settings-720x800-panes');
});

test('900 px and up: Settings is the desktop window, unchanged (a 240 px list)', async ({ page }) => {
  await load(page, 1100, 800);
  await page.locator('#settings-open').click();
  const nav = await box(page, '.settings-nav');
  expect(Math.round(nav.width)).toBe(240);
  await expect(page.locator('#settings-back')).toBeHidden();
});

test('the account menu Settings row and the gear open the list on a phone; Usage and data goes straight to its section', async ({ page }) => {
  await load(page, 390, 740);
  await page.locator('#sidebar-toggle').click();
  await page.locator('#account-button').click();
  await page.locator('#account-menu [data-settings="usage"]').click();
  await expect(page.locator('#settings-window')).toHaveAttribute('data-page', 'section');
  await expect(page.locator('#settings-section-name')).toHaveText('Usage and data'); // the section was renamed by the overhaul
  await page.locator('#settings-close').click();
  await page.locator('#sidebar-toggle').click();
  await page.locator('#account-button').click();
  await page.locator('#account-menu [data-settings="profile"]').click();
  await expect(page.locator('#settings-window')).toHaveAttribute('data-page', 'list');
});

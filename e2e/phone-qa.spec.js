import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// v0.1.14 PHONE-LAYOUT, QA's walk (docs/qa/2026-11-19-v0.1.14-phone-layout): F2 the Job menu stays on the screen, F3 the row under the box is one line, F6 the sidebar's foot and the
// account menu stay on the screen in landscape, F7 the chat keeps room in landscape, F8 touch targets are at least 32 px (28 when the screen is short).
const MODELS = [{ providerId: 'quill', providerName: 'Quill', id: 'otter', displayName: 'Otter 3 Coder', freeKind: null, free: false, contextLength: 128000 }];

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
});

async function load(page, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.addInitScript(() => { localStorage.setItem('bunny.workMode', 'chat'); localStorage.setItem('bunny.modelAuto', '1'); });
  await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
  await page.goto('/');
  await expect(page.locator('#send')).toBeVisible();
  await page.waitForTimeout(250);
}
const box = (page, sel) => page.locator(sel).evaluate((e) => { const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; });

for (const [w, h] of [[360, 640], [390, 844], [412, 915], [720, 800]]) {
  test(`F2 + F3 at ${w}x${h}: the Job menu opens inside the screen and the row under the box is one line`, async ({ page }) => {
    await load(page, w, h);
    const under = await box(page, '.composer-under');
    const tops = await page.locator('#mode-button, #effort-level, #job-button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    expect(Math.max(...tops) - Math.min(...tops), 'one line: every part of the row starts at the same height (within a chip)').toBeLessThanOrEqual(6);
    expect(under.height, 'one line high').toBeLessThanOrEqual(40);
    for (const sel of ['#mode-button', '#effort-level', '#job-button']) { const b = await box(page, sel); expect(b.right, sel).toBeLessThanOrEqual(w + 0.5); expect(b.left, sel).toBeGreaterThanOrEqual(-0.5); }
    await page.locator('#job-button').click();
    await expect(page.locator('#job-menu')).toBeVisible();
    const m = await box(page, '#job-menu');
    expect(m.left, 'menu left edge').toBeGreaterThanOrEqual(-0.5);
    expect(m.right, 'menu right edge').toBeLessThanOrEqual(w + 0.5);
    expect(m.top, 'menu top').toBeGreaterThanOrEqual(-0.5);
    expect(m.bottom, 'menu bottom').toBeLessThanOrEqual(h + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(w);
  });
}

test('F2: the permission menu stays on the screen at 360 too', async ({ page }) => {
  await load(page, 360, 640);
  await page.locator('#mode-button').click();
  const m = await box(page, '#mode-menu');
  expect(m.left).toBeGreaterThanOrEqual(-0.5); expect(m.right).toBeLessThanOrEqual(360.5); expect(m.top).toBeGreaterThanOrEqual(-0.5);
});

for (const [w, h] of [[640, 360], [740, 360], [844, 390]]) {
  test(`F6 + F7 at ${w}x${h} (landscape): the chat keeps room, the sidebar's foot and the account menu stay on the screen`, async ({ page }) => {
    await load(page, w, h);
    const thread = await box(page, '#thread, .thread');
    expect(thread.height, 'room for the chat between the top bar and the box').toBeGreaterThanOrEqual(h === 360 ? 150 : 170);
    const dock = await box(page, '.dock');
    expect(dock.bottom).toBeLessThanOrEqual(h + 0.5);
    if (await page.locator('#sidebar-toggle').isVisible()) await page.locator('#sidebar-toggle').click();
    await expect(page.locator('#settings-open')).toBeVisible();
    const s = await box(page, '#settings-open');
    expect(s.bottom, 'Settings is not below the fold').toBeLessThanOrEqual(h + 0.5);
    await page.locator('#account-button').click();
    await expect(page.locator('#account-menu')).toBeVisible();
    const items = await page.locator('#account-menu').evaluate((menu) => {
      const mb = menu.getBoundingClientRect();
      const last = [...menu.querySelectorAll('.menu-item, button, .zoom-row, [data-zoom]')].pop();
      const lb = last.getBoundingClientRect();
      return { top: mb.top, bottom: mb.bottom, scrolls: menu.scrollHeight > menu.clientHeight + 1, lastBottom: lb.bottom };
    });
    expect(items.top, 'the menu starts on the screen').toBeGreaterThanOrEqual(-0.5);
    expect(items.bottom, 'the menu ends on the screen').toBeLessThanOrEqual(h + 0.5);
    if (!items.scrolls) expect(items.lastBottom, 'the Zoom row is whole').toBeLessThanOrEqual(h + 0.5);
  });
}

test.describe('F8: on a touch screen the controls are at least 32 px high', () => {
  test.use({ hasTouch: true, isMobile: true });
  for (const [w, h] of [[360, 640], [390, 844]]) {
    test(`at ${w}x${h}`, async ({ page }) => {
      await load(page, w, h);
      for (const sel of ['#mode-button', '#effort-level', '#job-button']) expect((await box(page, sel)).height, sel).toBeGreaterThanOrEqual(31.5);
      await page.locator('#sidebar-toggle').tap();
      for (const sel of ['#mode-chat', '#mode-code']) expect((await box(page, sel)).height, sel).toBeGreaterThanOrEqual(31.5);
    });
  }
});

test.describe('F8: the Settings switches', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('a tap lands on a label at least 32 px high, inside the Settings frame', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/src/ui/settings.html?embed=1&section=appearance');
    await expect(page.locator('html[data-settings-filled="1"]')).toBeAttached();
    const labels = page.locator('label.switch:visible');
    const n = await labels.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) { const b = await labels.nth(i).evaluate((e) => e.getBoundingClientRect().height); expect(b).toBeGreaterThanOrEqual(31.5); }
  });
});

test('the visualViewport fallback: a browser without dvh takes the visible height, a browser with it is left alone', async () => {
  const { fitViewport } = await import('../src/ui/viewport-fit.js');
  const listeners = {};
  const style = {}; const classes = new Set();
  const mk = (dvh) => ({ CSS: { supports: () => dvh }, visualViewport: { height: 612.4, addEventListener: (n, f) => { listeners[n] = f; } }, document: { documentElement: { style: { setProperty: (k, v) => { style[k] = v; } }, classList: { add: (c) => classes.add(c) } } } });
  expect(fitViewport(mk(true))).toBe(false);
  expect(classes.size).toBe(0);
  const win = mk(false);
  expect(fitViewport(win)).toBe(true);
  expect(style['--vv-h']).toBe('612px');
  expect(classes.has('no-dvh')).toBe(true);
  win.visualViewport.height = 300; listeners.resize();
  expect(style['--vv-h'], 'the keyboard opens: the height follows').toBe('300px');
  expect(fitViewport({ CSS: { supports: () => false }, document: {} })).toBe(false); // no visualViewport: nothing to follow
});

// Pictures for the review (an invented profile): only when BUNNY_SHOTS_DIR is set.
test('pictures: the Job menu at 412, the row at 360, the sidebar and the account menu in landscape', async ({ page }) => {
  test.skip(!process.env.BUNNY_SHOTS_DIR, 'pictures only on request');
  const dir = process.env.BUNNY_SHOTS_DIR;
  await load(page, 412, 740);
  await page.locator('#job-button').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/F2-jobmenu-412x740-light.png` });
  await page.setViewportSize({ width: 360, height: 640 });
  await page.keyboard.press('Escape'); await page.locator('#job-menu').evaluate((m) => { m.hidden = true; });
  await page.screenshot({ path: `${dir}/F3-row-360x640-light.png` });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.screenshot({ path: `${dir}/F7-chat-landscape-640x360-light.png` });
  await page.locator('#sidebar-toggle').click();
  await page.screenshot({ path: `${dir}/F6-sidebar-landscape-640x360-light.png` });
  await page.locator('#account-button').click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/F6-accountmenu-landscape-640x360-light.png` });
});

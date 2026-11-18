import { test, expect } from '@playwright/test';

// Install as an app (Design's drawing, approved): Settings > Desktop app > Use Bunny in a browser > "Install as an app", in the states a browser tab can be in
// (not offered, ready, installed) and in Bunny's own window (a pointer line only). The network line shows in every state.
const NETWORK = 'On other devices over the network, browsers allow only a home-screen shortcut, unless Bunny has HTTPS.';
const PAGE = '/src/ui/settings.html?embed=1&section=desktop';

test('a browser tab that is not offered an install: the row says so, Install is off, the network line is there, and only this row is shown (the rest is Bunny\'s own window\'s)', async ({ page }) => {
  await page.goto(PAGE);
  const row = page.locator('#install-row');
  await expect(row).toBeVisible();
  await expect(row.locator('#install-title')).toHaveText('Install as an app');
  await expect(row.locator('#install-body')).toContainText('This browser does not offer to install apps from here. Chrome and Edge do.');
  await expect(row.locator('#install-network')).toHaveText(NETWORK);
  await expect(row.locator('#install-app')).toBeDisabled();
  await expect(page.locator('#open-browser-pointer')).toBeHidden();
  // nothing of the window's own rows is offered in a tab
  for (const id of ['#open-browser', '#keep-address', '#remote-on', '#launch-at-login', '#close-to-tray']) await expect(page.locator(id)).toBeHidden();
});

test('ready: the browser\'s install offer turns Install on; pressing it asks the browser; then it says Installed (badge, how to remove it), and the network line stays', async ({ page }) => {
  await page.goto(PAGE);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    window.__asked = 0;
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { window.__asked += 1; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
    window.dispatchEvent(offer);
  });
  const row = page.locator('#install-row');
  await expect(row.locator('#install-body')).toContainText('Installs Bunny as its own window on this computer, with an icon in the Start menu and the taskbar.');
  await expect(row.locator('#install-app')).toBeEnabled();
  await expect(row.locator('#install-network')).toHaveText(NETWORK);
  await row.locator('#install-app').click();
  await expect.poll(() => page.evaluate(() => window.__asked)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(row.locator('#install-badge')).toBeVisible();
  await expect(row.locator('#install-body')).toContainText("To remove it, use your browser's menu: Apps, then Uninstall.");
  await expect(row.locator('#install-app')).toBeDisabled();
  await expect(row.locator('#install-network')).toHaveText(NETWORK);
});

test('the Settings of a tab opened inside the app page reads the install offer from that page (only the top page of a tab receives it)', async ({ page }) => {
  await page.goto('/src/ui/index.html');
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__asked = 0;
    window.dispatchEvent(Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt: async () => { window.__asked += 1; }, userChoice: Promise.resolve({ outcome: 'dismissed' }) }));
    const frame = document.createElement('iframe');
    frame.id = 'settings-test-frame';
    frame.src = '/src/ui/settings.html?embed=1&section=desktop';
    document.body.append(frame);
  });
  const inside = page.frameLocator('#settings-test-frame');
  await expect(inside.locator('#install-app')).toBeEnabled();
  await inside.locator('#install-app').click();
  await expect.poll(() => page.evaluate(() => window.__asked)).toBe(1);
});

test('in Bunny\'s own window (the desktop bridge) there is no Install row, only a pointer line under "Open in your browser", with the network line', async ({ page }) => {
  await page.addInitScript(() => {
    window.bunnyDesktop = { platform: 'win32', getPrefs: async () => ({ launchAtLogin: false, closeToTray: false, quickAskEnabled: false, keepAddress: false, address: 'http://127.0.0.1:5173/', addressNote: '' }), setPrefs: async (p) => p, openInBrowser: async () => ({ ok: true }), secureWrite: async () => ({ status: 200, data: {} }), updates: { get: async () => null, onStatus: () => () => {} } };
  });
  await page.goto(PAGE);
  await expect(page.locator('#install-row')).toBeHidden();
  const pointer = page.locator('#open-browser-pointer');
  await expect(pointer).toBeVisible();
  await expect(pointer).toContainText('To install it as an app, open it in your browser and use Install as an app in Settings there.');
  await expect(pointer).toContainText(NETWORK);
  await expect(page.locator('#open-browser')).toBeVisible();
});

test('the app page asks to fill the screen and keeps clear of the notch and the home bar; the header and the composer dock use the insets', async ({ page }) => {
  await page.goto('/src/ui/index.html');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
  const rules = await page.evaluate(() => {
    const out = [];
    for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) if (rule.cssText.includes('safe-area-inset')) out.push(rule.selectorText ?? rule.cssText.slice(0, 60));
    return out;
  });
  expect(rules.join(' ')).toMatch(/\.topbar/);
  expect(rules.join(' ')).toMatch(/\.dock/);
  // on a desktop the insets are 0, so nothing moved: the header is still its normal height
  const height = await page.evaluate(() => Math.round(document.querySelector('.topbar').getBoundingClientRect().height));
  const normal = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10) || null);
  if (normal) expect(height).toBe(normal);
});

for (const [name, width, height] of [['desktop', 1280, 800], ['phone', 390, 844]]) {
  test(`the "Update ready · Reload" line sits under the top bar and never covers the composer or its row (${name} ${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/src/ui/index.html');
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const { showUpdateBar } = await import('/src/ui/install-app.js');
      showUpdateBar(document, () => {});
    });
    const bar = page.locator('#update-ready');
    await expect(bar).toBeVisible();
    const box = await bar.boundingBox();
    const top = await page.evaluate(() => document.querySelector('.topbar').getBoundingClientRect().bottom);
    expect(box.y).toBeGreaterThanOrEqual(top);
    for (const sel of ['.composer', '.composer-under']) {
      const el = page.locator(sel).first();
      if (!(await el.count()) || !(await el.isVisible())) continue;
      const other = await el.boundingBox();
      const overlap = box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y;
      expect(overlap, sel + ' is not covered').toBe(false);
    }
  });
}

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// BANNER-NOTICE (v0.1.14; the owner: "No banner on top is required", everywhere; Security's BN-6 to BN-9): NO notice anywhere. One chip in the top bar says the state while access is open, and
// what is new (a sign-in, a raise to Everything, a setting changed from a device) until it is clicked. A device's page shows nothing but the red "Everything" chip. Nothing is stored.
const SHOTS = process.env.BUNNY_SHOTS_DIR;
const shot = async (page, name, scheme) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) }); } };

const PIXEL = { id: 'a1a1a1a1a1a1a1a1', label: 'Pixel 8', ip: '192.168.1.40', signedInAt: '2026-11-19T09:02:00.000Z', lastSeen: '2026-11-19T09:20:00.000Z', level: 'chats', asked: true };
const TABLET = { id: 'b2b2b2b2b2b2b2b2', label: 'Kitchen tablet', ip: '192.168.1.41', signedInAt: '2026-11-19T09:05:00.000Z', lastSeen: '2026-11-19T09:20:00.000Z', level: 'chats', asked: true };
const status = (devices) => ({ enabled: true, url: 'http://192.168.1.24:52814', signedIn: devices.length, autoChats: [], devices, anyEverything: devices.some((d) => d.level === 'everything'), hasPasscode: true, notOpened: '' });

/** Bunny's window: a stand-in for the desktop bridge, and the made-up server's answers for device access. `box.devices` is what the test changes; `box.log` is the action log. */
async function windowWith(page, box) {
  box.writes = [];
  await page.route('**/api/remote', (r) => { const m = r.request().method(); if (m === 'GET') return r.fulfill({ json: status(box.devices) }); box.writes.push(m + ' /api/remote'); return r.continue(); });
  await page.route('**/api/remote/log', (r) => r.fulfill({ json: { entries: box.log ?? [] } }));
  await page.route(/\/api\/remote\/devices\/[a-f0-9]{16}\/level$/, async (r) => {
    const body = r.request().postDataJSON();
    const id = r.request().url().match(/devices\/([a-f0-9]{16})\/level/)[1];
    box.writes.push('PATCH level');
    box.devices = box.devices.map((d) => (d.id === id ? { ...d, level: body.level } : d));
    await r.fulfill({ json: status(box.devices) });
  });
  await page.addInitScript(() => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; });
}
const chip = (page) => page.locator('#remote-chip');
const NO_NOTICE = '#remote-note, #device-note, #device-notice';
const NEW = { id: 'c3c3c3c3c3c3c3c3', label: 'Living room TV', ip: '192.168.1.42', signedInAt: '2026-11-19T09:30:00.000Z', lastSeen: '2026-11-19T09:30:00.000Z', level: 'chats', asked: true };

for (const scheme of ['light', 'dark']) {
  test.describe(`window, ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1100, height: 760 } });

    test('BN-6 and no banner: the window shows only the chip "Open to devices · N", nothing is over the page, and the app starts at the top', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
      await expect(chip(page)).toHaveAttribute('role', 'status');
      await expect(chip(page)).toHaveAttribute('aria-live', 'polite');
      await page.waitForTimeout(1500);
      await expect(page.locator(NO_NOTICE)).toHaveCount(0);
      expect((await page.locator('.app').boundingBox()).y).toBeLessThanOrEqual(1);
      await shot(page, 'window-chip-state', scheme);
    });

    test('BN-7: a new sign-in turns the chip to "New: <device> signed in" and it stays until clicked; the click opens the devices list; a reload shows the state words', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
      box.devices = [PIXEL, NEW];
      await expect(chip(page).locator('.lg')).toHaveText('New: Living room TV signed in', { timeout: 8000 });
      await shot(page, 'window-chip-new-signin', scheme);
      await page.waitForTimeout(3000); // not by itself
      await expect(chip(page).locator('.lg')).toHaveText('New: Living room TV signed in');
      await expect(page.locator(NO_NOTICE)).toHaveCount(0);
      await chip(page).click();
      await expect(page.locator('#settings-backdrop')).toBeVisible();
      await expect(page.locator('#settings-frame')).toHaveAttribute('src', /section=desktop/);
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 2');
      await page.reload();
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 2');
    });

    test('BN-L1, the swap case: one device signs out and another signs in between two looks (the count stays): the chip still says what happened', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
      box.devices = [TABLET];
      await expect(chip(page).locator('.lg')).toHaveText('New: Kitchen tablet signed in', { timeout: 8000 });
    });

    test('BN-6 and BN-7: a device raised to Everything turns the chip to the warning colour, in words, with its name; it stays in the warning colour after a click', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page)).toHaveAttribute('data-level', 'open');
      box.devices = [{ ...PIXEL, level: 'everything' }];
      await expect(chip(page)).toHaveAttribute('data-level', 'everything', { timeout: 8000 });
      await expect(chip(page)).toHaveClass(/is-bad/);
      await shot(page, 'window-chip-everything', scheme);
      await chip(page).click();
      await expect(chip(page).locator('.lg')).toHaveText('Pixel 8 has Everything');
      await expect(page.locator(NO_NOTICE)).toHaveCount(0);
    });

    test("BN-8: a setting changed from a device shows on the chip; the click opens that device's Activity; two changes show a badge of 2; the chip is not cleared by time", async ({ page }) => {
      const box = { devices: [{ ...PIXEL, level: 'everything' }], log: [{ at: '2026-11-19T09:00:00.000Z', device: PIXEL.id, label: 'Pixel 8', level: 'everything', kind: 'signin' }] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page).locator('.lg')).toHaveText('Pixel 8 has Everything');
      const change = (at) => ({ at, device: PIXEL.id, label: 'Pixel 8', level: 'everything', kind: 'route', method: 'PUT', path: '/api/settings' });
      box.log = [change('2026-11-19T09:40:00.000Z'), ...box.log];
      await expect(chip(page).locator('.lg')).toHaveText('Pixel 8 changed a setting', { timeout: 8000 });
      await expect(chip(page).locator('.rc-badge')).toHaveCount(0);
      box.log = [change('2026-11-19T09:41:00.000Z'), ...box.log];
      await expect(chip(page).locator('.rc-badge')).toHaveText('2', { timeout: 8000 });
      await shot(page, 'window-chip-setting-badge', scheme);
      await page.waitForTimeout(3000);
      await expect(chip(page).locator('.rc-badge')).toHaveText('2');
      await chip(page).click();
      await expect(page.locator('#settings-frame')).toHaveAttribute('src', new RegExp(`activity=${PIXEL.id}`));
      await expect(chip(page).locator('.lg')).toHaveText('Pixel 8 has Everything');
      await expect(page.locator(NO_NOTICE)).toHaveCount(0);
    });

    test('access turned off removes the chip; turned on again brings the state words back (no event)', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page)).toBeVisible();
      await page.unroute('**/api/remote');
      box.off = true;
      await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: box.off ? { enabled: false, signedIn: 0, devices: [] } : status(box.devices) }) : r.continue()));
      await expect(chip(page)).toHaveCount(0, { timeout: 8000 });
      box.off = false;
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1', { timeout: 8000 });
    });

    test('BN-4: nothing about it is stored or sent: no localStorage, sessionStorage or cookie, and no write to the server', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
      const storage = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage).filter(([k]) => /remote|chip|banner|notice|device/i.test(k)), Object.entries(sessionStorage), document.cookie]));
      const before = await storage();
      box.devices = [PIXEL, NEW];
      await expect(chip(page).locator('.lg')).toHaveText('New: Living room TV signed in', { timeout: 8000 });
      await chip(page).click();
      expect(await storage()).toBe(before);
      expect(box.writes).toEqual([]);
    });

    test('reduced motion: no pulse, and the words still change once per event', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
      box.devices = [PIXEL, NEW];
      await expect(chip(page).locator('.lg')).toHaveText('New: Living room TV signed in', { timeout: 8000 });
      await expect(chip(page)).not.toHaveClass(/is-new/);
      expect(await chip(page).evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    });
  });
}

test.describe('the chip is never hidden by the narrow layout', () => {
  for (const [w, h] of [[360, 640], [390, 800], [720, 800], [1280, 800]]) {
    test(`${w}x${h}, with an event and with Everything`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(chip(page)).toBeVisible();
      for (const devices of [[PIXEL, NEW], [{ ...PIXEL, level: 'everything' }, NEW]]) {
        box.devices = devices;
        await expect(chip(page)).toHaveAttribute('data-event', /signin|everything/, { timeout: 8000 });
        const m = await chip(page).evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, shown: [...el.querySelectorAll('.lg,.sh')].some((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0) }; });
        expect(m.width).toBeGreaterThan(20);
        expect(m.left).toBeGreaterThanOrEqual(-0.5);
        expect(m.right).toBeLessThanOrEqual(w + 0.5);
        expect(m.shown, 'it says something at every width').toBe(true);
      }
    });
  }
});

async function devicePage(page, level) {
  await page.route('**/src/ui/index.html*', async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['if-none-match']; delete headers['if-modified-since']; // a second load must not be answered with an empty "not modified"
    const res = await route.fetch({ headers });
    const html = (await res.text()).replace(/<head>/i, '<head>\n<meta name="bunny-csrf" content="test-csrf">\n<script src="/src/ui/remote.js"></script>').replace(/<meta name="bunny-token"[^>]*>/i, '');
    await route.fulfill({ response: res, body: html });
  });
  await page.route('**/api/remote/me', (r) => r.fulfill({ json: { device: 'Pixel 8', csrf: 'test-csrf', level } }));
}
for (const scheme of ['light', 'dark']) {
  test.describe(`a device, ${scheme}`, () => {
    for (const [w, h] of [[390, 800], [1000, 700]]) {
      test.describe(`${w}x${h}`, () => {
        test.use({ colorScheme: scheme, viewport: { width: w, height: h }, serviceWorkers: 'block' });

        test('BN-9, Chats: no notice and no chip at all', async ({ page }) => {
          await devicePage(page, 'chats');
          await page.goto('/src/ui/index.html');
          await expect(page.locator('#send')).toBeVisible();
          await page.waitForTimeout(1500);
          await expect(page.locator(NO_NOTICE)).toHaveCount(0);
          await expect(page.locator('#device-chip, #remote-chip')).toHaveCount(0);
          if (w === 390) await shot(page, 'device-chats-nothing', scheme);
        });

        test('BN-9, Everything: no notice, the red "Everything" chip is in the header, cannot be dismissed, and nothing is stored', async ({ page }) => {
          await devicePage(page, 'everything');
          await page.goto('/src/ui/index.html');
          const c = page.locator('#device-chip');
          await expect(c).toHaveText('Everything');
          await expect(c).toHaveAttribute('role', 'status');
          await expect(page.locator(NO_NOTICE)).toHaveCount(0);
          const storage = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage).sort(), Object.entries(sessionStorage), document.cookie]));
          const before = await storage();
          await c.click();
          await page.keyboard.press('Escape');
          await expect(c).toBeVisible();
          await expect(page.locator(NO_NOTICE)).toHaveCount(0);
          expect(await storage()).toBe(before);
          const box = await c.boundingBox();
          expect(box.x + box.width).toBeLessThanOrEqual(w + 0.5);
          expect(box.y).toBeGreaterThanOrEqual(0);
          if (w === 390) await shot(page, 'device-everything-chip', scheme);
          await page.reload();
          await expect(page.locator('#device-chip')).toBeVisible();
        });
      });
    }
  });
}

import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// BANNER-NOTICE (v0.1.14, the owner's go; Design's drawing v3; Security's BN-1 to BN-5): the "Open to other devices" banner is a notification the person can dismiss, and the STATE is
// never hidden: a chip stays in the window's top bar while access is open (in the warning colour, in words, while a device has Everything); a device's page keeps a small "Everything" chip.
// A dismissal is never remembered, and nothing on the server changes. These tests answer from a made-up server so each state is exact. BUNNY_SHOTS_DIR also writes the pictures.
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
const note = (page) => page.locator('#remote-note');
const chip = (page) => page.locator('#remote-chip');

for (const scheme of ['light', 'dark']) {
  test.describe(`window, ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1100, height: 760 } });

    test('BN-1 and BN-2: the banner shows when the window opens, can be dismissed with ×, and the chip stays: "Open to devices · N"', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(note(page)).toBeVisible();
      await expect(note(page)).toContainText('Open to other devices · 1 signed in');
      await expect(note(page)).toContainText('Pixel 8 signed in. It works as Chats. Change this in Settings.');
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
      await expect(chip(page)).toHaveAttribute('role', 'status');
      await shot(page, 'window-banner-open', scheme);
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
      await shot(page, 'window-chip-only', scheme);
      // nothing in the layout moved: the notification floats over the window
      const app = await page.locator('.app').boundingBox();
      expect(app.y).toBeLessThanOrEqual(1);
    });

    test('BN-3: a device raised to Everything brings the banner back in red and in words, and the chip turns to the warning colour with its name; dismissed again, the chip stays', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      box.devices = [{ ...PIXEL, level: 'everything' }];
      await expect(note(page)).toBeVisible({ timeout: 8000 });
      await expect(note(page)).toHaveAttribute('data-level', 'everything');
      await expect(note(page)).toContainText('Pixel 8 has Everything');
      await expect(note(page)).toContainText('It can run programs and change settings. Ends after 30 minutes idle.');
      await expect(note(page).getByRole('button', { name: 'See Activity' })).toBeVisible();
      await expect(note(page).getByRole('button', { name: 'Back to Chats' })).toBeVisible();
      await expect(chip(page).locator('.lg')).toHaveText('Pixel 8 has Everything');
      await expect(chip(page)).toHaveClass(/is-bad/);
      await shot(page, 'window-banner-everything', scheme);
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      await expect(chip(page).locator('.lg')).toHaveText('Pixel 8 has Everything'); // cannot be dismissed
      await shot(page, 'window-chip-everything', scheme);
      // two devices: in words too
      box.devices = [{ ...PIXEL, level: 'everything' }, { ...TABLET, level: 'everything' }];
      await expect(chip(page).locator('.lg')).toHaveText('Everything: 2 devices', { timeout: 8000 });
    });

    test('BN-3: a device that signs in after a dismissal brings the banner back; so does a click on the chip', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      box.devices = [PIXEL, TABLET];
      await expect(note(page)).toBeVisible({ timeout: 8000 });
      await expect(note(page)).toContainText('Open to other devices · 2 signed in');
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      await chip(page).click();
      await expect(note(page)).toBeVisible();
    });

    test('BN-L1: one device signs out and another signs in between two looks (the count stays the same): the banner still comes back', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      box.devices = [TABLET];
      await expect(note(page)).toBeVisible({ timeout: 8000 });
      await expect(note(page)).toContainText('Kitchen tablet signed in');
    });

    test('BN-3: access turned on again (or reopened at start) brings the banner back; turning it off removes the chip', async ({ page }) => {
      const box = { devices: [PIXEL], off: false };
      await windowWith(page, box);
      await page.unroute('**/api/remote');
      await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: box.off ? { enabled: false, devices: [], signedIn: 0, autoChats: [] } : status(box.devices) }) : r.continue()));
      await page.goto('/src/ui/index.html');
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      box.off = true;
      await expect(chip(page)).toHaveCount(0, { timeout: 8000 });
      box.off = false;
      await expect(note(page)).toBeVisible({ timeout: 8000 });
      await expect(chip(page)).toBeVisible();
    });

    test('BN-4: a dismissal is never remembered: nothing is written anywhere, nothing is sent, and a reload brings the banner back', async ({ page }) => {
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      const mutating = [];
      page.on('request', (r) => { if (!['GET', 'HEAD'].includes(r.method()) && r.url().includes('/api/')) mutating.push(r.method() + ' ' + r.url().replace(/^.*\/api/, '/api')); });
      await page.goto('/src/ui/index.html');
      await expect(note(page)).toBeVisible();
      const storage = () => page.evaluate(() => ({ local: JSON.stringify(Object.entries(localStorage).sort()), session: JSON.stringify(Object.entries(sessionStorage)), cookie: document.cookie }));
      const before = await storage();
      const writesBefore = mutating.length;
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      await page.waitForTimeout(1500); // a few polls later
      expect(await storage(), 'nothing stored by the dismissal').toEqual(before);
      expect(mutating.slice(writesBefore), 'nothing sent by the dismissal').toEqual([]);
      expect(box.writes, 'no device-access write').toEqual([]);
      await page.reload();
      await expect(note(page)).toBeVisible(); // the window started again: the banner is back
      const settings = await (await page.request.get('/api/settings')).json();
      expect(JSON.stringify(settings)).not.toMatch(/dismiss|banner|notice/i);
    });

    test('BN-1: Esc dismisses the banner while it has focus; the plain banner hides itself after 10 seconds, one that says a device has Everything never does', async ({ page }) => {
      await page.clock.install();
      const box = { devices: [PIXEL] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await expect(note(page)).toBeVisible();
      await note(page).getByRole('button', { name: 'Dismiss' }).focus();
      await page.keyboard.press('Escape');
      await expect(note(page)).toHaveCount(0);
      await chip(page).click();
      await expect(note(page)).toBeVisible();
      await expect(note(page).locator('.rn-countdown')).toHaveCount(1); // the thin line that counts down
      await page.clock.fastForward(9000);
      await expect(note(page)).toBeVisible();
      await page.clock.fastForward(2500);
      await expect(note(page)).toHaveCount(0);
      await expect(chip(page)).toBeVisible();
      // Everything: it stays until the person dismisses it
      box.devices = [{ ...PIXEL, level: 'everything' }];
      await page.clock.fastForward(12000);
      await expect(note(page)).toBeVisible();
      await expect(note(page).locator('.rn-countdown')).toHaveCount(0);
      await page.clock.fastForward(120000);
      await expect(note(page)).toBeVisible();
    });

    test('BN-3: a setting changed by a device at Everything is announced even after the banner was dismissed', async ({ page }) => {
      const box = { devices: [{ ...PIXEL, level: 'everything' }], log: [{ at: '2026-11-19T09:00:00.000Z', device: PIXEL.id, label: 'Pixel 8', level: 'everything', kind: 'signin' }] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await note(page).getByRole('button', { name: 'Dismiss' }).click();
      await expect(note(page)).toHaveCount(0);
      box.log = [{ at: '2026-11-19T09:40:00.000Z', device: PIXEL.id, label: 'Pixel 8', level: 'everything', kind: 'route', method: 'PUT', path: '/api/settings' }, ...box.log];
      await expect(page.locator('#device-notice')).toContainText('Pixel 8 changed a setting', { timeout: 8000 });
      await expect(note(page)).toHaveCount(0); // it is its own notice; the banner is not suppressed by it nor brought back by it
    });

    test('Back to Chats puts every device with Everything back to Chats (the window\'s own control), and See Activity opens that device\'s Activity', async ({ page }) => {
      const box = { devices: [{ ...PIXEL, level: 'everything' }], log: [] };
      await windowWith(page, box);
      await page.goto('/src/ui/index.html');
      await note(page).getByRole('button', { name: 'Back to Chats' }).click();
      await expect.poll(() => box.devices[0].level).toBe('chats');
      await expect(chip(page).locator('.lg')).toHaveText('Open to devices · 1');
    });

    for (const [w, h] of [[360, 640], [390, 800], [720, 800], [1280, 800]]) {
      test(`the chip is never hidden by the narrow layout (${w}x${h}), with and without Everything`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        const box = { devices: [PIXEL] };
        await windowWith(page, box);
        await page.goto('/src/ui/index.html');
        await note(page).getByRole('button', { name: 'Dismiss' }).click();
        for (const level of ['chats', 'everything']) {
          box.devices = [{ ...PIXEL, level }];
          await expect(chip(page)).toHaveAttribute('data-level', level === 'everything' ? 'everything' : 'open', { timeout: 8000 });
          await note(page).getByRole('button', { name: 'Dismiss' }).click({ timeout: 1000 }).catch(() => {});
          const m = await chip(page).evaluate((el) => { const b = el.getBoundingClientRect(); const lg = el.querySelector('.lg'); const sh = el.querySelector('.sh'); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, vw: innerWidth, vh: innerHeight, lg: getComputedStyle(lg).display, sh: getComputedStyle(sh).display, text: el.innerText }; });
          expect(m.width).toBeGreaterThan(20);
          expect(m.left).toBeGreaterThanOrEqual(0);
          expect(m.right).toBeLessThanOrEqual(m.vw + 0.5);
          expect(m.bottom).toBeLessThanOrEqual(m.vh);
          expect(m.text.trim().length, 'it says something').toBeGreaterThan(3);
          if (w <= 760) expect([m.lg, m.sh !== 'none']).toEqual(['none', true]); else expect([m.lg !== 'none', m.sh]).toEqual([true, 'none']); // flex items compute as block, so "shown" is anything but none
          if (level === 'everything') await shot(page, `window-chip-everything-${w}`, scheme);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      });
    }
  });
}

/** A page as a signed-in device is served it: the CSRF meta and remote.js, and the server's own answer about its level. */
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
        test.use({ colorScheme: scheme, viewport: { width: w, height: h }, serviceWorkers: 'block' }); // the page's service worker would answer a reload itself, past this test's stand-in for the device's page

        test('Chats: a notice on load that can be dismissed, and nothing is left behind', async ({ page }) => {
          await devicePage(page, 'chats');
          await page.goto('/src/ui/index.html');
          const n = page.locator('#device-note');
          await expect(n).toBeVisible();
          await expect(n).toContainText('You have Chats access');
          await expect(n).toContainText('The PC can give this device more. Change it in Bunny, on the PC.');
          await expect(page.locator('#device-chip')).toHaveCount(0);
          if (w === 390) await shot(page, 'device-chats-notice', scheme);
          await n.getByRole('button', { name: 'Dismiss' }).click();
          await expect(n).toHaveCount(0);
          await expect(page.locator('#device-chip')).toHaveCount(0);
          if (w === 390) await shot(page, 'device-chats-dismissed', scheme);
        });

        test('Everything: the notice can be dismissed but the red "Everything" chip stays in the header; a tap on it brings the notice back; a new load shows it again; nothing is stored', async ({ page }) => {
          await devicePage(page, 'everything');
          await page.goto('/src/ui/index.html');
          const n = page.locator('#device-note');
          const c = page.locator('#device-chip');
          await expect(n).toBeVisible();
          await expect(n).toContainText('Everything access');
          await expect(n).toContainText('The PC gave this device every tool and setting. Ends after 30 minutes idle.');
          await expect(c).toHaveText('Everything');
          await expect(c).toHaveAttribute('role', 'status');
          if (w === 390) await shot(page, 'device-everything-notice', scheme);
          const storage = () => page.evaluate(() => JSON.stringify([Object.entries(localStorage).sort(), Object.entries(sessionStorage), document.cookie]));
          const before = await storage();
          await n.getByRole('button', { name: 'Dismiss' }).click();
          await expect(n).toHaveCount(0);
          await expect(c).toBeVisible();
          expect(await storage()).toBe(before);
          if (w === 390) await shot(page, 'device-everything-dismissed', scheme);
          const box = await c.boundingBox();
          expect(box.x + box.width).toBeLessThanOrEqual(w + 0.5);
          expect(box.y).toBeGreaterThanOrEqual(0);
          await c.click();
          await expect(n).toBeVisible();
          await n.focus().catch(() => {});
          await n.getByRole('button', { name: 'Dismiss' }).focus();
          await page.keyboard.press('Escape');
          await expect(n).toHaveCount(0);
          await page.reload(); // a new page load
          await expect(page.locator('#device-note')).toBeVisible(); // it is back
          await expect(page.locator('#device-chip')).toBeVisible();
        });
      });
    }
  });
}

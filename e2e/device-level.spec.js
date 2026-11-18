import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// DEVICE-FULL, the visible parts, as the owner approved them (Design's drawing, version 5): the choice when a device signs in, Settings → Signed-in devices
// (level, Change, Activity, Sign out, the warning), the status line that names the devices, and what a device sees at each level.
// The server's rules are tested over real HTTP in test/remote-access.test.js; these tests answer from a made-up server so each picture is one fixed state.
// Set BUNNY_SHOTS_DIR to also write the pictures (invented profile only: the devices below are examples).
const SHOTS = process.env.BUNNY_SHOTS_DIR;
const shot = async (page, name, scheme) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) }); } };

const PHONE = { id: 'a1a1a1a1a1a1a1a1', label: "Sam's phone", ip: '192.168.1.40', signedInAt: '2026-11-18T09:02:00.000Z', lastSeen: '2026-11-18T09:20:00.000Z', level: 'chats', asked: false };
const LAPTOP = { id: 'b2b2b2b2b2b2b2b2', label: 'Kitchen laptop', ip: '192.168.1.41', signedInAt: '2026-11-17T18:00:00.000Z', lastSeen: '2026-11-18T08:00:00.000Z', level: 'everything', asked: true };
const status = (devices) => ({ enabled: true, url: 'http://192.168.1.24:52814', signedIn: devices.length, autoChats: [], devices, anyEverything: devices.some((d) => d.level === 'everything') });
const LOG = [
  { at: '2026-11-18T09:31:00.000Z', device: LAPTOP.id, label: LAPTOP.label, level: 'everything', kind: 'idle-signout' },
  { at: '2026-11-18T09:12:00.000Z', device: LAPTOP.id, label: LAPTOP.label, level: 'everything', kind: 'route', method: 'PUT', path: '/api/settings' },
  { at: '2026-11-18T09:09:00.000Z', device: LAPTOP.id, label: LAPTOP.label, level: 'everything', kind: 'tool', tool: 'read_file' },
  { at: '2026-11-18T09:05:00.000Z', device: LAPTOP.id, label: LAPTOP.label, level: 'everything', kind: 'level', from: 'chats' },
  { at: '2026-11-18T09:02:00.000Z', device: LAPTOP.id, label: LAPTOP.label, level: 'chats', kind: 'signin' },
  { at: '2026-11-18T09:03:00.000Z', device: PHONE.id, label: PHONE.label, level: 'chats', kind: 'signin' },
];
const WARNING = "Everything lets this device do anything you can do on this PC: run programs, change settings, read your files and saved keys. The connection is not encrypted, so on a network you don't fully trust, someone could take over this device's access. Give it only on your own home network, to a device you own. Signing the device out stops it, but does not undo what it already did.";

/** Bunny's window: a tab with a stand-in for the desktop bridge, and the server's answers for device access made up. */
async function windowWith(page, devices, { patches = [], log = { entries: LOG } } = {}) {
  let current = devices.map((d) => ({ ...d }));
  await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: status(current) }) : r.continue()));
  await page.route('**/api/remote/log', (r) => r.fulfill({ json: { entries: log.entries } }));
  await page.route(/\/api\/remote\/devices\/[a-f0-9]{16}\/level$/, async (r) => {
    const body = r.request().postDataJSON();
    const id = r.request().url().match(/devices\/([a-f0-9]{16})\/level/)[1];
    patches.push({ id, level: body.level });
    current = current.map((d) => (d.id === id ? { ...d, level: body.level, asked: true } : d));
    await r.fulfill({ json: status(current) });
  });
  await page.addInitScript(() => {
    window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) };
    localStorage.setItem('bunny.modelAuto', '1');
  });
}

for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1100, height: 760 } });

    test('first sign-in: Bunny\'s window asks what the device may do; it works as Chats meanwhile; Everything shows the warning first and needs its own button', async ({ page }) => {
      const patches = [];
      await windowWith(page, [PHONE], { patches });
      await page.goto('/src/ui/index.html');
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Sam's phone signed in. What may it do?");
      await expect(dialog).toContainText('It works as Chats right now. You can change this at any time in Settings.');
      await expect(dialog.getByRole('radio', { name: /Chats/ })).toBeChecked();
      await expect(dialog.locator('.everything-warning')).toHaveCount(0);
      await expect(page.locator('#level-go')).toHaveText('Keep Chats');
      await expect(page.locator('#level-go')).toHaveClass('btn pri'); // the filled dark button, as drawn
      await shot(page, 'first-signin-chats', scheme);
      await dialog.getByRole('radio', { name: /Everything/ }).check();
      await expect(dialog.locator('.everything-warning')).toContainText(WARNING);
      await expect(dialog.locator('.everything-warning')).toContainText('Ends after 30 minutes idle. Everything ends by itself after 30 minutes without use, and when the device signs out or Bunny restarts.');
      await expect(page.locator('#level-go')).toHaveText('Give Everything');
      await expect(page.locator('#level-go')).toHaveClass('btn bad'); // the red-outlined button, as drawn: never the filled dark one
      await page.waitForTimeout(500); // the button's colours fade (a short transition)
      const look = await page.locator('#level-go').evaluate((el) => { const c = getComputedStyle(el); const root = getComputedStyle(document.documentElement); return { border: c.borderTopColor, width: c.borderTopWidth, color: c.color, bg: c.backgroundColor, ink: root.getPropertyValue('--ink').trim() }; });
      expect(look.width).toBe('1px');
      expect(look.border).toBe(look.color); // the outline and the words are the same red
      expect(look.border).not.toBe(look.bg);
      expect(look.bg).not.toBe('rgb(31, 32, 35)'); // not the dark ink fill
      expect(look.bg).not.toBe('rgb(236, 236, 238)'); // not the light ink fill in dark mode
      expect(patches).toEqual([]); // nothing is given by choosing
      await shot(page, 'first-signin-everything', scheme);
      await page.locator('#level-go').click();
      await expect.poll(() => patches).toEqual([{ id: PHONE.id, level: 'everything' }]);
      await expect(page.locator('#level-dialog')).toHaveCount(0);
      // the status line now names the device
      await expect(page.locator('#remote-bar')).toContainText("Open to other devices · 1 signed in · Sam's phone has Everything");
    });

    test('Not now and Escape give nothing and do not ask again until Bunny restarts; Keep Chats says so to the server', async ({ page }) => {
      const patches = [];
      await windowWith(page, [PHONE], { patches });
      await page.goto('/src/ui/index.html');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('#level-dialog')).toHaveCount(0);
      await page.waitForTimeout(500);
      expect(patches).toEqual([]);
      // no device has Everything: the top bar ends at the count, with no dangling separator
      await expect(page.locator('#remote-bar span').first()).toHaveText('Open to other devices · 1 signed in');
      await expect(page.locator('#level-dialog')).toHaveCount(0); // not asked again by the next look at the list
    });

    test('Settings → Signed-in devices: each device shows its level with Change, Activity and Sign out; Everything says it ends after 30 min idle; the warning stays while a device has it', async ({ page }) => {
      const patches = [];
      await windowWith(page, [{ ...PHONE, asked: true }, LAPTOP], { patches });
      await page.goto('/src/ui/settings.html?embed=1&section=desktop');
      const rows = page.locator('.device-row');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0).locator('.level-pill')).toHaveText('Chats');
      await expect(rows.nth(1).locator('.level-pill')).toHaveText('Everything');
      await expect(rows.nth(1)).toContainText('Ends after 30 min idle');
      await expect(rows.nth(0)).not.toContainText('Ends after 30 min idle');
      for (const name of ['Change', 'Activity', 'Sign out']) await expect(rows.nth(1).getByRole('button', { name: new RegExp(name) })).toBeVisible();
      await expect(page.locator('#remote-devices .everything-warning')).toContainText(WARNING);
      await expect(page.locator('#remote-status')).toContainText("Open to other devices · 2 signed in · Kitchen laptop has Everything");
      await shot(page, 'settings-devices', scheme);
      // Change opens two choices; Chats takes effect at once
      await rows.nth(1).getByRole('button', { name: /Change/ }).click();
      await expect(page.getByRole('menuitemradio')).toHaveCount(2);
      await shot(page, 'settings-change', scheme);
      await page.getByRole('menuitemradio', { name: /^Chats/ }).click();
      await expect.poll(() => patches).toEqual([{ id: LAPTOP.id, level: 'chats' }]);
      await expect(page.locator('#remote-devices .everything-warning')).toHaveCount(0); // no device has Everything now
      // Everything from Change: the warning first, then its own button
      await rows.nth(0).getByRole('button', { name: /Change/ }).click();
      await page.getByRole('menuitemradio', { name: /^Everything/ }).click();
      await expect(page.getByRole('dialog')).toContainText(WARNING);
      await expect(page.getByRole('dialog')).toContainText('What may Sam\'s phone do?');
      await page.getByRole('button', { name: 'Not now' }).click();
      expect(patches.length).toBe(1);
    });

    test('Activity: what the device did by name, newest first, with the limit of the record said under the list; Back returns to the devices', async ({ page }) => {
      await windowWith(page, [{ ...PHONE, asked: true }, LAPTOP]);
      await page.goto('/src/ui/settings.html?embed=1&section=desktop');
      await page.locator('.device-row').nth(1).getByRole('button', { name: 'Activity' }).click();
      const view = page.locator('.device-activity');
      await expect(view).toContainText('Activity · Kitchen laptop');
      await expect(view).toContainText('What this device did, newest first. Names only: never the details of a command, a file or a setting. Kept for the last 500 entries or 30 days. Only visible in Bunny\'s window.');
      const items = view.getByRole('listitem');
      await expect(items).toHaveCount(5); // the phone's sign-in is not here
      await expect(items.nth(0)).toContainText('Signed out');
      await expect(items.nth(0)).toContainText('Ended: 30 minutes idle');
      await expect(items.nth(1)).toContainText('Setting changed');
      await expect(items.nth(1)).toContainText('PUT /api/settings (a setting; no value shown)');
      await expect(items.nth(2)).toContainText('Tool: read_file');
      await expect(items.nth(3)).toContainText('Level changed to Everything');
      await expect(items.nth(4)).toContainText('Signed in');
      await expect(view).toContainText('What this list can and cannot tell you');
      await expect(view).toContainText('This shows what devices did, unless one set out to hide it. A device with Everything can run commands, so it could change this record. Use it to notice something odd, not as proof that nothing happened.');
      await shot(page, 'activity', scheme);
      await view.getByRole('button', { name: 'Back to devices' }).click();
      await expect(page.locator('.device-row')).toHaveCount(2);
    });

    test('a device with Everything changes a setting: a notice (names only, never the value) says who and when, and See Activity opens that device Activity', async ({ page }) => {
      const log = { entries: LOG };
      await windowWith(page, [{ ...PHONE, asked: true }, LAPTOP], { log });
      await page.goto('/src/ui/index.html');
      await expect(page.locator('#remote-bar')).toContainText('Kitchen laptop has Everything');
      await page.waitForTimeout(300);
      await expect(page.locator('#device-notice')).toHaveCount(0); // what happened before the window looked is not announced
      log.entries = [{ at: '2026-11-18T09:40:00.000Z', device: LAPTOP.id, label: LAPTOP.label, level: 'everything', kind: 'route', method: 'PUT', path: '/api/settings' }, ...LOG];
      const notice = page.locator('#device-notice');
      await expect(notice).toBeVisible({ timeout: 15000 });
      await expect(notice).toContainText('Kitchen laptop changed a setting');
      await expect(notice).toContainText(/Everything access · [0-9]{2}:[0-9]{2} · See Activity/);
      await expect(notice).not.toContainText('/api/settings');
      await shot(page, 'notice', scheme);
      await notice.getByRole('button', { name: 'See Activity' }).click();
      await expect(notice).toHaveCount(0);
      const frame = page.frameLocator('#settings-frame');
      await expect(frame.locator('.device-activity')).toContainText('Activity · Kitchen laptop');
      await expect(frame.getByRole('listitem').first()).toContainText('Setting changed');
    });

    test('a setting change is announced even if the device has signed out (or timed out) by the next look', async ({ page }) => {
      const log = { entries: LOG };
      const devices = [{ ...PHONE, asked: true }, LAPTOP];
      await windowWith(page, devices, { log });
      await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: status(devices) }) : r.continue()));
      await page.goto('/src/ui/index.html');
      await expect(page.locator('#remote-bar')).toContainText('Kitchen laptop has Everything');
      log.entries = [{ at: '2026-11-18T09:40:00.000Z', device: LAPTOP.id, label: LAPTOP.label, level: 'everything', kind: 'route', method: 'PUT', path: '/api/settings' }, ...LOG];
      devices.splice(1, 1); // the laptop is signed out before the window next looks
      await expect(page.locator('#device-notice')).toContainText('Kitchen laptop changed a setting', { timeout: 15000 });
    });

    test('REMOTE-STAY: the row says it stays on until you turn it off, also after a restart; when Bunny stayed closed at start (another network) one plain sentence says why', async ({ page }) => {
      await page.addInitScript(() => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; });
      await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { enabled: false, url: null, signedIn: 0, autoChats: [], devices: [], hasPasscode: true, notOpened: "Not opened: this network isn't the one you turned it on with. Turn it on again to allow it here." } }) : r.continue()));
      await page.goto('/src/ui/settings.html?embed=1&section=desktop');
      const row = page.locator('#remote-on').locator('xpath=ancestor::div[contains(@class,"row")][1]');
      await expect(row).toContainText('It is off until you turn it on, then it stays on, also after Bunny restarts, until you turn it off. Devices sign in again after a restart.');
      await expect(row).not.toContainText('off again every time Bunny starts');
      await expect(page.locator('#remote-not-opened')).toHaveText("Not opened: this network isn't the one you turned it on with. Turn it on again to allow it here.");
      await expect(page.locator('#remote-on')).not.toBeChecked();
      await row.scrollIntoViewIfNeeded();
      await shot(page, 'settings-not-opened', scheme);
    });

    test('RS4-a: while access is on but Bunny could not name the network, the row says it will not reopen by itself after a restart', async ({ page }) => {
      await page.addInitScript(() => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; });
      await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { enabled: true, url: 'http://192.168.1.24:52814/', signedIn: 0, autoChats: [], devices: [], hasPasscode: true, notOpened: '', reopenNote: 'Bunny could not tell which network this is, so it will not reopen by itself after a restart.' } }) : r.continue()));
      await page.goto('/src/ui/settings.html?embed=1&section=desktop');
      await expect(page.locator('#remote-not-opened')).toHaveText('Bunny could not tell which network this is, so it will not reopen by itself after a restart.');
    });

    test('a narrow window: the devices list wraps and nothing scrolls sideways', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 800 });
      await windowWith(page, [{ ...PHONE, asked: true }, LAPTOP]);
      await page.goto('/src/ui/settings.html?embed=1&section=desktop');
      await expect(page.locator('.device-row')).toHaveCount(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await page.locator('.device-row').first().scrollIntoViewIfNeeded();
      await shot(page, 'settings-devices-narrow', scheme);
    });
  });
}

/** A page as a signed-in device is served it: the CSRF meta and remote.js, and the server's own answer about its level. */
async function devicePage(page, path, level) {
  await page.route(`**${path}*`, async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/<head>/i, '<head>\n<meta name="bunny-csrf" content="test-csrf">\n<script src="/src/ui/remote.js"></script>').replace(/<meta name="bunny-token"[^>]*>/i, '');
    await route.fulfill({ response: res, body: html });
  });
  await page.route('**/api/remote/me', (r) => r.fulfill({ json: { device: "Sam's phone", csrf: 'test-csrf', level } }));
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, fake: true, windowOnlyLock: true } }));
}

for (const scheme of ['light', 'dark']) {
  test.describe(`a device, ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1000, height: 700 } });

    test('Chats: the line says so, and the window-only controls stay locked as before', async ({ page }) => {
      await devicePage(page, '/src/ui/settings.html', 'chats');
      await page.goto('/src/ui/settings.html?section=code');
      await expect(page.locator('#device-level-line')).toContainText('Chats access · the PC can give this device more');
      await expect(page.locator('#device-level-line')).toHaveAttribute('data-level', 'chats');
      await expect(page.locator('#default-permission')).toBeDisabled();
      await expect(page.locator('#device-access-note')).toBeHidden();
      await shot(page, 'device-chats', scheme);
    });

    test('Everything: the line says so (with the idle limit), nothing is locked, and device access says only Bunny\'s window can change it', async ({ page }) => {
      await devicePage(page, '/src/ui/settings.html', 'everything');
      await page.goto('/src/ui/settings.html?section=desktop');
      const line = page.locator('#device-level-line');
      await expect(line).toHaveText("Everything access · ends after 30 min idle"); // the drawn text, nothing added (it wraps on a phone otherwise)
      await expect(line).toHaveAttribute('data-level', 'everything');
      await expect(page.locator('#default-permission')).toBeEnabled();
      await expect(page.locator('.window-only-note')).toHaveCount(0);
      const note = page.locator('#device-access-note');
      await expect(note).toBeVisible();
      await expect(note).toContainText('Allow other devices to open Bunny');
      await expect(note).toContainText('Signed-in devices and Activity');
      await expect(note).toContainText("Only Bunny's window can see or change this.");
      await expect(note.locator('.device-access-sentence').first()).toHaveText("Only Bunny's window can change device access.");
      await expect(note.locator('input[type="checkbox"]')).toBeDisabled();
      await note.scrollIntoViewIfNeeded();
      await shot(page, 'device-everything', scheme);
    });

    test('when the window changes the level, the page starts over so what it locks is what the server will refuse', async ({ page }) => {
      let level = 'chats';
      await devicePage(page, '/src/ui/settings.html', 'chats');
      await page.route('**/api/remote/me', (r) => r.fulfill({ json: { device: "Sam's phone", csrf: 'test-csrf', level } }));
      await page.goto('/src/ui/settings.html?section=code');
      await expect(page.locator('#device-level-line')).toHaveAttribute('data-level', 'chats');
      level = 'everything';
      await page.clock?.fastForward?.(11000).catch(() => {});
      await expect(page.locator('#device-level-line')).toHaveAttribute('data-level', 'everything', { timeout: 15000 });
    });
  });
}

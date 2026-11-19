import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// v0.1.14 PHONE-LAYOUT (the owner: "the mobile view is not fixed and properly visible, the chat box is cut"): on a phone the whole composer stays inside the screen. The row under the box and
// Send are not cut at the bottom or the right edge, the model chip ends before Send, and nothing scrolls. Cause found: a device's page carries a line across the top since v0.1.13
// ("Chats access"/"Everything access"); the layout rule that keeps the window-high app inside the page knew only the window's own "Open to other devices" line, so on a phone the app
// was pushed 30 px past the bottom. The sizes are the owner's (720 wide) and common phones; the short heights stand for the keyboard being open (the layout resizes with it).
const row = (providerId, providerName, id, displayName, freeKind) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength: 128000 });
const MODELS = [row('nvidia', 'NVIDIA', 'nemotron-3-ultra-550b-a55b', 'NVIDIA: Nemotron 3 Ultra 550B A55B (free)', 'free'), row('quill', 'Quill', 'otter', 'Otter 3 Coder', null)];
const SIZES = [[360, 640], [390, 844], [412, 915], [720, 800], [360, 360], [390, 330], [720, 420]]; // the last three: the keyboard is open

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
});

/** How the page is reached: Bunny's window, the window with its "Open to other devices" line, or a signed-in device at either level. */
async function open(page, how) {
  await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
  if (how === 'window-line') {
    await page.route('**/api/remote', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { enabled: true, signedIn: 1, autoChats: [], devices: [] } }) : r.continue()));
    await page.addInitScript(() => { window.bunnyDesktop = {}; });
  }
  if (how === 'device-chats' || how === 'device-everything') {
    await page.route('**/src/ui/index.html*', async (route) => {
      const res = await route.fetch();
      const html = (await res.text()).replace(/<head>/i, '<head>\n<meta name="bunny-csrf" content="c">\n<script src="/src/ui/remote.js"></script>').replace(/<meta name="bunny-token"[^>]*>/i, '');
      await route.fulfill({ response: res, body: html });
    });
    await page.route('**/api/remote/me', (r) => r.fulfill({ json: { device: 'Phone', csrf: 'c', level: how === 'device-everything' ? 'everything' : 'chats' } }));
  }
  await page.goto(how.startsWith('device') ? '/src/ui/index.html' : '/');
  if (how === 'window-line') await expect(page.locator('#remote-bar')).toBeVisible();
  if (how.startsWith('device')) await expect(page.locator('#device-level-line')).toBeVisible();
  await expect(page.locator('#send')).toBeVisible();
}

for (const how of ['window', 'window-line', 'device-chats', 'device-everything']) {
  for (const auto of [false, true]) {
    for (const [w, h] of SIZES) {
      test(`${how}, ${auto ? 'Auto' : 'a chosen model'}, ${w}x${h}: the composer, the row under it and Send are inside the screen and nothing scrolls`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await page.addInitScript((a) => { localStorage.setItem('bunny.workMode', 'chat'); localStorage.setItem('bunny.modelAuto', a ? '1' : '0'); }, auto);
        await open(page, how);
        await page.waitForTimeout(300);
        const m = await page.evaluate(() => {
          const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width }; };
          return { vw: window.innerWidth, vh: window.innerHeight, docW: document.documentElement.scrollWidth, docH: document.documentElement.scrollHeight, app: r('.app'), composer: r('.composer'), under: r('.composer-under'), send: r('#send'), chip: r('#picker-button'), input: r('#input') };
        });
        const inside = (name, b) => { if (!b) return; expect(b.right, name + ' right edge').toBeLessThanOrEqual(m.vw + 0.5); expect(b.bottom, name + ' bottom edge').toBeLessThanOrEqual(m.vh + 0.5); expect(b.left, name + ' left edge').toBeGreaterThanOrEqual(-0.5); };
        expect(m.docW, 'no sideways scroll').toBeLessThanOrEqual(m.vw);
        expect(m.docH, 'no vertical scroll').toBeLessThanOrEqual(m.vh + 1);
        inside('the app', m.app); inside('the composer', m.composer); inside('the row under the box', m.under); inside('Send', m.send);
        expect(m.send.width, 'Send keeps its size').toBeGreaterThanOrEqual(35);
        if (m.chip && m.chip.width > 0) expect(m.chip.right, 'the chip ends before Send').toBeLessThanOrEqual(m.send.left - 4);
        expect(m.input.width, 'the message box has room to type').toBeGreaterThan(120);
      });
    }
  }
}

test('the page asks the phone to resize its layout when the keyboard opens (so the composer rises above it), and keeps the safe areas', async ({ request }) => {
  const html = await (await request.get('/src/ui/index.html')).text();
  expect(html).toMatch(/<meta name="viewport"[^>]*interactive-widget=resizes-content/);
  expect(html).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/);
});

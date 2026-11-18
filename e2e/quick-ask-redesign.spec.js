import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

// QUICK-UI (v0.1.13): the Quick ask bar redesign (Design's page, version 2, option A: a ~92% opaque pill over a transparent window), 13 changes.
// Like quick-ask-bar.spec.js this opens the bar's own page at the real window size with a stand-in for the bridge (the Electron window itself is not run here);
// the stand-in records every call, so the window size, the keys and the buttons can be checked. Invented profile only: nothing here reads a real chat or key.
const ROOT = resolve('.');
let origin = '';
let staticServer;
test.beforeAll(async () => {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2' };
  staticServer = createServer(async (req, res) => {
    const target = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    const rel = target.startsWith(ROOT + sep) ? target.slice(ROOT.length + 1).split(sep).join('/') : '';
    if (!/^(electron\/quick-ask|src\/ui)\//.test(rel)) { res.writeHead(404).end(); return; }
    try { res.writeHead(200, { 'content-type': types[extname(target)] ?? 'application/octet-stream' }).end(await readFile(target)); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${staticServer.address().port}`;
});
test.afterAll(() => new Promise((r) => staticServer.close(r)));

const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Open the bar at its window width, with a recording stand-in for the bridge. `window.__calls` lists what the page asked for; `window.__emit(event)` plays an answer event. */
async function openBar(page, { scheme = 'light', config = {}, ask = 'ok' } = {}) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.setViewportSize({ width: 640, height: 80 });
  await page.addInitScript(({ pixel, config: cfg, askMode }) => {
    window.__calls = [];
    window.__handler = null;
    const note = (name, ...args) => { window.__calls.push([name, ...args]); };
    window.quickAsk = {
      captureScreenshot: async () => ({ ok: true, data: pixel }),
      pickFile: async () => ({ ok: false, cancelled: true }),
      dropFile: async () => ({ ok: true }),
      submit: async () => ({ ok: false }),
      ask: (text) => { note('ask', text); return askMode === 'wait' ? new Promise(() => {}) : Promise.resolve({ ok: true }); },
      stop: async () => { note('stop'); return { ok: true }; },
      openInBunny: async (target) => { note('open', target ?? null); return { ok: true }; },
      resize: async (h) => { note('resize', h); return { ok: true }; },
      onAnswer: (fn) => { window.__handler = fn; return () => {}; },
      init: async () => cfg,
      close: async () => { note('close'); return { ok: true }; },
      escHandled: async () => { note('escHandled'); return { ok: true }; },
      onEscape: (fn) => { window.__esc = fn; return () => {}; },
    };
    window.__emit = (event) => window.__handler?.(event);
  }, { pixel: PIXEL, config, askMode: ask });
  await page.goto(`${origin}/electron/quick-ask/bar.html`);
}
const calls = (page, name) => page.evaluate((n) => window.__calls.filter((c) => c[0] === n), name);
const lastResize = async (page) => { const r = await calls(page, 'resize'); return r.length ? r.at(-1)[1] : null; };

for (const scheme of ['light', 'dark']) {
  test(`1: Stop and Copy have real icons that are drawn, not 0 x 0 (${scheme})`, async ({ page }) => {
    await openBar(page, { scheme, ask: 'wait' });
    await page.locator('#text').fill('hello');
    await page.locator('#go').click();
    const stop = page.locator('#go svg');
    await expect(stop).toHaveCount(1);
    const stopBox = await stop.boundingBox();
    expect(stopBox.width).toBeGreaterThan(8);
    expect(stopBox.height).toBeGreaterThan(8);
    expect(await stop.evaluate((n) => n.namespaceURI)).toBe('http://www.w3.org/2000/svg');
    await page.evaluate(() => window.__emit({ type: 'delta', text: 'Here is the answer.' }));
    await page.evaluate(() => window.__emit({ type: 'done', model: 'Auto', finished: true }));
    const copy = page.locator('#go svg, #copy svg').first();
    await expect(copy).toBeVisible();
    const copyBox = await copy.boundingBox();
    expect(copyBox.width).toBeGreaterThan(8);
    expect(copyBox.height).toBeGreaterThan(8);
    // the thinking line has one indent, not two
    await page.evaluate(() => window.__emit({ type: 'start' }));
  });
}

test('2: the window is only as tall as the pill, and grows for the + menu and for an answer', async ({ page }) => {
  await openBar(page);
  await expect.poll(() => lastResize(page)).not.toBeNull();
  const rest = await lastResize(page);
  expect(rest).toBeLessThanOrEqual(130); // the pill, not the 300 of before (tightened to about 70 when the pill is redrawn)
  expect(rest).toBeGreaterThanOrEqual(60);
  await page.locator('#plus').click();
  const withMenu = await lastResize(page);
  expect(withMenu).toBeGreaterThan(rest + 60);
  const menuBottom = await page.locator('#menu').evaluate((m) => m.getBoundingClientRect().bottom);
  expect(withMenu).toBeGreaterThanOrEqual(menuBottom); // the menu is not cut off by the window
  await page.locator('#plus').click(); // closes
  await expect.poll(() => lastResize(page)).toBeLessThanOrEqual(130);
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'delta', text: 'A line of the answer.\n\n'.repeat(12) }));
  await expect.poll(() => lastResize(page)).toBeGreaterThan(rest + 100);
});

test('3: Esc does one thing at a time: closes the + menu first, then stops a running answer, then closes the bar', async ({ page }) => {
  await openBar(page, { ask: 'ok' });
  // the + menu is open: Esc closes the menu, the focus goes back to +, the bar stays
  await page.locator('#plus').click();
  await expect(page.locator('#menu')).toBeVisible();
  await page.evaluate(() => window.__esc());
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#plus')).toBeFocused();
  expect(await calls(page, 'escHandled')).toHaveLength(1);
  expect(await calls(page, 'close')).toHaveLength(0);
  // an answer is coming: Esc stops it (what arrived stays), and the bar stays
  await page.locator('#text').fill('hello');
  await page.locator('#go').click();
  await page.evaluate(() => window.__emit({ type: 'delta', text: 'Part of an answer' }));
  await page.evaluate(() => window.__esc());
  expect(await calls(page, 'stop')).toHaveLength(1);
  expect(await calls(page, 'escHandled')).toHaveLength(2);
  expect(await calls(page, 'close')).toHaveLength(0);
  await page.evaluate(() => window.__emit({ type: 'stopped' }));
  // nothing left to handle: Esc closes the bar
  await page.evaluate(() => window.__esc());
  expect(await calls(page, 'close')).toHaveLength(1);
});

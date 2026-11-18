import { test, expect } from '@playwright/test';

// Bunny as a web app, in a browser tab on this computer (127.0.0.1 is a secure context): the manifest is linked and valid, its icons load, the service worker registers at the root scope,
// it keeps no page and no API answer, and with no network a page navigation gets the "Bunny is not running" page.
test('the page links a valid manifest whose icons load at their sizes, with the theme colours and the iPhone home-screen meta', async ({ page }) => {
  await page.goto('/src/ui/index.html');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBe('/manifest.webmanifest');
  const manifest = await (await page.request.get(href)).json();
  expect([manifest.name, manifest.short_name, manifest.start_url, manifest.scope, manifest.display]).toEqual(['Bunny AI', 'Bunny', '/', '/', 'standalone']);
  expect(manifest.icons.some((i) => i.sizes === '192x192' && i.purpose === 'any')).toBe(true);
  expect(manifest.icons.some((i) => i.sizes === '512x512' && i.purpose === 'any')).toBe(true);
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons.filter((i) => i.type === 'image/png')) {
    const size = await page.evaluate(async (src) => { const img = new Image(); img.src = src; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }, icon.src);
    const wanted = Number(icon.sizes.split('x')[0]);
    expect(size, icon.src).toEqual([wanted, wanted]);
  }
  await expect(page.locator('meta[name="theme-color"][media="(prefers-color-scheme: light)"]')).toHaveAttribute('content', '#faf9f6');
  await expect(page.locator('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]')).toHaveAttribute('content', '#141518');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  expect((await page.request.get('/icons/apple-touch-icon.png')).status()).toBe(200);
});

test('the service worker registers at the root scope; it keeps static files only (no page, nothing from /api/); offline, a page is the "Bunny is not running" page', async ({ page, context }) => {
  await page.goto('/src/ui/index.html');
  const reg = await page.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: new URL(r.scope).pathname, script: new URL(r.active.scriptURL).pathname }; });
  expect(reg).toEqual({ scope: '/', script: '/sw.js' });
  // make the page use the worker, load the app's files and call the API
  await page.reload();
  await page.waitForTimeout(800);
  await page.evaluate(() => fetch('/api/sessions').then((r) => r.status));
  const kept = await page.evaluate(async () => {
    const out = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(`${name} ${new URL(req.url).pathname}`);
    return out;
  });
  expect(kept.length).toBeGreaterThan(0);
  for (const line of kept) {
    expect(line).toMatch(/^bunny-static-/);
    expect(line, 'nothing from the API is kept').not.toMatch(/\/api\//);
    const path = line.split(' ')[1];
    if (path.endsWith('.html')) expect(path, 'no page is kept but the offline page').toBe('/offline.html');
    expect(path).not.toMatch(/token\.js|signin\.js|remote\.js/);
  }
  // no network: a page navigation falls back to the offline page (and it does not hold a token)
  await context.setOffline(true);
  await page.goto('/src/ui/index.html').catch(() => {});
  await expect(page.locator('h1')).toHaveText('Bunny is not running');
  expect(await page.content()).not.toMatch(/bunny-token|bunny-csrf/);
  await context.setOffline(false);
});

test('the sign-in and "not running" pages link the manifest too, and the old worker\'s scope is gone', async ({ page }) => {
  for (const path of ['/offline.html', '/src/ui/signin.html']) {
    await page.goto(path);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  }
  await page.goto('/src/ui/index.html');
  await page.waitForTimeout(500);
  const scopes = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname));
  expect(scopes).toEqual(['/']);
});

test('Chrome itself finds nothing in the way of installing it (the installability check the browser runs)', async ({ page, context }) => {
  await page.goto('/src/ui/index.html');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForTimeout(800);
  const cdp = await context.newCDPSession(page);
  const result = await cdp.send('Page.getInstallabilityErrors');
  expect(result.installabilityErrors.map((e) => e.errorId), 'no installability errors').toEqual([]);
});

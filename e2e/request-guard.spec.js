import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';

import { PORT, E2E_TOKEN } from './setup.js';

// S-1 in a real browser. The page is NOT given the token by the config here: it must
// get it from the server, the way a person's window does.
test.use({ extraHTTPHeaders: {} });

const API = `http://127.0.0.1:${PORT}`;
const authed = { 'x-bunny-token': E2E_TOKEN };

test('T-14 a page loaded from the server can use the API, with the service worker too', async ({ page }) => {
  await page.goto('/');
  expect(await page.evaluate(() => fetch('/api/settings').then((r) => r.status))).toBe(200);
  await page.reload(); // the service worker is now in charge of the shell
  expect(await page.evaluate(() => fetch('/api/settings').then((r) => r.status))).toBe(200);
  expect(await page.evaluate(() => document.querySelector('meta[name="bunny-token"]')?.content?.length)).toBeGreaterThan(20);
});

test('a page with no token is told what to do, in words', async ({ request }) => {
  const res = await request.get(`${API}/api/settings`);
  expect(res.status()).toBe(403);
  expect((await res.json()).message).toMatch(/out of date/i);
});

test('T-15 a page on another port cannot add a local program', async ({ page, request }) => {
  const evil = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<script>
      fetch('${API}/api/mcp', { method: 'POST', mode: 'no-cors', body: '{"command":"calc","confirmLocal":true}' })
        .finally(() => { document.title = 'done'; });
    </script>`);
  });
  await new Promise((r) => evil.listen(0, '127.0.0.1', r));
  try {
    await page.goto(`http://127.0.0.1:${evil.address().port}/`);
    await expect(page).toHaveTitle('done');
    const list = await (await request.get(`${API}/api/mcp`, { headers: authed })).json();
    expect(list.filter((s) => s.command === 'calc')).toEqual([]);
  } finally {
    evil.closeAllConnections?.();
    await new Promise((r) => evil.close(r));
  }
});

test('T-16 an artifact frame cannot reach the API, and still renders', async ({ page, request }) => {
  const made = await (await request.post(`${API}/api/artifacts`, {
    headers: authed,
    data: { title: 'Probe', kind: 'html', content: '<h1 id="h">hello</h1><script>fetch(location.origin + "/api/settings").then(r => parent.postMessage("status:" + r.status, "*"), () => parent.postMessage("blocked", "*"));</script>' },
  })).json();
  await page.goto('/');
  const got = page.evaluate(() => new Promise((resolve) => addEventListener('message', (e) => resolve(String(e.data)), { once: true })));
  await page.evaluate((id) => {
    const f = document.createElement('iframe');
    f.id = 'probe';
    f.src = `/api/artifacts/${id}/raw`;
    document.body.appendChild(f);
  }, made.id);
  expect(await got).not.toBe('status:200');
  await expect(page.frameLocator('#probe').locator('#h')).toHaveText('hello');
  await request.delete(`${API}/api/artifacts/${made.id}`, { headers: authed });
});

test('Q2-23: a stale token (the server restarted) is refreshed and the call retried, not failed silently', async ({ page }) => {
  await page.goto('/');
  // pretend the server restarted since this page loaded: the page holds an old token
  await page.evaluate(() => { document.querySelector('meta[name="bunny-token"]').content = 'stale0stale0stale0stale0stale0stale0stale0stale0stale0stale0stale0stale0abcd'; });
  expect(await page.evaluate(() => fetch('/api/settings').then((r) => r.status))).toBe(200);
  expect(await page.evaluate(() => document.querySelector('meta[name="bunny-token"]').content)).not.toMatch(/^stale/);
  await expect(page.locator('#bunny-restarted')).toHaveCount(0);
});

test('Q2-23: when the token cannot be refreshed the window says Bunny restarted, with a Reload link', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => { document.querySelector('meta[name="bunny-token"]').content = 'stale0stale0stale0stale0stale0stale0stale0stale0stale0stale0stale0stale0abcd'; });
  await page.route('**/src/ui/index.html*', (route) => route.abort());
  const status = await page.evaluate(() => fetch('/api/settings').then((r) => r.status));
  expect(status).toBe(403);
  await expect(page.locator('#bunny-restarted')).toContainText('restarted');
  await expect(page.locator('#bunny-restarted a')).toHaveText('Reload');
});

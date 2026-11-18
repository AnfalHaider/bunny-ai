import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resetProfile, connectAndChat } from './helpers.js';

// v0.1.13 FONTS: thirteen bundled fonts for Interface font and Response font. Each applies to the interface and to replies and its file loads.
const manifest = JSON.parse(readFileSync(new URL('../src/ui/fonts/manifest.json', import.meta.url), 'utf8'));

test.describe.configure({ mode: 'serial' });
let sessionId;
test.beforeAll(async ({ request }) => { await resetProfile(request); });

test('the two dropdowns offer the groups as drawn, the first choice first, the old four kept', async ({ page, request }) => {
  await resetProfile(request);
  await page.goto('/src/ui/settings.html?section=appearance');
  for (const [key, first] of [['interfaceFont', 'Default · System'], ['responseFont', 'Match interface']]) {
    const sel = page.locator(`select[data-key="${key}"]`);
    const groups = await sel.locator('optgroup').evaluateAll((gs) => gs.map((g) => ({ label: g.label, options: [...g.querySelectorAll('option')].map((o) => o.textContent) })));
    expect(await sel.locator('> option').first().textContent()).toBe(first);
    expect(groups.map((g) => g.label)).toEqual(['Sans', 'Easy to read', 'Rounded', 'Serif', 'Monospace']);
    expect(groups[0].options).toEqual(['Segoe UI', 'Inter', 'Source Sans 3', 'IBM Plex Sans']);
    expect(groups[1].options).toEqual(['Atkinson Hyperlegible', 'Lexend']);
    expect(groups[2].options).toEqual(['Nunito', 'Quicksand']);
    expect(groups[3].options).toEqual(['Serif', 'Lora', 'Literata', 'Source Serif 4', 'Noto Serif']);
    expect(groups[4].options).toEqual(['Monospace', 'JetBrains Mono', 'IBM Plex Mono']);
  }
});

test('About lists every bundled font with its licence text', async ({ page }) => {
  await page.goto('/src/ui/settings.html?section=about');
  await page.locator('#licences summary').click();
  await expect(page.locator('#licence-list li')).toHaveCount(13);
  const href = await page.locator('#licence-list li a').first().getAttribute('href');
  const res = await page.request.get(new URL(href, page.url()).toString());
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('SIL OPEN FONT LICENSE Version 1.1');
});

test('connect and send one message (the reply the fonts are checked on)', async ({ page, request }) => {
  await connectAndChat(page, 'Say hello in five words.');
  sessionId = (await (await request.get('/api/sessions')).json())[0].id;
  expect(sessionId).toBeTruthy();
});

for (const f of manifest.fonts) {
  test(`${f.name}: applies to the interface and to replies, and its file loads`, async ({ page, request }) => {
    await request.put('/api/settings', { data: { interfaceFont: f.id, responseFont: 'match' } });
    await page.goto(`/?s=${sessionId}`);
    const reply = page.locator('.msg.assistant .body').last();
    await expect(reply).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain(`Bunny ${f.name}`);
    expect(await reply.evaluate((el) => getComputedStyle(el).fontFamily)).toContain(`Bunny ${f.name}`); // "Match interface"
    // only the response font changes: a different interface font, this one for replies
    await request.put('/api/settings', { data: { interfaceFont: 'system', responseFont: f.id } });
    await page.reload();
    await expect(page.locator('.msg.assistant .body').last()).toBeVisible();
    expect(await page.locator('.msg.assistant .body').last().evaluate((el) => getComputedStyle(el).fontFamily)).toContain(`Bunny ${f.name}`);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).not.toContain('Bunny');
    // the file itself loads from this server (a face is "loaded" only after its file arrived)
    const loaded = await page.evaluate(async (name) => { const faces = await document.fonts.load(`16px "Bunny ${name}"`, 'Hello'); return faces.length > 0 && faces.every((x) => x.status === 'loaded'); }, f.name);
    expect(loaded).toBe(true);
  });
}

test('on a device page (served with the device scripts) the font files load too', async ({ page, request }) => {
  await request.put('/api/settings', { data: { interfaceFont: 'lora', responseFont: 'jetbrains-mono' } });
  const statuses = [];
  page.on('response', (r) => { if (/\/fonts\/.*\.woff2$/.test(r.url())) statuses.push(r.status()); });
  await page.route('**/src/ui/index.html*', async (route) => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/<head>/i, '<head>\n<meta name="bunny-csrf" content="test-csrf">\n<script src="/src/ui/remote.js"></script>').replace(/<meta name="bunny-token"[^>]*>/i, '');
    await route.fulfill({ response: res, body: html });
  });
  await page.route('**/api/remote/me', (r) => r.fulfill({ json: { device: "Sam's phone", csrf: 'test-csrf', level: 'chats' } }));
  await page.goto(`/?s=${sessionId}`);
  await expect(page.locator('.msg.assistant .body').last()).toBeVisible();
  await page.evaluate(() => Promise.all([document.fonts.load('16px "Bunny Lora"', 'Hello'), document.fonts.load('16px "Bunny JetBrains Mono"', 'Hello')]));
  expect(statuses.length).toBeGreaterThanOrEqual(2);
  expect(statuses.every((s) => s === 200)).toBe(true);
});

test.afterAll(async ({ request }) => {
  await request.put('/api/settings', { data: { interfaceFont: 'system', responseFont: 'match' } });
  await resetProfile(request);
});

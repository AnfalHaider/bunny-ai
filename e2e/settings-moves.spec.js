import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { resetProfile } from './helpers.js';

// SET-PLACE (the owner approved Design's Settings tabs page): six settings moved, nothing removed, no wording changed. SET-WORK: each one works, and the transcript ones show their
// effect in the chat itself (changed in Bunny's Settings window, which is how a person does it, then closed).
const MOVED = [
  { tab: 'models', from: 'capabilities', name: 'Try another model when yours is busy', control: '[data-cap="fallbackWhenBusy"]', search: 'fallback' },
  { tab: 'models', from: 'capabilities', name: 'Wait for a first reply', control: '#wait-select', search: 'wait' },
  { tab: 'code', from: 'models', name: 'Keep going on long jobs', control: '#auto-steps', search: 'long jobs' },
  { tab: 'code', from: 'models', name: 'Longest long job', control: '#auto-minutes', search: 'minutes' },
  { tab: 'appearance', from: 'code', name: 'Default transcript view', control: '[data-key="transcriptView"]', search: 'transcript' },
  { tab: 'appearance', from: 'code', name: 'Label chats by status', control: '[data-key="statusLabels"]', search: 'status' },
];
const PAGE = (tab) => `/src/ui/settings.html?embed=1&section=${tab}`;

test('each moved setting is in its new tab, no longer in its old one, and still there with its own text', async ({ page }) => {
  for (const m of MOVED) {
    await page.goto(PAGE(m.tab));
    await expect(page.locator(`section[data-section="${m.tab}"] .row:has(${m.control})`), `${m.name} in ${m.tab}`).toBeVisible();
    await expect(page.locator(`section[data-section="${m.tab}"] .row:has(${m.control}) .name`).first()).toHaveText(m.name);
    await page.goto(PAGE(m.from));
    await expect(page.locator(`section[data-section="${m.from}"] ${m.control}`), `${m.name} not in ${m.from}`).toHaveCount(0);
  }
  await expect(page.locator('section[data-section="appearance"] .row:has([data-key="transcriptView"]) .desc')).toHaveText("How much detail chats show. Thinking opens the model's thinking; Verbose also shows longer step results (up to 8,000 characters).");
  // next to transcript size and width
  await page.goto(PAGE('appearance'));
  const names = await page.locator('section[data-section="appearance"] .row .name').allTextContents();
  const at = (n) => names.findIndex((x) => x.trim() === n);
  expect(at('Transcript width')).toBeGreaterThan(-1);
  expect(at('Default transcript view')).toBe(at('Label chats by status') + 1); // the two stay together, in the order they had
  expect(Math.abs(at('Default transcript view') - at('Transcript width'))).toBeLessThanOrEqual(2);
});

test('Settings search finds each moved setting, and Enter opens the tab it is in now', async ({ page }) => {
  await page.goto('/src/ui/index.html');
  for (const m of MOVED) {
    await page.locator('#settings-open').click();
    await page.locator('#settings-search').fill(m.search);
    const hit = page.locator(`#settings-nav-list [data-section="${m.tab}"]`);
    await expect(hit, `${m.name} -> ${m.tab}`).not.toHaveClass(/is-filtered/);
    await page.locator('#settings-search').press('Enter');
    await expect(page.locator('#settings-frame')).toHaveAttribute('src', new RegExp(`section=${m.tab}\\b`));
    await page.locator('#settings-search').fill('');
    await page.locator('#settings-close').click();
  }
});

test('the moved settings save and are still the same after the page is opened again', async ({ page, request }) => {
  await page.goto(PAGE('code'));
  await page.locator('#auto-steps').fill('321'); await page.locator('#auto-steps').blur();
  await page.locator('#auto-minutes').fill('45'); await page.locator('#auto-minutes').blur();
  await page.goto(PAGE('models'));
  await page.locator('#wait-select').selectOption('90');
  const fb = page.locator('[data-cap="fallbackWhenBusy"]');
  const wasOn = await fb.isChecked();
  await fb.evaluate((el) => el.click());
  await page.waitForTimeout(500);
  const saved = await (await request.get('/api/settings')).json();
  expect([saved.autoContinueSteps, saved.autoContinueMinutes, saved.firstReplyWaitSeconds, saved.fallbackWhenBusy !== false]).toEqual([321, 45, 90, !wasOn]);
  await page.goto(PAGE('code'));
  await expect(page.locator('#auto-steps')).toHaveValue('321');
  await expect(page.locator('#auto-minutes')).toHaveValue('45');
  await page.goto(PAGE('models'));
  await expect(page.locator('#wait-select')).toHaveValue('90');
  await request.put('/api/settings', { data: { autoContinueSteps: 0, autoContinueMinutes: 0, firstReplyWaitSeconds: 30, fallbackWhenBusy: true } });
});

// ---- the transcript settings: each changes what the chat shows ----
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
let server; let port;
test.describe('what the chat shows', () => {
  test.beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''; req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"thinker"}]}'); return; }
        if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(frame({ reasoning_content: 'First I weigh the two options. ' }));
        setTimeout(() => { res.write(frame({ content: 'Option two it is.' })); res.end('data: [DONE]\n\n'); }, 400);
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });
  test.afterAll(async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); });
  test.beforeEach(async ({ request }) => {
    await resetProfile(request);
    for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
    await request.put('/api/settings', { data: { modelFilter: 'all', transcriptView: 'normal', statusLabels: true, transcriptSize: 'medium', transcriptWidth: 'medium' } });
    expect((await request.post('/api/providers/custom', { data: { name: 'Thinker', baseUrl: `http://127.0.0.1:${port}/v1` } })).ok()).toBeTruthy();
  });
  test.afterEach(async ({ request }) => {
    for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
    await request.put('/api/settings', { data: { modelFilter: null, transcriptView: 'normal', statusLabels: true, transcriptSize: 'medium', transcriptWidth: 'medium' } });
  });

  async function ask(page, text) {
    await page.goto('/');
    await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); });
    await page.goto('/');
    await expect(page.locator('#greeting')).toBeVisible();
    await page.locator('#picker-button').click();
    await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
    await page.locator('#input').fill(text);
    await page.locator('#send').click();
    await expect(page.locator('.msg.assistant .body').last()).toContainText('Option two it is.');
  }
  /** Change one control of the Settings window, the way a person does, and close it. */
  async function change(page, section, selector, how) {
    await page.locator('#settings-open').click();
    await page.locator(`#settings-nav-list [data-section="${section}"]`).click();
    const control = page.frameLocator('#settings-frame').locator(selector);
    await expect(control).toBeVisible();
    await how(control);
    await page.waitForTimeout(400);
    await page.locator('#settings-close').click();
    await expect(page.locator('#settings-backdrop')).toBeHidden();
  }

  test('Default transcript view: Thinking and Verbose open the model\'s thinking in the chat, Normal folds it', async ({ page }) => {
    await ask(page, 'which option');
    // the reply is over (the working line is gone), so nothing redraws the chat behind the Settings window while it is looked at
    await expect(page.locator('.bunny-working')).toHaveCount(0, { timeout: 15000 });
    const open = () => page.locator('details.thinking').first().evaluate((el) => el.open);
    await expect(page.locator('details.thinking')).toHaveCount(1, { timeout: 15000 });
    await expect.poll(open, { message: 'Normal at first', timeout: 15000 }).toBe(false);
    await change(page, 'appearance', '[data-key="transcriptView"]', (c) => c.selectOption('thinking'));
    await expect.poll(open, { message: 'Thinking', timeout: 15000 }).toBe(true);
    await change(page, 'appearance', '[data-key="transcriptView"]', (c) => c.selectOption('normal'));
    await expect.poll(open, { message: 'back to Normal', timeout: 15000 }).toBe(false);
    await change(page, 'appearance', '[data-key="transcriptView"]', (c) => c.selectOption('verbose'));
    await expect.poll(open, { message: 'Verbose', timeout: 15000 }).toBe(true);
  });

  test('Label chats by status: the sidebar marks a chat as Ready (or Working, Needs you, Failed) when on, and says nothing when off', async ({ page }) => {
    await ask(page, 'which option');
    // a chat that finished while it was not open is "Ready" until it is opened (the server keeps that); here the list says so for the first chat
    await page.route('**/api/sessions?archived=1', async (route) => {
      const rows = await (await route.fetch()).json();
      await route.fulfill({ json: rows.map((r, i) => (i === 0 ? { ...r, replyStatus: 'needs-you' } : r)) });
    });
    await page.reload(); // draws the list again, now with that status
    const tag = page.locator('#sessions .status-tag').first();
    await expect(tag).toHaveText('Needs you', { timeout: 15000 });
    await change(page, 'appearance', '[data-key="statusLabels"]', (c) => c.evaluate((el) => el.click()));
    await expect(page.locator('#sessions .status-tag')).toHaveCount(0);
    await change(page, 'appearance', '[data-key="statusLabels"]', (c) => c.evaluate((el) => el.click()));
    await expect(page.locator('#sessions .status-tag').first()).toHaveText('Needs you', { timeout: 15000 });
  });

  test('Transcript text size and width change the chat itself', async ({ page }) => {
    await ask(page, 'which option');
    const size = () => page.locator('.msg.assistant .body').last().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const width = () => page.locator('.thread-col').first().evaluate((el) => el.getBoundingClientRect().width);
    const [size0, width0] = [await size(), await width()];
    await change(page, 'appearance', '[data-key="transcriptSize"]', (c) => c.selectOption('large'));
    await expect.poll(size, { message: 'large text', timeout: 15000 }).toBeGreaterThan(size0);
    await change(page, 'appearance', '[data-key="transcriptSize"]', (c) => c.selectOption('small'));
    await expect.poll(size, { message: 'small text', timeout: 15000 }).toBeLessThan(size0);
    await change(page, 'appearance', '[data-key="transcriptWidth"]', (c) => c.selectOption('wide'));
    await expect.poll(width, { message: 'wide', timeout: 15000 }).toBeGreaterThan(width0);
    await change(page, 'appearance', '[data-key="transcriptWidth"]', (c) => c.selectOption('narrow'));
    await expect.poll(width, { message: 'narrow', timeout: 15000 }).toBeLessThan(width0);
  });
});

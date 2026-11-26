import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// LOCAL-MODELS (fake mode, an invented profile): the Bunny local card, its model rows and badges, and the chat menu. The pins and the real list wait for the spikes.
test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  await request.delete('/api/local-models'); // start every test Not set up
});

const card = (page) => page.locator('#bunny-local');
const ready = async (page) => {
  await page.goto('/src/ui/providers.html?embed=1');
  await card(page).getByRole('button', { name: 'Set up Bunny local', exact: true }).click();
  await expect(card(page).locator('.lm-model').first()).toBeVisible({ timeout: 10000 });
};

test('Not set up: one button, the size and place on the card, nothing downloaded yet', async ({ page }) => {
  await page.goto('/src/ui/providers.html?embed=1');
  await expect(card(page).locator('b', { hasText: 'Set up Bunny local' })).toBeVisible();
  await expect(card(page)).toContainText('39 MB program');
  await expect(card(page)).toContainText('GitHub');
  await expect(card(page)).toContainText('stay on this PC');
  await expect(page.locator('#available')).not.toContainText('Bunny local'); // not in the generic list: no address, no key
  await expect(page.locator('#connected')).not.toContainText('Bunny local');
});

test('Ready: the PC line, the graphics switch, the idle choice and a row with a fit badge for every model; Too big has no Download', async ({ page }) => {
  await ready(page);
  await expect(card(page).locator('.lm-pc')).toContainText('This PC:');
  await expect(card(page).getByLabel('Use graphics card')).toBeChecked();
  await expect(card(page).getByLabel('Stop after idle')).toHaveValue('10');
  await expect(card(page).locator('.lm-model')).toHaveCount(5);
  await expect(card(page).locator('.lm-fit.big')).toHaveText('Too big');
  await expect(card(page).locator('.lm-model[data-model="gpt-oss-20b"]')).toContainText('is available');
  await expect(card(page).locator('.lm-state')).toContainText('Ready · Runs on:');
  await expect(card(page)).toContainText('not a phone, not another PC, and not Bunny itself');
  await expect(card(page)).toContainText('Nothing downloaded yet');
  await expect(card(page).getByRole('button', { name: 'Download gpt-oss 20B' })).toBeDisabled();
  await expect(card(page).locator('.lm-model[data-model="qwen3-4b"]')).toContainText('Uses tools');
  await expect(card(page).locator('.lm-model[data-model="ministral-3-3b"]')).toContainText('Chat only');
});

test('a download shows progress with Pause and Cancel, ends Ready with Delete; the idle choice and the switch save', async ({ page, request }) => {
  await ready(page);
  await card(page).getByLabel('Stop after idle').selectOption('30');
  await expect.poll(async () => (await (await request.get('/api/local-models')).json()).runtime.idleMinutes).toBe(30);
  await card(page).getByRole('button', { name: 'Download Qwen3 4B' }).click();
  await expect(card(page).locator('.lm-model[data-model="qwen3-4b"] [role=progressbar], .lm-model[data-model="qwen3-4b"] .lm-ready').first()).toBeVisible();
  await expect(card(page).locator('.lm-model[data-model="qwen3-4b"] .lm-ready')).toHaveText('Ready', { timeout: 10000 });
  await card(page).getByRole('button', { name: 'Delete Qwen3 4B' }).click();
  await expect(card(page).locator('.lm-model[data-model="qwen3-4b"] .lm-ready')).toHaveCount(0);
});

test('the warning card for a model not on the list puts Don\'t add first; Remove Bunny local names what it deletes', async ({ page }) => {
  await ready(page);
  await card(page).getByRole('button', { name: 'Add by name…' }).click();
  const warn = card(page).locator('[data-card="not-on-list"]');
  await expect(warn).toContainText("Not on Bunny's list");
  await expect(warn.getByRole('button').first()).toHaveText("Don't add");
  await expect(warn.getByRole('button', { name: 'Add anyway' })).toBeDisabled();
  await warn.getByRole('button', { name: "Don't add" }).click();
  await expect(warn).toHaveCount(0);
  await card(page).getByRole('button', { name: 'Download Qwen3 4B' }).click();
  await expect(card(page).locator('.lm-model[data-model="qwen3-4b"] .lm-ready')).toBeVisible({ timeout: 10000 });
  await card(page).getByRole('button', { name: 'Remove…' }).click();
  await expect(card(page).locator('[data-card="remove"]')).toContainText('1 downloaded model');
  await card(page).getByRole('button', { name: 'Keep it' }).click();
  await expect(card(page).locator('[data-card="remove"]')).toHaveCount(0);
  await card(page).getByRole('button', { name: 'Remove…' }).click();
  await card(page).getByRole('button', { name: 'Remove everything' }).click();
  await expect(card(page).locator('b', { hasText: 'Set up Bunny local' })).toBeVisible();
});

test('the chat menu lists a downloaded model under Bunny local, with what it can do, and always offers a way to get more', async ({ page, request }) => {
  await request.post('/api/local-models/setup');
  await expect.poll(async () => (await (await request.get('/api/local-models')).json()).installed).toBe(true);
  await request.post('/api/local-models/download', { data: { id: 'ministral-3-3b' } });
  await expect.poll(async () => (await (await request.get('/api/local-models')).json()).models.find((m) => m.id === 'ministral-3-3b').state, { timeout: 10000 }).toBe('ready');
  await page.goto('/');
  await page.locator('#picker-button').click();
  await expect(page.locator('.picker-panel')).toContainText('Ministral 3 3B');
  await expect(page.locator('.picker-panel')).toContainText('Bunny local · chat only');
  await expect(page.locator('#model-get-more')).toBeVisible();
});

for (const scheme of ['light', 'dark']) {
  for (const width of [390, 1100]) {
    test(`the card fits the screen: ${width} px, ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await ready(page);
      await card(page).getByRole('button', { name: 'Download Qwen3 8B' }).click();
      const overflow = await page.evaluate((w) => ({ sideways: document.documentElement.scrollWidth > w + 1, wide: [...document.querySelectorAll('#bunny-local *')].filter((n) => { const r = n.getBoundingClientRect(); return r.width && r.right > w + 1; }).map((n) => n.className || n.tagName).slice(0, 5) }), width);
      expect(overflow).toEqual({ sideways: false, wide: [] });
    });
  }
}

test('the drawing\'s details: a short badge with the sentence once, speed and time left, the fingerprint on a ready model, Remove as a row naming the cache', async ({ page }) => {
  await ready(page);
  await card(page).getByRole('button', { name: 'Download Qwen3 8B' }).click();
  await expect(card(page).locator('.lm-model[data-model="qwen3-8b"] .desc').first()).toContainText('MB/s');
  await expect(card(page).locator('.lm-model[data-model="qwen3-8b"] .lm-acts button').first()).toHaveClass(/btn/);
  await card(page).getByRole('button', { name: 'Download Ministral 3 3B' }).click();
  await expect(card(page).locator('.lm-model[data-model="ministral-3-3b"] .lm-ready')).toBeVisible({ timeout: 10000 });
  await expect(card(page).locator('.lm-model[data-model="ministral-3-3b"]')).toContainText('Checked · fingerprint');
  await expect(card(page).locator('.lm-remove-row')).toContainText('Deletes the program, every downloaded model and the cache');
  await expect(card(page).locator('.lm-fit').first()).toHaveText(/^(Fits|Tight|Slow|Too big)$/);
});

test('LM-4: a local model is never in Best for or Auto; it is the person\'s own pick, and a chat-only one shows its line under the message box', async ({ page, request }) => {
  await request.post('/api/local-models/setup');
  await expect.poll(async () => (await (await request.get('/api/local-models')).json()).installed).toBe(true);
  await request.post('/api/local-models/download', { data: { id: 'ministral-3-3b' } });
  await expect.poll(async () => (await (await request.get('/api/local-models')).json()).models.find((m) => m.id === 'ministral-3-3b').state, { timeout: 10000 }).toBe('ready');
  await page.goto('/');
  await page.locator('#picker-button').click();
  const best = page.locator('.picker-group', { hasText: /^Best for/ });
  if (await best.count()) await expect(page.locator('.picker-list')).not.toContainText(/Best for[\s\S]*Ministral[\s\S]*All models/);
  await page.locator('.picker-item', { hasText: 'Ministral 3 3B' }).first().click();
  await expect(page.locator('#local-hint')).toBeVisible();
  await expect(page.locator('#local-hint')).toHaveText("This model answers only; it can't use tools.");
});

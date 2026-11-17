import { test, expect } from '@playwright/test';

// W4-13: the model picker shows one row per model with every provider as a tag (Free, Free daily), filters that combine with AND,
// and "N of M models". The models are invented (Falcon Flash, Harbor and so on); /api/models is answered by the test.
const row = (providerId, providerName, id, displayName, freeKind, contextLength = 256000) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength });
const MODELS = [
  row('harbor', 'Harbor', 'falcon-flash', 'Falcon Flash', 'free', 1_000_000),
  row('meadow', 'Meadow', 'falcon-flash', 'Falcon Flash', 'daily', 1_000_000),
  row('quill', 'Quill', 'falcon-flash', 'Falcon Flash', null, 1_000_000),
  row('harbor', 'Harbor', 'otter-3-coder', 'Otter 3 Coder', 'daily'),
  row('meadow', 'Meadow', 'otter-3-coder', 'Otter 3 Coder', 'daily'),
  row('harbor', 'Harbor', 'willow-7b', 'Willow 7B', 'free', 128000),
  row('quill', 'Quill', 'willow-7b', 'Willow 7B', null, 128000),
  row('harbor', 'Harbor', 'birch-large', 'Birch Large', null),
  row('meadow', 'Meadow', 'birch-large', 'Birch Large', null),
  row('meadow', 'Meadow', 'reef-image', 'Reef Image', 'daily', 0),
];

test.beforeEach(async ({ page, request }) => {
  // the default "Show models" hides non-free models: this spec needs them all, whatever ran before it
  await request.put('/api/settings', { data: { modelFilter: 'all' } });
  await page.route('**/api/models*', (route) => route.fulfill({ json: MODELS }));
  await page.goto('/');
  await page.locator('#picker-button').click();
});

// the rows of All models: the Best for / Favourites / Recent rows carry a data-section
const models = (page) => page.locator('.picker-panel .picker-model:not([data-section])');

test('one row per model, every provider a tag, Free first, then Free daily, then the rest', async ({ page }) => {
  await expect(models(page)).toHaveCount(5);
  const falcon = page.locator('.picker-panel .picker-model', { hasText: 'Falcon Flash' }).first();
  await expect(falcon.locator('.picker-tag')).toHaveText(['HarborFree', 'MeadowFree daily', 'Quill']);
  // the same model on Meadow only: Free daily; a model with no tag at all (unknown or paid) shows only its providers
  await expect(page.locator('.picker-panel .picker-model', { hasText: 'Birch Large' }).first().locator('.picker-free')).toHaveCount(0);
  // Auto is there when nothing is filtered
  await expect(page.locator('.picker-panel .picker-auto')).toBeVisible();
});

test('Filters: Free only, and Provider, combine with AND; the count says how many match; filtering hides Auto', async ({ page }) => {
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.getByRole('button', { name: /Free only/ }).click();
  await expect(page.locator('.picker-count')).toHaveText('4 of 5 models'); // Birch Large has no free provider
  await expect(page.locator('.picker-panel .picker-auto')).toHaveCount(0);
  await page.getByRole('button', { name: 'Quill', exact: true }).click();
  // a model must have a provider that fits Provider AND Free together: Quill serves two models, but neither is free there
  await expect(page.locator('.picker-panel .picker-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Quill', exact: true }).click();
  await page.getByRole('button', { name: 'Meadow', exact: true }).click();
  await expect(page.locator('.picker-count')).toHaveText('3 of 5 models'); // Falcon, Otter, Reef: free on Meadow
  await expect(page.getByRole('button', { name: /Filters · 2/ })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.locator('.picker-count')).toBeHidden();
  await expect(models(page)).toHaveCount(5);
});

test('choosing a model uses its first provider (the order Bunny tries them)', async ({ page }) => {
  await page.locator('.picker-panel .picker-model', { hasText: 'Falcon Flash' }).first().click();
  await expect(page.locator('#picker-button')).toContainText('Falcon Flash'); // v0.1.10: the chip shows the short name; the provider is in its tooltip and label
  await expect(page.locator('#picker-button')).toHaveAttribute('title', /Harbor/);
});

// slice 2b: the details of one model, its provider order with arrows, favourites and recent, and the Can do filter
const details = (page, name) => page.getByRole('button', { name: `Details for ${name}` }).last(); // the All models row (the Best for row has one too)
const orderNames = (page) => page.locator('.picker-details .picker-order li .picker-order-name');

test('details: the providers in the order Bunny tries them; the arrows change the order, it is kept, and the model then uses the new first one', async ({ page }) => {
  await details(page, 'Falcon Flash').click();
  await expect(page.getByRole('heading', { name: 'Falcon Flash' })).toBeVisible();
  await expect(orderNames(page)).toHaveText(['HarborFree', 'MeadowFree daily', 'Quill']);
  await expect(page.getByRole('button', { name: 'Move Harbor up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Quill down' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move Harbor down' }).click();
  await expect(orderNames(page)).toHaveText(['MeadowFree daily', 'HarborFree', 'Quill']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bunny.providerOrder')).models['falcon-flash'])).toEqual(['meadow', 'harbor', 'quill']);
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.locator('.picker-panel .picker-model', { hasText: 'Falcon Flash' }).first().locator('.picker-tag').first()).toContainText('Meadow');
  await page.locator('.picker-panel .picker-model', { hasText: 'Falcon Flash' }).first().click();
  await expect(page.locator('#picker-button')).toHaveAttribute('title', /Meadow/);
});

test('favourites and recent: a favourite is starred and listed first; a chosen model is listed under Recent', async ({ page }) => {
  await expect(page.locator('.picker-group', { hasText: 'Favourites' })).toHaveCount(0);
  await details(page, 'Willow 7B').click();
  await page.getByRole('button', { name: 'Add to favourites' }).click();
  await expect(page.getByRole('button', { name: 'Remove from favourites' })).toBeVisible();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(page.locator('.picker-group', { hasText: 'Favourites' })).toBeVisible();
  await expect(page.locator('.picker-panel .picker-model:not([data-section="best"]) .picker-star')).toHaveCount(2); // in Favourites and again in All models
  await page.locator('.picker-panel .picker-model', { hasText: 'Otter 3 Coder' }).first().click();
  await page.locator('#picker-button').click();
  await expect(page.locator('.picker-group', { hasText: 'Recent' })).toBeVisible();
  await expect(page.locator('.picker-group', { hasText: 'Recent' }).locator('xpath=following-sibling::div[1]')).toContainText('Otter 3 Coder');
});

test('Can do chips filter by ability and combine with the other filters', async ({ page }) => {
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.locator('.picker-panel').getByRole('button', { name: 'Code', exact: true }).click();
  await expect(page.locator('.picker-count')).toContainText('of 5 models');
  await expect(page.locator('.picker-panel .picker-model', { hasText: 'Otter 3 Coder' })).toHaveCount(1);
  await expect(page.locator('.picker-panel .picker-model', { hasText: 'Reef Image' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(models(page)).toHaveCount(5);
});

test('details at 390 px: no horizontal scroll, Back returns to the list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await details(page, 'Falcon Flash').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '‹ Back' }).click();
  await expect(models(page)).toHaveCount(5);
});

test('no horizontal scroll at 390 px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: 'Filters' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// slice 2c: Best for is one row per model like All models, Sort, context size on the right, Speech only for models that make sound
test('Best for Chat: one row per model with the same provider tags, and the arrow keys follow the Free-first order', async ({ page }) => {
  const best = page.locator('.picker-panel .picker-model[data-section="best"]');
  expect(await best.count()).toBeGreaterThan(0);
  const ids = await best.evaluateAll((els) => els.map((e) => e.dataset.model));
  expect(new Set(ids).size).toBe(ids.length); // no model twice
  const second = best.nth(1);
  const model = await second.getAttribute('data-model');
  const allRow = page.locator('.picker-panel .picker-model:not([data-section])[data-model="' + model + '"]');
  expect(await second.locator('.picker-tag').allTextContents()).toEqual(await allRow.locator('.picker-tag').allTextContents());
  const shownName = ((await second.locator('.model-name').first().textContent()) ?? '').replace('★', '').trim();
  const firstProvider = await second.locator('.picker-tag').first().evaluate((t) => t.firstChild.textContent);
  await page.keyboard.press('ArrowDown'); // Auto -> first Best for row
  await page.keyboard.press('ArrowDown'); // second Best for row
  await page.keyboard.press('Enter');
  await expect(page.locator('#picker-button')).toContainText(shownName);
  await expect(page.locator('#picker-button')).toHaveAttribute('title', new RegExp(firstProvider));
});

test('Sort: Name, and Context size (largest first); Recommended keeps the order', async ({ page }) => {
  await page.getByRole('button', { name: 'Filters' }).click();
  const names = () => models(page).locator('.model-name').evaluateAll((els) => els.map((e) => e.firstChild.textContent));
  const recommended = await names();
  await page.locator('.picker-panel').getByRole('button', { name: 'Name', exact: true }).click();
  expect(await names()).toEqual(['Birch Large', 'Falcon Flash', 'Otter 3 Coder', 'Reef Image', 'Willow 7B']);
  await page.locator('.picker-panel').getByRole('button', { name: 'Context size', exact: true }).click();
  expect((await names())[0]).toBe('Falcon Flash'); // 1M
  expect((await names()).at(-1)).toBe('Reef Image'); // no context size
  await page.locator('.picker-panel').getByRole('button', { name: 'Recommended', exact: true }).click();
  expect(await names()).toEqual(recommended);
});

test('the context size is on the right beside Details, compact, and not repeated as a token count', async ({ page }) => {
  const falcon = page.locator('.picker-panel .picker-row', { hasText: 'Falcon Flash' }).first();
  await expect(falcon.locator('.picker-ctx')).toHaveText('1M');
  await expect(page.locator('.picker-panel .picker-row', { hasText: 'Willow 7B' }).first().locator('.picker-ctx')).toHaveText('128K');
  await expect(page.locator('.picker-panel .picker-row', { hasText: 'Otter 3 Coder' }).first().locator('.picker-ctx')).toHaveText('256K');
  await expect(page.locator('.picker-panel')).not.toContainText('tokens ·');
  await expect(page.locator('.picker-panel .picker-row', { hasText: 'Reef Image' }).first().locator('.picker-ctx')).toHaveCount(0);
});

test('Speech is shown only for models that make sound themselves, not for every chat model', async ({ page }) => {
  await expect(page.locator('.picker-panel .picker-model', { hasText: 'Falcon Flash' }).first().locator('.model-desc')).not.toContainText('Speech');
  await page.getByRole('button', { name: 'Filters' }).click();
  await page.locator('.picker-panel').getByRole('button', { name: 'Speech', exact: true }).click();
  await expect(page.locator('.picker-panel .picker-empty')).toBeVisible(); // none of the invented models makes sound
});

// W4-13b: Thinking in a model's Details, only for providers whose field is known; kept per model on this computer
test('Thinking: shown for a known provider (Default, Low, Medium, High), kept per model, and hidden for a provider whose field is not known', async ({ page }) => {
  const KNOWN = [row('openai', 'OpenAI', 'think-a', 'Think A', null), row('nvidia', 'NVIDIA', 'quiet-b', 'Quiet B', null)];
  await page.unroute('**/api/models*');
  await page.route('**/api/models*', (route) => route.fulfill({ json: KNOWN }));
  await page.reload();
  await page.locator('#picker-button').click();
  await page.getByRole('button', { name: 'Details for Think A' }).last().click();
  const group = page.getByRole('group', { name: 'Thinking' });
  await expect(group.getByRole('button')).toHaveText(['Default', 'Low', 'Medium', 'High']);
  await expect(group.getByRole('button', { name: 'Default' })).toHaveAttribute('aria-pressed', 'true');
  await group.getByRole('button', { name: 'High' }).click();
  await expect(group.getByRole('button', { name: 'High' })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bunny.thinking'))['think-a'])).toBe('high');
  await group.getByRole('button', { name: 'Default' }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('bunny.thinking'))['think-a'])).toBeUndefined();
  await page.getByRole('button', { name: '‹ Back' }).click();
  await page.getByRole('button', { name: 'Details for Quiet B' }).last().click();
  await expect(page.getByRole('group', { name: 'Thinking' })).toHaveCount(0);
});

import { test, expect } from '@playwright/test';

// W4-9: "Wait for a first reply" in Settings. The choice is saved on the server (settings.json) and shown again on a fresh page load.
test.beforeEach(async ({ request }) => {
  await request.put('/api/settings', { data: { firstReplyWaitSeconds: 30, fallbackWhenBusy: true } });
});
test.afterAll(async ({ request }) => {
  await request.put('/api/settings', { data: { firstReplyWaitSeconds: 30 } });
});

const saved = async (page) => (await (await page.request.get('/api/settings')).json()).firstReplyWaitSeconds;

test('a preset is saved, the line under it says what it means, and it is still there after a reload', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  const sel = page.locator('#wait-select');
  await expect(sel).toHaveValue('30');
  await expect(page.locator('#wait-now')).toHaveText('Now: 30 seconds, or 60 for reasoning, image and video models');
  await sel.selectOption('90');
  await expect(page.locator('#wait-now')).toHaveText('Now: 90 seconds, or 180 for reasoning, image and video models');
  await expect.poll(() => saved(page)).toBe(90);
  await page.reload();
  await expect(page.locator('#wait-select')).toHaveValue('90');
  await expect(page.locator('#wait-now')).toContainText('Now: 90 seconds');
});

test('Custom: 5 shows the note and is not saved; 45 is saved and comes back as Custom with 45', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#wait-select').selectOption('custom');
  const box = page.locator('#wait-custom-input');
  await expect(box).toBeFocused();
  await box.fill('5');
  await expect(page.locator('#wait-now')).toHaveText('Use a whole number of seconds from 10 to 600. Not saved: still waiting 30 seconds.');
  await expect(box).toHaveClass(/bad/);
  expect(await saved(page)).toBe(30);
  for (const bad of ['1.5', 'abc', '601', '']) {
    await box.fill(bad);
    await expect(page.locator('#wait-now')).toContainText('Not saved: still waiting 30 seconds.');
  }
  expect(await saved(page)).toBe(30);
  await box.fill('45');
  await expect(page.locator('#wait-now')).toHaveText('Now: 45 seconds, or 90 for reasoning, image and video models');
  await expect.poll(() => saved(page)).toBe(45);
  await page.reload();
  await expect(page.locator('#wait-select')).toHaveValue('custom');
  await expect(page.locator('#wait-custom-input')).toHaveValue('45');
});

test('the line shows the 600 second cap: 400 doubles to 600, 600 says every model', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#wait-select').selectOption('custom');
  const box = page.locator('#wait-custom-input');
  await box.fill('400');
  await expect(page.locator('#wait-now')).toHaveText('Now: 400 seconds, or 600 for reasoning, image and video models');
  await box.fill('600');
  await expect(page.locator('#wait-now')).toHaveText('Now: 600 seconds for every model');
  await expect.poll(() => saved(page)).toBe(600);
});

test('a bad value sent straight to the server is refused and not stored', async ({ request }) => {
  const r = await request.put('/api/settings', { data: { firstReplyWaitSeconds: 5 } });
  expect(r.status()).toBe(400);
  expect((await r.json()).message).toBe('Use a whole number of seconds from 10 to 600. Not saved.');
  expect((await (await request.get('/api/settings')).json()).firstReplyWaitSeconds).toBe(30);
});

test('at 390 px the row does not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto('/src/ui/settings.html');
  await page.locator('#wait-select').selectOption('custom');
  await page.locator('#wait-custom-input').fill('5');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('choosing a preset while the Custom box has focus keeps the preset: the box does not save its old value back', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#wait-select').selectOption('custom');
  const box = page.locator('#wait-custom-input');
  await box.fill('45');
  await expect.poll(() => saved(page)).toBe(45);
  await box.focus();
  await page.locator('#wait-select').selectOption('90');
  await expect.poll(() => saved(page)).toBe(90);
  await page.waitForTimeout(500);
  expect(await saved(page)).toBe(90);
  await page.reload();
  await expect(page.locator('#wait-select')).toHaveValue('90');
});

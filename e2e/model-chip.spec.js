import { test, expect } from '@playwright/test';

// v0.1.10 MODEL-CHIP: the model is a chip in the composer's button row (between the spacer and Send); it opens a floating selector
// upward; on a phone the selector is a bottom sheet. Models are invented.
const row = (providerId, providerName, id, displayName, freeKind) => ({ providerId, providerName, id, displayName, freeKind, free: freeKind === 'free', contextLength: 128000 });
const MODELS = [
  row('harbor', 'Harbor', 'falcon-flash', 'Falcon Flash', 'free'),
  row('quill', 'Quill', 'otter-3-coder', 'Otter 3 Coder', null),
  row('harbor', 'Harbor', 'willow-7b', 'Willow 7B', 'free'),
];

for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 780 }]]) {
  for (const scheme of ['light', 'dark']) {
    test.describe(`${label}, ${scheme}`, () => {
      test.beforeEach(async ({ page, request }) => {
        await request.put('/api/settings', { data: { modelFilter: 'all' } });
        await page.route('**/api/models*', (route) => route.fulfill({ json: MODELS }));
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize(size);
        await page.goto('/');
      });

      test('closed: the chip is in the button row, before Send, and the row under the box no longer holds it', async ({ page }) => {
        const chip = page.locator('#picker-button');
        await expect(chip).toBeVisible();
        expect(await chip.evaluate((el) => !!el.closest('.composer-row'))).toBe(true);
        expect(await chip.evaluate((el) => !!el.closest('.composer-under'))).toBe(false);
        const [c, s] = await Promise.all([chip.boundingBox(), page.locator('#send').boundingBox()]);
        expect(c.x + c.width).toBeLessThanOrEqual(s.x + 1);
        expect(c.y).toBeLessThan(s.y + s.height);
        expect(await chip.getAttribute('aria-label')).toContain('Model:');
        expect(await chip.getAttribute('title')).toBeTruthy();
        await expect(chip.locator('.chip-dot')).toHaveCount(1);
      });

      test('open: a selector above the chip (phone: a bottom sheet); Esc closes it and the chip gets the focus back', async ({ page }) => {
        const chip = page.locator('#picker-button');
        await chip.click();
        const panel = page.locator('.picker-panel');
        await expect(panel).toBeVisible();
        await expect(page.locator('.picker-panel input[type="search"]')).toBeFocused();
        const [p, c] = await Promise.all([panel.boundingBox(), chip.boundingBox()]);
        if (label === 'desktop') expect(p.y + p.height).toBeLessThanOrEqual(c.y + 1); // always opens upward
        if (label === 'phone') {
          expect(Math.round(p.x)).toBe(0);
          expect(Math.round(p.width)).toBe(size.width);
          expect(p.height).toBeLessThanOrEqual(size.height * 0.8 + 2);
          await expect(page.locator('.picker-scrim')).toBeVisible();
          await expect(page.locator('.picker-handle')).toBeVisible();
        } else {
          expect(p.width).toBeLessThanOrEqual(421);
          expect(p.x).toBeGreaterThanOrEqual(0);
          await expect(page.locator('.picker-scrim')).toBeHidden();
        }
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(chip).toBeFocused();
      });

      test('search: typing shows the matches only, with a count, and Enter picks the first match', async ({ page }) => {
        await page.locator('#picker-button').click();
        await expect(page.locator('.picker-panel .picker-auto')).toBeVisible();
        await page.keyboard.type('otter');
        await expect(page.locator('.picker-panel .picker-auto')).toHaveCount(0);
        await expect(page.locator('.picker-panel .picker-group')).toHaveCount(0);
        await expect(page.locator('.picker-count')).toBeVisible();
        await expect(page.locator('.picker-panel .picker-model')).toHaveCount(1);
        await expect(page.locator('.picker-panel .picker-model').first()).toHaveAttribute('aria-selected', 'true');
        await page.keyboard.press('Enter');
        await expect(page.locator('.picker-panel')).toHaveCount(0);
        await expect(page.locator('#picker-button')).toBeFocused();
        await expect(page.locator('#picker-button .label')).toContainText('Otter 3 Coder');
      });

      test('a click outside (phone: on the dimmed page) closes it', async ({ page }) => {
        await page.locator('#picker-button').click();
        await expect(page.locator('.picker-panel')).toBeVisible();
        if (label === 'phone') await page.locator('.picker-scrim').click({ position: { x: 20, y: 20 } });
        else await page.mouse.click(20, 400);
        await expect(page.locator('.picker-panel')).toHaveCount(0);
      });
    });
  }
}

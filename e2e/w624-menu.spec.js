import { test, expect } from '@playwright/test';

// W6-24 (QA's findings c and d): the ⋯ menu of the browser panel closes with Esc and stays inside the window at narrow widths.
async function openMenu(page) {
  await page.goto('/');
  await page.locator('.toolbar [data-view="browser"]').click();
  await expect(page.locator('#pane-browser')).toBeVisible();
  await page.locator('#browser-more').click();
  await expect(page.locator('#browser-menu')).toBeVisible();
}

test('Esc closes the browser panel\'s ⋯ menu and gives the focus back to its button', async ({ page }) => {
  await openMenu(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#browser-menu')).toBeHidden();
  await expect(page.locator('#browser-more')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#browser-more')).toBeFocused();
});

for (const width of [1280, 600, 390, 320]) {
  test(`at ${width} px the ⋯ menu is inside the window (not clipped at an edge)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openMenu(page);
    const box = await page.locator('#browser-menu').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    await page.keyboard.press('Escape');
    await expect(page.locator('#browser-menu')).toBeHidden();
    await page.locator('#browser-more').click(); // and it opens again, after it was moved
    const again = await page.locator('#browser-menu').boundingBox();
    expect(again.x).toBeGreaterThanOrEqual(0);
    expect(again.x + again.width).toBeLessThanOrEqual(width + 1);
  });
}

import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// INSTALL-ANYWHERE: Customize "Add from address…": the field says what it did not understand; a private connector address the person typed gets the card with the own-network line and installs as "Added by you";
// light 1100 px and dark 390 px. Invented addresses; no network is reached (the address is a literal on a private range).
test.beforeEach(async ({ request }) => { await resetProfile(request); });
test.afterEach(async ({ request }) => { await resetProfile(request); });

for (const [scheme, width] of [['light', 1100], ['dark', 390]]) {
  test(`Add from address (${scheme}, ${width}px): not understood, then the one card, then the connector is listed as added by you`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
    await page.goto('/src/ui/customize.html');
    await page.locator('#cz-add').click();
    await page.getByRole('menuitem', { name: /Add from address/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Add from address' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Address').fill('my cool plugin');
    await dlg.getByRole('button', { name: 'Check' }).click();
    await expect(dlg.locator('.err')).toContainText("I can't tell what this is");
    await dlg.getByLabel('Address').fill('https://10.0.0.5/mcp');
    await dlg.getByRole('button', { name: 'Check' }).click();
    await expect(dlg).toContainText('Understood: remote connector');
    await expect(dlg).toContainText('This service can change what it does at any time.');
    await expect(dlg).toContainText('This address is on your own network. It is allowed because you added it.');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await expect(dlg.getByRole('button', { name: 'Install and switch on' })).toBeVisible();
    await dlg.getByRole('button', { name: 'Install, keep off' }).click();
    await expect(dlg).toBeHidden();
    const row = page.locator('.cz-row, .row, li').filter({ hasText: '10.0.0.5' }).first();
    await expect(row).toContainText('Added by you · may use a private address');
    const list = await (await page.request.get('/api/mcp')).json();
    expect(list.map((s) => [s.url, s.enabled, s.addedBy])).toEqual([['https://10.0.0.5/mcp', false, 'person']]);
  });
}

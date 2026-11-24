import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// The paste-your-key card (Security K-1 to K-8): Customize, a remote connector's menu, Add key. A password field, never shown again, only "Key saved (header)". Invented key; the connector's address is never contacted.
const KEY = 'sk-INVENTED-e2e-0123456789';
async function menu(row, name) { await row.getByRole('button', { name: /^More for/ }).click(); await row.getByRole('menuitem', { name }).click(); }

for (const [scheme, width] of [['light', 1100], ['dark', 390]]) {
  test(`Add key (${scheme}, ${width}px): a password field, saved without echo, the row says Key saved, Change key and Remove key work, the key is never in the page or the list`, async ({ page, request }) => {
    await resetProfile(request);
    for (const s of await (await request.get('/api/mcp')).json()) await request.delete(`/api/mcp/${s.id}`);
    const added = await (await request.post('/api/mcp', { data: { name: 'Keyed docs', url: 'https://mcp.keyed.test/mcp', enabled: false } })).json();
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
    await page.goto('/src/ui/customize.html?embed=1');
    const row = page.locator('.cz-row', { hasText: 'Keyed docs' });
    await expect(row).toBeVisible();
    await menu(row, 'Add key…');
    const box = row.locator('.cz-key-box');
    await expect(box).toContainText('Bunny keeps it on this computer, sends it only to mcp.keyed.test, and never shows it again.');
    const field = box.getByLabel('Key for Keyed docs');
    await expect(field).toHaveAttribute('type', 'password');
    await box.getByLabel('Header name for Keyed docs').fill('Host');
    await field.fill(KEY);
    await box.getByRole('button', { name: 'Save key' }).click();
    await expect(box.locator('[role="alert"]')).toContainText(/Bunny sets itself/);
    await expect(field).toHaveValue('', 'a refused key is cleared from the field');
    await box.getByLabel('Header name for Keyed docs').fill('X-Api-Key');
    await field.fill(KEY);
    await box.getByRole('button', { name: 'Save key' }).click();
    await expect(page.locator('.cz-row', { hasText: 'Keyed docs' })).toContainText('Key saved (X-Api-Key)');
    await expect(page.locator('.cz-key-box')).toHaveCount(0);
    expect(await page.content()).not.toContain(KEY); expect(await page.locator('body').innerText()).not.toContain(KEY);
    expect(JSON.stringify(await (await request.get('/api/mcp')).json())).not.toContain(KEY);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await menu(page.locator('.cz-row', { hasText: 'Keyed docs' }), 'Change key…');
    await expect(page.locator('.cz-key-box').getByLabel('Header name for Keyed docs')).toHaveValue('X-Api-Key');
    await expect(page.locator('.cz-key-box').getByLabel('Key for Keyed docs')).toHaveValue('');
    await page.locator('.cz-key-box').getByRole('button', { name: 'Cancel' }).click();
    await menu(page.locator('.cz-row', { hasText: 'Keyed docs' }), 'Remove key');
    await expect(page.locator('.cz-row', { hasText: 'Keyed docs' })).not.toContainText('Key saved');
    expect((await (await request.get('/api/mcp')).json()).find((s) => s.id === added.id).hasKey).toBe(false);
  });
}

import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// IA-9 (QA): "Pin this version" in Customize. The registry is not reachable from this test, so the two pin answers are stood in for (the real pipeline is proved in test/install-npm.test.js and test/install-pypi.test.js);
// what is checked here is the SCREEN: the row stops saying "Not pinned" at once when the pin is confirmed, and the card's buttons are 44 px tall on a phone. Light 1100 px and dark 390 px.
test.beforeEach(async ({ request }) => { await resetProfile(request); });
test.afterEach(async ({ request }) => { await resetProfile(request); });

for (const [scheme, width] of [['light', 1100], ['dark', 390]]) {
  test(`Pin this version (${scheme}, ${width}px): the row refreshes at once, and the card's buttons are touch-sized on a phone`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme }); await page.setViewportSize({ width, height: 900 });
    const made = await (await request.post('/api/mcp', { data: { name: 'Notes helper', command: 'npx', args: ['-y', 'notes-mcp'], confirmLocal: true, enabled: false } })).json();
    expect(made.id).toBeTruthy();
    // the card and the confirmation are stood in for; the confirmation really repoints the connector, as the real one does
    await page.route(`**/api/mcp/${made.id}/pin`, (route) => route.fulfill({ json: { ok: true, token: '11111111-1111-4111-8111-111111111111', text: 'This connector runs notes-mcp at whatever version the registry has today.\n\nConnector from npm: notes-mcp@1.2.3\nThis runs code from the internet on this computer.', tooLong: false } }));
    await page.route(`**/api/mcp/${made.id}/pin/11111111-1111-4111-8111-111111111111`, async (route) => {
      if (route.request().method() === 'DELETE') return route.fulfill({ json: { ok: true } });
      await new Promise((r) => setTimeout(r, 1500)); // a slow confirmation: the row must not wait for the list to reload as well
      const changed = await request.patch(`/api/mcp/${made.id}`, { data: { command: 'node', args: ['C:\\tools\\notes-mcp\\bin.js'], confirmLocal: true } });
      const body = await changed.json(); if (!changed.ok()) console.log('PATCH FAILED', changed.status(), JSON.stringify(body).slice(0, 200));
      return route.fulfill({ json: body });
    });
    await page.goto('/src/ui/customize.html');
    const row = page.locator('.cz-row, .row, li').filter({ hasText: 'Notes helper' }).first();
    await expect(row).toContainText('Not pinned: runs whatever version the registry has today');
    await row.getByRole('button', { name: /more|menu|⋯|…/i }).first().click().catch(() => {});
    await page.getByRole('menuitem', { name: 'Pin this version' }).click().catch(async () => { await row.getByText('Pin this version').click(); });
    const dlg = page.getByRole('dialog', { name: 'Pin Notes helper' });
    await expect(dlg).toBeVisible();
    if (width < 600) {
      for (const name of ['Pin this version', 'Cancel']) {
        const h = await dlg.getByRole('button', { name, exact: true }).evaluate((el) => el.getBoundingClientRect().height);
        expect(h, `${name} is at least 44 px tall`).toBeGreaterThanOrEqual(43.5);
      }
      const border = await dlg.getByRole('button', { name: 'Cancel', exact: true }).evaluate((el) => getComputedStyle(el).borderTopWidth);
      expect(parseFloat(border)).toBeGreaterThanOrEqual(1);
    }
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    await dlg.getByRole('button', { name: 'Pin this version', exact: true }).click();
    await expect(dlg).toBeHidden({ timeout: 10_000 });
    // within a fraction of a second of the confirmation, the row no longer says "Not pinned"
    await expect(row).not.toContainText('Not pinned', { timeout: 800 });
    const after = (await (await request.get('/api/mcp')).json())[0];
    expect(after.command).toBe('node'); expect(after.unpinned).toBeUndefined();
  });
}

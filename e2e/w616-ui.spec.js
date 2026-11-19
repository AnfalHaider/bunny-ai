import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// W6-16 (Design), TIGHT-ROWS (v0.1.14): "Only in: <folder>" is part of the one dim line of a row in Customize. It stays inside its column, never runs under the switch or the menu button, and the whole
// folder name is readable (the line is cut with an ellipsis when it is long; the full text is its tooltip and the Add a folder / Everywhere choices are in the row's menu).
test.beforeEach(async ({ request }) => { await resetProfile(request); });
test.afterEach(async ({ request }) => { await resetProfile(request); });

async function seed(request) {
  const root = mkdtempSync(join(tmpdir(), 'bunny-scope-ui-'));
  const names = ['client-site', 'my-long-project-folder-name-for-wrapping'];
  const folders = [];
  for (const name of names) { const f = join(root, name); mkdirSync(f); folders.push(f); expect((await request.post('/api/folder/check', { data: { folder: f } })).ok()).toBeTruthy(); }
  const skill = await (await request.post('/api/skills', { data: { name: 'release-notes', description: 'Writes release notes', instructions: 'x', enabled: true } })).json();
  expect((await request.patch(`/api/skills/${skill.id}`, { data: { folders } })).status()).toBe(200);
  const conn = await (await request.post('/api/mcp', { data: { name: 'Example', url: 'https://example.com/mcp', enabled: false } })).json();
  expect((await request.patch(`/api/mcp/${conn.id}`, { data: { folders: [folders[0]] } })).status()).toBe(200);
}

for (const width of [1280, 800, 390]) {
  for (const kind of ['Skills', 'Connectors']) {
    test(`at ${width} px the scope line of a ${kind === 'Skills' ? 'skill' : 'connector'} stays in its column, never runs under the switch, and the whole folder name is readable`, async ({ page, request }) => {
      await seed(request);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/src/ui/customize.html');
      if (kind === 'Skills') await page.getByRole('tab', { name: 'Skills' }).click();
      const row = page.locator('.cz-row[role="row"]').first();
      const dim = row.locator('.tr-l2');
      await expect(dim).toContainText('Only in:');
      const m = await row.evaluate((r) => {
        const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        return { dim: box(r.querySelector('.tr-l2')), name: box(r.querySelector('.tr-name')), right: box(r.querySelector('.tr-right')), row: box(r), height: r.getBoundingClientRect().height };
      });
      expect(m.dim.right).toBeLessThanOrEqual(m.name.right + 1); // never past its own column
      expect(m.dim.right).toBeLessThanOrEqual(m.right.left + 1); // never under the switch and the menu button
      expect(m.height).toBeLessThan(70); // one tight row, however long the folder name
      if (kind === 'Skills') await expect(dim).toHaveAttribute('title', /my-long-project-folder-name-for-wrapping/); // the whole name, not "my-l..."
      // the folder choices are in the row's menu
      await row.getByRole('button', { name: /^More for/ }).click();
      await expect(row.getByRole('menuitem', { name: 'Add a folder' })).toBeVisible();
      await expect(row.getByRole('menuitem', { name: 'Everywhere' })).toBeVisible();
    });
  }
}

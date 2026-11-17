import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// W6-16 (Design): the "Only in:" line in Customize never runs into another column, and a long folder name is readable whole.
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
    test(`at ${width} px the scope line of a ${kind === 'Skills' ? 'skill' : 'connector'} stays in its column and the whole folder name is readable`, async ({ page, request }) => {
      await seed(request);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/src/ui/customize.html');
      if (kind === 'Skills') await page.getByRole('tab', { name: 'Skills' }).click();
      const row = page.locator('.cz-row[role="row"]:not(.cz-head)').first();
      await expect(row.locator('.cz-scope-label')).toContainText('Only in:');
      const m = await row.evaluate((r) => {
        const label = r.querySelector('.cz-scope-label');
        const scope = r.querySelector('.cz-scope');
        const name = r.querySelector('.cz-name');
        const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom }; };
        const cs = getComputedStyle(label);
        const others = [...r.querySelectorAll('.cz-type, .cz-status, .cz-actions')].filter((e) => e.getBoundingClientRect().width > 0).map(box);
        return { scope: box(scope), name: box(name), row: box(r), whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow, clipped: label.scrollWidth > label.clientWidth + 1, others };
      });
      expect(m.scope.right).toBeLessThanOrEqual(m.name.right + 1); // never past its own column
      expect(m.scope.right).toBeLessThanOrEqual(m.row.right + 1);
      for (const other of m.others) { // and never over another one (a card puts them under each other: only a box that overlaps in BOTH directions is a problem)
        const across = m.scope.right > other.left + 1 && m.scope.left < other.right - 1;
        const down = m.scope.bottom > other.top + 1 && m.scope.top < other.bottom - 1;
        expect(across && down).toBe(false);
      }
      expect(m.whiteSpace).toBe('normal');
      expect(m.textOverflow).not.toBe('ellipsis');
      expect(m.clipped).toBe(false);
      if (kind === 'Skills') await expect(row.locator('.cz-scope-label')).toContainText('my-long-project-folder-name-for-wrapping'); // the whole name, not "my-l..."
    });
  }
}

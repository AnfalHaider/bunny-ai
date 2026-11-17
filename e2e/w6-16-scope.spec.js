import { test, expect } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// W6-16: a skill limited to a folder shows in Customize as "Only in: <folder>", and is not in the slash menu of a chat elsewhere (or with no folder).
test.beforeEach(async ({ request }) => { await resetProfile(request); });
test.afterEach(async ({ request }) => { await resetProfile(request); });

test('a skill scoped to a folder is labelled in Customize and is not in the slash menu of a chat with no folder', async ({ page, request }) => {
  const root = mkdtempSync(join(tmpdir(), 'bunny-scope-'));
  const folder = join(root, 'project');
  mkdirSync(folder);
  const everywhere = await (await request.post('/api/skills', { data: { name: 'Everywhere Tip', description: 'For all', instructions: 'a', enabled: true } })).json();
  const only = await (await request.post('/api/skills', { data: { name: 'Project Tip', description: 'For one folder', instructions: 'b', enabled: true } })).json();
  expect((await request.post('/api/folder/check', { data: { folder } })).ok()).toBeTruthy(); // choosing the folder (browser mode)
  expect((await request.patch(`/api/skills/${only.id}`, { data: { folders: [folder] } })).status()).toBe(200);
  expect(everywhere.id).toBeTruthy();

  await page.goto('/src/ui/customize.html');
  await page.getByRole('tab', { name: 'Skills' }).click();
  const row = page.locator('.cz-row', { hasText: 'Project Tip' });
  await expect(row).toContainText('Only in: project');
  await expect(page.locator('.cz-row', { hasText: 'Everywhere Tip' })).toContainText('Everywhere');

  await page.goto('/');
  await page.locator('#input').fill('/');
  const menu = page.locator('#slash');
  await expect(menu).toContainText('/everywhere-tip');
  await expect(menu).not.toContainText('/project-tip');
});

test('a folder that was never picked is refused with a plain message and nothing is saved', async ({ request }) => {
  const root = mkdtempSync(join(tmpdir(), 'bunny-scope-'));
  const skill = await (await request.post('/api/skills', { data: { name: 'Tip', description: '', instructions: 'a', enabled: true } })).json();
  const refused = await request.patch(`/api/skills/${skill.id}`, { data: { folders: [root] } });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).message).toMatch(/folder picker/);
  const saved = await (await request.get('/api/skills')).json();
  expect(saved[0].folders ?? []).toEqual([]);
});

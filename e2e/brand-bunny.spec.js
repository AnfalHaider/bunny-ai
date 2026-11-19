import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// BRAND-BUNNY: Customize says Bunny: a skill written for another app is listed in Bunny's words, and the page's own help names no raw file format.
test('Customize lists a skill written for another app in Bunny\'s words, and its help names no file format or other app', async ({ page, request }) => {
  await resetProfile(request);
  for (const s of await (await request.get('/api/skills')).json()) await request.delete(`/api/skills/${s.id}`);
  expect((await request.post('/api/skills', { data: { name: 'tidy-desk', description: 'A Claude Code skill: keeps CLAUDE.md tidy', instructions: 'Keep it tidy.' } })).ok()).toBeTruthy();
  await page.goto('/src/ui/customize.html?embed=1');
  await page.locator('.cz-tab[data-kind="skills"]').click();
  const row = page.locator('main').getByText('tidy-desk').first();
  await expect(row).toBeVisible();
  const text = await page.locator('main').innerText();
  expect(text).toContain("A Bunny skill: keeps Bunny's instructions tidy");
  expect(text).not.toMatch(/claude|SKILL\.md|\.mcp\.json/i);
  await page.getByRole('button', { name: /add/i }).first().click().catch(() => {});
  await expect(page.locator('body')).not.toContainText(/SKILL\.md|\.mcp\.json/);
  for (const s of await (await request.get('/api/skills')).json()) await request.delete(`/api/skills/${s.id}`);
});

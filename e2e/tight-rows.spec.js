import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// TIGHT-ROWS (v0.1.14, the owner's go; Design's drawing 5e0f5a4): on Customize (Connectors, Skills, Plugins) and Automation one item is one row of about 52 px: logo, name over one dim line,
// the switch on the same line at the right, and everything else in the "..." menu. Words that only say "Not checked" are gone: a chip shows only when something needs the person.
// Invented profile only. BUNNY_SHOTS_DIR also writes the pictures.
const SHOTS = process.env.BUNNY_SHOTS_DIR;
const shot = async (page, name, scheme) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) }); } };

async function seed(request) {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/settings')).json()).plugins ?? []) await request.delete(`/api/plugins/${p.id}`); // a plugin from an earlier test goes with what it added
  for (const s of await (await request.get('/api/skills')).json()) await request.delete(`/api/skills/${s.id}`);
  for (const s of await (await request.get('/api/mcp')).json()) await request.delete(`/api/mcp/${s.id}`);
  await request.post('/api/mcp', { data: { name: 'Context7', url: 'https://mcp.context7.com/mcp', enabled: true } });
  await request.post('/api/mcp', { data: { name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', enabled: true } });
  await request.post('/api/mcp', { data: { name: 'Team wiki', url: 'https://wiki.example.com/mcp', enabled: false } });
  await request.post('/api/skills', { data: { name: 'Code reviewer', description: 'Reviews a change for bugs before style', instructions: 'x', enabled: true } });
  await request.post('/api/skills', { data: { name: 'Commit message writer', description: 'Short, clear commit messages', instructions: 'x', enabled: true } });
  await request.post('/api/skills', { data: { name: 'Plain-language explainer', description: 'Explains without jargon', instructions: 'x', enabled: false } });
  await request.post('/api/plugins', { data: { name: 'Developer docs pack', description: 'Two connectors plus a skill that cites its sources', connectors: [{ name: 'Wiki docs', url: 'https://docs.example.com/mcp' }], skills: [{ name: 'Cite sources', description: 'Says where an answer came from', instructions: 'Name the source.' }] } });
}
const height = (loc) => loc.evaluate((el) => el.getBoundingClientRect().height);
const menuBtn = (row) => row.getByRole('button', { name: /^More for/ });

for (const scheme of ['light', 'dark']) {
  test.describe(`Customize, ${scheme}`, () => {
    test.use({ colorScheme: scheme, viewport: { width: 1100, height: 760 } });

    test('a connector is one tight row (logo, name, one dim line, the switch at the right on the same line); no column words; the count says how many', async ({ page, request }) => {
      await seed(request);
      await page.goto('/src/ui/customize.html');
      const rows = page.locator('.cz-row[role="row"]');
      await expect(rows).toHaveCount(4); // Context7, DeepWiki, Team wiki, and the plugin's Wiki docs
      await expect(page.locator('#cz-col-name')).toHaveText('4 connectors');
      const text = await page.locator('main').innerText();
      expect(text).not.toMatch(/\bType\b|\bStatus\b|Not checked|Custom\b|Remote\b/);
      const row = rows.filter({ hasText: 'Context7' });
      await expect(row.locator('.tr-l2')).toHaveText('mcp.context7.com/mcp');
      expect(await height(row)).toBeLessThan(60);
      expect(await height(row)).toBeGreaterThan(44);
      // the switch is on the same line as the name, at the right
      const m = await row.evaluate((r) => { const b = (el) => el.getBoundingClientRect(); const sw = r.querySelector('[role="switch"]'); const nm = r.querySelector('.tr-l1'); return { rowRight: b(r).right, swLeft: b(sw).left, swRight: b(sw).right, swMid: (b(sw).top + b(sw).bottom) / 2, nameTop: b(nm).top, nameBottom: b(nm).bottom, mnRight: b(r.querySelector('.tr-mn')).right }; });
      expect(m.swMid).toBeGreaterThan(m.nameTop - 12);
      expect(m.swMid).toBeLessThan(m.nameBottom + 24); // beside the name, not under it
      expect(m.swLeft).toBeGreaterThan(500); // at the right
      expect(m.mnRight).toBeLessThanOrEqual(m.rowRight);
      // the list is much shorter than before: 3 rows plus the plugin's one in well under 4 x 95 px
      const list = await page.locator('#cz-list').evaluate((el) => el.getBoundingClientRect().height);
      expect(list).toBeLessThan(4 * 58);
      await shot(page, 'customize-connectors', scheme);
    });

    test('every action a connector row had is in its menu: Test, Trust read-only labels, Only in a folder, Remove; a connector a plugin provided has no Remove', async ({ page, request }) => {
      await seed(request);
      await page.goto('/src/ui/customize.html');
      const own = page.locator('.cz-row', { hasText: 'Context7' });
      await menuBtn(own).click();
      for (const name of ['Test', 'Trust read-only labels', 'Only in a folder…', 'Remove']) await expect(own.getByRole('menuitem', { name })).toBeVisible();
      await shot(page, 'customize-menu', scheme);
      await page.keyboard.press('Escape');
      await expect(own.getByRole('menu')).toHaveCount(0);
      const provided = page.locator('.cz-row', { hasText: 'Wiki docs' });
      await expect(provided.locator('.tr-chip')).toHaveText('Plugin');
      await expect(provided.locator('.tr-l2')).toContainText('Provided by the Developer docs pack plugin');
      await menuBtn(provided).click();
      await expect(provided.getByRole('menuitem', { name: 'Remove' })).toHaveCount(0);
      await expect(provided.getByRole('menuitem', { name: 'Provided by its plugin' })).toBeDisabled();
    });

    test('the switch works on the row, Remove works from the menu, and the menu follows the keyboard: Enter opens it, Down moves, Esc closes and gives the focus back; only one menu is open; a click elsewhere closes it', async ({ page, request }) => {
      await seed(request);
      await page.goto('/src/ui/customize.html');
      const row = page.locator('.cz-row', { hasText: 'Team wiki' });
      const sw = row.getByRole('switch');
      await expect(sw).toHaveAttribute('aria-checked', 'false');
      await sw.click();
      await expect(row.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      expect((await (await request.get('/api/mcp')).json()).find((c) => c.name === 'Team wiki').enabled).toBe(true);
      // keyboard
      const mn = menuBtn(row);
      await mn.focus();
      await page.keyboard.press('Enter');
      await expect(row.getByRole('menu')).toBeVisible();
      await expect(row.getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await expect(row.getByRole('menuitem').nth(1)).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(row.getByRole('menu')).toHaveCount(0);
      await expect(menuBtn(row)).toBeFocused();
      // only one menu at a time; a click elsewhere closes it
      await menuBtn(row).click();
      await menuBtn(page.locator('.cz-row', { hasText: 'DeepWiki' })).click();
      await expect(page.getByRole('menu')).toHaveCount(1);
      await page.locator('#cz-note').click();
      await expect(page.getByRole('menu')).toHaveCount(0);
      // Remove
      await menuBtn(row).click();
      await row.getByRole('menuitem', { name: 'Remove' }).click();
      await expect(page.locator('.cz-row', { hasText: 'Team wiki' })).toHaveCount(0);
      expect((await (await request.get('/api/mcp')).json()).some((c) => c.name === 'Team wiki')).toBe(false);
    });

    test('skills and plugins are tight rows too, with their own menus (Only in a folder, Remove / Update, Uninstall); a skill a plugin provided says so; select several still works', async ({ page, request }) => {
      await seed(request);
      await page.goto('/src/ui/customize.html');
      await page.getByRole('tab', { name: 'Skills' }).click();
      const rows = page.locator('.cz-row[role="row"]');
      await expect(rows).toHaveCount(4);
      for (const r of await rows.all()) expect(await height(r)).toBeLessThan(60);
      const own = rows.filter({ hasText: 'Code reviewer' });
      await expect(own.locator('.tr-l2')).toHaveText('Reviews a change for bugs before style');
      await menuBtn(own).click();
      await expect(own.getByRole('menuitem', { name: 'Only in a folder…' })).toBeVisible();
      await expect(own.getByRole('menuitem', { name: 'Remove' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(rows.filter({ hasText: 'Cite sources' }).locator('.tr-chip')).toHaveText('Plugin');
      await shot(page, 'customize-skills', scheme);
      // select two and use the bulk bar, as before
      await own.getByRole('checkbox').check();
      await rows.filter({ hasText: 'Commit message writer' }).getByRole('checkbox').check();
      await expect(page.locator('#cz-bulk-count')).toHaveText('2 selected');
      await page.locator('[data-bulk="off"]').click();
      await expect.poll(async () => (await (await request.get('/api/skills')).json()).filter((s) => ['Code reviewer', 'Commit message writer'].every(() => true) && s.enabled).length).toBe(1); // only the plugin's skill is still on
      await page.getByRole('tab', { name: 'Plugins' }).click();
      const plugin = page.locator('.cz-row', { hasText: 'Developer docs pack' });
      await expect(plugin.locator('.tr-chip').first()).toHaveText('2 items');
      expect(await height(plugin)).toBeLessThan(60);
      await menuBtn(plugin).click();
      await expect(plugin.getByRole('menuitem', { name: 'Uninstall' })).toBeVisible();
      await expect(plugin.getByRole('menuitem', { name: 'Only in a folder…' })).toBeVisible();
      await shot(page, 'customize-plugins', scheme);
    });

    test('Discover: the same row, with Add at the right instead of the switch, and "✓ Added" afterwards', async ({ page, request }) => {
      await seed(request);
      await page.goto('/src/ui/customize.html');
      await page.getByRole('button', { name: 'Discover' }).click();
      const rows = page.locator('.cz-row[role="row"]');
      const deepwiki = rows.filter({ hasText: 'DeepWiki' });
      await expect(deepwiki.locator('.tr-chip').first()).toHaveText('No sign-in');
      await expect(deepwiki.getByText('✓ Added')).toBeVisible(); // it is in Yours already
      const ctx7 = rows.filter({ hasText: 'Context7' });
      await expect(ctx7.getByText('✓ Added')).toBeVisible();
      await page.getByRole('tab', { name: 'Skills' }).click();
      const tests = page.locator('.cz-row', { hasText: 'Test writer' });
      await expect(tests.getByRole('button', { name: 'Add' })).toBeVisible();
      expect(await height(tests)).toBeLessThan(60);
      await tests.getByRole('button', { name: 'Add' }).click();
      await expect(page.locator('.cz-row', { hasText: 'Test writer' }).getByText('✓ Added')).toBeVisible();
    });
  });
}

for (const w of [360, 390, 412, 720]) {
  test(`Customize at ${w} px: a row stays one tight line, the switch and the menu button are on it, and nothing scrolls sideways`, async ({ page, request }) => {
    await seed(request);
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto('/src/ui/customize.html');
    for (const tab of ['Connectors', 'Skills', 'Plugins']) {
      await page.getByRole('tab', { name: tab }).click();
      for (const r of await page.locator('.cz-row[role="row"]').all()) {
        expect(await height(r), `${tab} row`).toBeLessThan(76);
        const b = await r.evaluate((el) => { const q = (s) => el.querySelector(s)?.getBoundingClientRect(); return { right: el.getBoundingClientRect().right, sw: q('[role="switch"]'), mn: q('.tr-mn'), vw: innerWidth }; });
        expect(b.sw.right).toBeLessThanOrEqual(b.vw + 0.5);
        expect(b.mn.right).toBeLessThanOrEqual(b.vw + 0.5);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab} sideways`).toBe(true);
    }
    // the menu stays on screen
    await page.getByRole('tab', { name: 'Connectors' }).click();
    await menuBtn(page.locator('.cz-row').first()).click();
    const menu = await page.getByRole('menu').boundingBox();
    expect(menu.x).toBeGreaterThanOrEqual(0);
    expect(menu.x + menu.width).toBeLessThanOrEqual(w + 0.5);
    if (w === 390) await shot(page, 'customize-phone-menu', 'light');
  });
}

for (const scheme of ['light', 'dark']) {
  test(`Automation, ${scheme}: MCP servers, Skills, Hooks and Schedules are tight rows with the switch at the right and Delete in the menu`, async ({ page, request }) => {
    await seed(request);
    for (const h of await (await request.get('/api/hooks')).json()) await request.delete(`/api/hooks/${h.id}`);
    for (const s of await (await request.get('/api/schedules')).json()) await request.delete(`/api/schedules/${s.id}`);
    await request.post('/api/hooks', { data: { name: 'note', event: 'reply.finished', command: 'echo hi' } });
    await request.post('/api/schedules', { data: { name: 'morning digest', everyMinutes: 60, prompt: 'summarise my day' } });
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/src/ui/automation.html');
    for (const [list, name] of [['#mcp-list', 'Context7'], ['#skill-list', 'Code reviewer'], ['#hook-list', 'note'], ['#schedule-list', 'morning digest']]) {
      const row = page.locator(`${list} .tr-row`, { hasText: name });
      await expect(row, list).toBeVisible();
      expect(await height(row), list).toBeLessThan(60);
      await expect(row.locator('.switch input[type="checkbox"]')).toBeVisible(); // the switch, on the row
      await menuBtn(row).click();
      await expect(row.getByRole('menuitem', { name: 'Delete' }), list).toBeVisible();
      await page.keyboard.press('Escape');
    }
    const mcp = page.locator('#mcp-list .tr-row', { hasText: 'Context7' });
    await menuBtn(mcp).click();
    await expect(mcp.getByRole('menuitem', { name: 'Check tools' })).toBeVisible();
    await page.keyboard.press('Escape');
    // the switch really switches
    const box = page.locator('#skill-list .tr-row', { hasText: 'Plain-language explainer' }).locator('.switch input[type="checkbox"]');
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(box).toBeChecked();
    await shot(page, 'automation', scheme);
    // Delete from the menu
    const del = page.locator('#hook-list .tr-row', { hasText: 'note' });
    await menuBtn(del).click();
    await del.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(page.locator('#hook-list .tr-row', { hasText: 'note' })).toHaveCount(0);
  });
}

import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// CLI-ENGINES (HIGH), Settings → Engines: exactly Bunny, Claude Code and Codex CLI (no Cline, no Aider); one row each; download with progress, the Local | Account switch (Codex's Account greyed with its note),
// the engine for new chats, roll back and remove; at phone width and in both themes. A stand-in engine and a fake download: nothing real.
const PAGE = '/src/ui/settings.html?embed=1&section=engines';

test.beforeEach(async ({ request }) => {
  await resetProfile(request).catch(() => {});
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {}); // a clean slate: nothing downloaded
  await request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true, engines: { 'claude-code': { auth: 'account' } } } }).catch(() => {});
});

// leave nothing behind: a downloaded stand-in engine would show the engine chip in every later spec's Code chats (and in the help pictures)
test.afterEach(async ({ request }) => {
  for (const id of ['claude-code', 'codex']) await request.delete(`/api/engines/${id}`).catch(() => {});
  await request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true } }).catch(() => {}); // and Bunny's engine back on: an Off left behind changes every later Code chat
});

test('Engines lists Bunny, Claude Code and Codex CLI and nothing else; each engine is one compact row', async ({ page }) => {
  await page.goto(PAGE);
  const rows = page.locator('#engines-list .er');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Bunny'); await expect(rows.nth(1)).toContainText('Claude Code'); await expect(rows.nth(2)).toContainText('Codex CLI');
  await expect(page.locator('#engines-section')).not.toContainText(/Cline|Aider/);
  await expect(rows.nth(1).locator('.l2')).toContainText('Not installed');
  for (const i of [0, 1, 2]) expect((await rows.nth(i).boundingBox()).height).toBeLessThanOrEqual(56);
  await expect(rows.nth(1).locator('.l2')).toHaveText('Not installed · 380 MB');
  await expect(page.locator('#engines-section')).not.toContainText('Bunny judges every step');
});

test('download Claude Code: progress, then the Local | Account switch with Account recommended; Local shows the Anthropic note; Codex Account is greyed with its note', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('#engines-list .er[data-id="claude-code"] [data-act="download"]').click();
  await expect(page.locator('#engines-list .er[data-id="claude-code"] .seg')).toBeVisible({ timeout: 15_000 });
  const row = page.locator('#engines-list .er[data-id="claude-code"]');
  await expect(row.locator('.l2')).toContainText('v1.0.0');
  await expect(row.locator('button[data-auth="account"]')).toHaveAttribute('aria-checked', 'true');
  await expect(row.locator('button[data-auth="account"] .rc')).toBeVisible();
  await row.locator('button[data-auth="local"]').click();
  await expect(row.locator('button[data-auth="local"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#engines-note')).toBeVisible();
  await expect(page.locator('#engines-note')).toContainText('Not supported by Anthropic');
  await page.locator('#engines-list .er[data-id="codex"] [data-act="download"]').click();
  const codex = page.locator('#engines-list .er[data-id="codex"]');
  await expect(codex.locator('.seg')).toBeVisible({ timeout: 15_000 });
  await expect(codex.locator('button[data-auth="account"]')).toBeDisabled();
  await expect(codex.locator('button[data-auth="account"]')).toHaveAttribute('title', /still being tested/);
  await expect(codex.locator('button[data-auth="local"]')).toHaveAttribute('aria-checked', 'true');
  // the engine for new chats lists what is downloaded
  const options = await page.locator('#engine-default option').allTextContents();
  expect(options).toEqual(['Bunny', 'Claude Code', 'Codex CLI']);
  await page.locator('#engine-default').selectOption('claude-code');
  await page.reload();
  await expect(page.locator('#engine-default')).toHaveValue('claude-code');
  // what was done is listed, newest first
  await expect(page.locator('#engines-record')).toContainText('Claude Code downloaded v1.0.0');
  await expect(row.locator('.l2')).not.toContainText('Account');
});

test('remove returns the row to Download; Cancel stops a download', async ({ page }) => {
  page.on('dialog', () => { throw new Error('the browser confirm/alert is not used'); });
  await page.goto(PAGE);
  await page.locator('#engines-list .er[data-id="codex"] [data-act="download"]').click();
  await expect(page.locator('#engines-list .er[data-id="codex"] .seg')).toBeVisible({ timeout: 15_000 });
  await page.locator('#engines-list .er[data-id="codex"] [data-act="menu"]').click();
  await page.locator('#engines-list .er[data-id="codex"] [data-act="remove"]').click();
  await page.locator('.engine-confirm').getByRole('button', { name: 'Remove' }).click();
  await expect(page.locator('#engines-list .er[data-id="codex"] [data-act="download"]')).toBeVisible();
  await page.locator('#engines-list .er[data-id="claude-code"] [data-act="download"]').click();
  const cancel = page.locator('#engines-list .er[data-id="claude-code"] [data-act="cancel"]');
  if (await cancel.isVisible().catch(() => false)) { await cancel.click(); await expect(page.locator('#engines-list .er[data-id="claude-code"] [data-act="download"]').or(page.locator('#engines-list .er[data-id="claude-code"] .seg'))).toBeVisible({ timeout: 15_000 }); }
});

for (const [scheme, width] of [['light', 1000], ['dark', 1000], ['light', 390], ['dark', 390]]) {
  test(`the Engines page at ${width}px in the ${scheme} theme: rows do not overflow`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PAGE);
    await expect(page.locator('#engines-list .er')).toHaveCount(3);
    const first = page.locator('#engines-list .er').nth(1);
    expect((await first.boundingBox()).height).toBeLessThanOrEqual(width < 620 ? 92 : 56);
    expect(await first.locator('.l2').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
  });
}

test('Claude Code in Account mode: Sign in appears when signed out, opens the vendor flow after a notice, then the row says Signed in; Sign out is in the menu behind a confirm card', async ({ page, request }) => {
  await request.post('/api/engines/claude-code/signout').catch(() => {});
  await page.goto(PAGE);
  const row = page.locator('#engines-list .er[data-id="claude-code"]');
  await row.locator('[data-act="download"]').click();
  await expect(row.locator('.seg')).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('[data-act="signin"]')).toBeVisible({ timeout: 10_000 });
  await expect(row.locator('.l2')).toContainText('Not signed in');
  // v0.1.14.1: the dialog says only what happened: with the page address the program printed, one button opens it (here the browser is a stand-in that answers for claude.ai); nothing says "a window opened"
  await page.context().route('https://claude.ai/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stand-in sign-in</title>' }));
  await row.locator('[data-act="signin"]').click();
  const dialog = page.locator('.engine-confirm');
  await expect(dialog).toContainText('Open the sign-in page in your browser');
  await expect(dialog).not.toContainText('A window opened');
  const popup = page.waitForEvent('popup');
  await dialog.getByRole('button', { name: 'Open the sign-in page' }).click();
  expect(new URL((await popup).url()).hostname).toBe('claude.ai');
  await expect(row.locator('.l2')).toContainText('Signed in', { timeout: 15_000 });
  await row.locator('[data-act="menu"]').click();
  await row.locator('[data-act="signout"]').click();
  await page.locator('.engine-confirm').getByRole('button', { name: 'Sign out' }).click();
  await expect(row.locator('[data-act="signin"]')).toBeVisible({ timeout: 10_000 });
});

test('Use Bunny\'s engine: turning it off asks first with the warning, then the warning stays on the page, the Rules page says it is not used, and Claude Code\'s own rules can be saved', async ({ page }) => {
  await page.goto(PAGE);
  const row = page.locator('#engines-list .er[data-id="claude-code"]');
  await row.locator('[data-act="download"]').click();
  await expect(row.locator('.seg')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#engines-warning')).toBeHidden();
  await page.locator('#engine-bunny-rules').uncheck({ force: true });
  await expect(page.locator('.engine-confirm')).toContainText("Bunny's engine is off.");
  await expect(page.locator('.engine-confirm')).toContainText('A command you allow can read any file on this PC that you can.');
  await page.locator('.engine-confirm').getByRole('button', { name: 'Turn it off' }).click();
  await expect(page.locator('#engines-warning')).toBeVisible();
  await expect(page.locator('#engines-warning')).toContainText("Claude Code's rules, which you set here");
  await expect(page.locator('#rules-engine-off')).toContainText("Not used while Bunny's engine is off. Claude Code's rules apply.");
  await page.locator('[data-add-input="allow"]').fill('Bash(npm test:*)');
  await page.locator('[data-add="allow"]').click();
  await page.locator('[data-add-input="deny"]').fill('Read(./secret/**)');
  await page.locator('[data-add="deny"]').click();
  await page.locator('#engine-rules-save').click();
  await expect(page.locator('#engine-rules-said')).toContainText('Saved');
  await page.reload();
  await expect(page.locator('#engine-bunny-rules')).not.toBeChecked();
  await expect(page.locator('#engine-rules .rg[data-kind="deny"] .rr code')).toHaveText('Read(./secret/**)');
  await expect(page.locator('#engine-rules .rg[data-kind="allow"] .rr code')).toHaveText('Bash(npm test:*)');
  await page.locator('#engine-bunny-rules').check({ force: true });
  await expect(page.locator('#engines-warning')).toBeHidden();
  await expect(page.locator('#engines-record')).toContainText("Bunny's engine turned on");
});

// ER-6 and ENGINE-RULES (Design's final review of 0.1.14): with Bunny's engine off, the warning is readable in both themes and the rules editor is a full-width, left-aligned column
for (const scheme of ['dark', 'light']) {
  test(`Bunny's engine off, ${scheme} theme: the warning text has at least 4.5:1 contrast on its fill; the Deny, Ask and Allow boxes fill the card's width, left-aligned, in that order, above a read-only list of what is always protected`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1000, height: 1300 });
    await page.goto(PAGE);
    const row = page.locator('#engines-list .er[data-id="claude-code"]');
    await row.locator('[data-act="download"]').click();
    await expect(row.locator('.seg')).toBeVisible({ timeout: 15_000 });
    await page.locator('#engine-bunny-rules').uncheck({ force: true });
    await page.locator('.engine-confirm').getByRole('button', { name: 'Turn it off' }).click();
    await expect(page.locator('#engines-warning')).toBeVisible();
    await expect(page.locator('#engine-rules .rg[data-kind="deny"]')).toBeVisible();
    const m = await page.evaluate(() => {
      const parse = (c) => { const n = c.match(/[\d.]+/g).map(Number); return { r: n[0], g: n[1], b: n[2], a: n.length > 3 ? n[3] : 1 }; };
      const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
      const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const w = document.getElementById('engines-warning');
      // the fill, composited over every ancestor's fill down to the page
      const chain = []; for (let e = w; e; e = e.parentElement) chain.push(e);
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (const e of chain.reverse()) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0) bg = over(c, bg); }
      const texts = [w, w.querySelector('b')].map((e) => parse(getComputedStyle(e).color));
      const ratios = texts.map((t) => { const a = lum(over(t, bg)) + 0.05, b = lum(bg) + 0.05; return Math.max(a, b) / Math.min(a, b); });
      const card = document.querySelector('#engine-rules .row.stack').getBoundingClientRect();
      const groups = [...document.querySelectorAll('#engine-rules .rg')].map((g) => { const r = g.getBoundingClientRect(); return { kind: g.dataset.kind, left: r.left, width: r.width, bottom: r.bottom }; });
      const heads = [...document.querySelectorAll('#engine-rules .rg .gh2')].map((h) => h.firstChild.textContent.trim());
      const floor = document.getElementById('engine-floor');
      return { ratios, rowLeft: card.left, rowWidth: card.width, tas: groups, labels: heads, floorText: floor?.textContent ?? '', floorInputs: floor ? floor.querySelectorAll('textarea,input,button').length : -1, floorBelow: floor ? floor.getBoundingClientRect().top >= groups.at(-1).bottom : false };
    });
    for (const r of m.ratios) expect(r, 'the warning text against its fill').toBeGreaterThanOrEqual(4.5);
    expect(m.labels).toEqual(['Deny', 'Ask', 'Allow']);
    for (const t of m.tas) {
      expect(t.width, `${t.kind} box fills the card`).toBeGreaterThanOrEqual(m.rowWidth * 0.9);
      expect(Math.abs(t.left - m.tas[0].left), `${t.kind} box starts where the others do`).toBeLessThanOrEqual(1);
      expect(t.left - m.rowLeft, `${t.kind} box is left-aligned in the card`).toBeLessThanOrEqual(24);
    }
    expect(m.floorText).toContain("Always protected from the engine's file tools, whatever the rules say");
    expect(m.floorText).toContain('Commands are not blocked: Bunny cannot see what a command reads.');
    expect(m.floorText).toContain("Bunny's own data folder");
    expect(m.floorText).toContain('private folders');
    expect(m.floorInputs).toBe(0);
    expect(m.floorBelow).toBe(true);
  });
}

// v0.1.15 C: the rules editor as drawn: Deny / Ask / Allow lists, one row per rule with Remove, an add line per list that checks Claude Code's own rule form, the floor read-only
for (const [scheme, width] of [['light', 1000], ['dark', 1000], ['light', 390], ['dark', 390]]) {
  test(`rules editor, ${scheme} theme at ${width}px: add, refuse a bad rule, remove, save and reload; the floor has no controls; nothing overflows`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 1300 });
    await page.goto(PAGE);
    const row = page.locator('#engines-list .er[data-id="claude-code"]');
    await row.locator('[data-act="download"]').click();
    await expect(row.locator('.seg')).toBeVisible({ timeout: 15_000 });
    await page.locator('#engine-bunny-rules').uncheck({ force: true });
    await page.locator('.engine-confirm').getByRole('button', { name: 'Turn it off' }).click();
    const list = (k) => page.locator(`#engine-rules .rg[data-kind="${k}"]`);
    await expect(list('deny')).toBeVisible();
    await expect(list('deny').locator('.rr.none')).toContainText('No deny rules.');
    // add one to each list
    for (const [k, rule] of [['deny', 'Bash(git push --force:*)'], ['ask', 'Bash(git push:*)'], ['allow', 'Read(./docs/**)'], ['allow', 'Bash(npm test:*)']]) {
      await list(k).locator(`[data-add-input="${k}"]`).fill(rule);
      await list(k).locator(`[data-add="${k}"]`).click();
    }
    await expect(list('allow').locator('.rr code')).toHaveText(['Read(./docs/**)', 'Bash(npm test:*)']);
    await expect(list('allow').locator('.rr .k')).toHaveText(['Path', 'Command']);
    await expect(page.locator('#engine-rules-said')).toContainText('Not saved yet');
    // Design: the group header and the kind chip are readable on the theme's own surface (not a fixed light fill)
    await expect(list('allow').locator('.rr .k').first()).toBeVisible();
    const contrast = await page.evaluate(() => {
      const rgb = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const ratio = (el) => { const cs = getComputedStyle(el); const a = lum(rgb(cs.color)) + 0.05, b = lum(rgb(cs.backgroundColor)) + 0.05; return Math.max(a, b) / Math.min(a, b); };
      return [...document.querySelectorAll('#engine-rules .gh2')].map(ratio);
    });
    for (const r of contrast) expect(r, 'Deny / Ask / Allow header text on its bar').toBeGreaterThanOrEqual(4.5);
    // a bad rule, a duplicate, and Bunny's own tool are refused beside the line, nothing is added
    for (const [bad, said] of [['not a rule!', "not in Claude Code's rule form"], ['Bash(npm test:*)', 'already in this list'], ['mcp__bunny__approve', "Bunny's own"], ['', 'Type a rule first']]) {
      await list('allow').locator('[data-add-input="allow"]').fill(bad);
      await list('allow').locator('[data-add="allow"]').click();
      await expect(list('allow').locator('[data-line-error]')).toContainText(said);
      await expect(list('allow').locator('.rr code')).toHaveCount(2);
    }
    // Enter adds; Remove takes one out
    await list('allow').locator('[data-add-input="allow"]').fill('Edit(./src/**)');
    await list('allow').locator('[data-add-input="allow"]').press('Enter');
    await expect(list('allow').locator('.rr code')).toHaveCount(3);
    await list('allow').locator('.rr', { hasText: 'Edit(./src/**)' }).getByRole('button', { name: /Remove/ }).click();
    await expect(list('allow').locator('.rr code')).toHaveText(['Read(./docs/**)', 'Bash(npm test:*)']);
    // save, reload: the same lists come back
    await page.locator('#engine-rules-save').click();
    await expect(page.locator('#engine-rules-said')).toContainText('Saved');
    await page.reload();
    await expect(list('deny').locator('.rr code')).toHaveText(['Bash(git push --force:*)']);
    await expect(list('ask').locator('.rr code')).toHaveText(['Bash(git push:*)']);
    await expect(list('allow').locator('.rr code')).toHaveText(['Read(./docs/**)', 'Bash(npm test:*)']);
    // removing the last rule of a list saves as an empty list
    await list('ask').getByRole('button', { name: /Remove/ }).click();
    await page.locator('#engine-rules-save').click();
    await expect(page.locator('#engine-rules-said')).toContainText('Saved');
    await expect(list('ask').locator('.rr.none')).toBeVisible();
    // the floor: read only, below the lists, with its agreed wording
    const floor = page.locator('#engine-floor');
    await expect(floor).toContainText("Always protected from the engine's file tools, whatever the rules say");
    await expect(floor.locator('input, button, textarea')).toHaveCount(0);
    expect((await floor.boundingBox()).y).toBeGreaterThan((await list('allow').boundingBox()).y);
    // nothing overflows sideways
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(1);
    const box = await list('allow').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  });
}

import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// SEARCH-PC: the Settings rows (off until turned on, with the one-time dialog), the fixed and own excluded folders, and the result list in a browser. Invented data only.
test.describe.configure({ mode: 'serial' });
test.afterEach(async ({ request }) => { await request.put('/api/settings', { data: { pcSearchEnabled: false, pcSearchAfter: 'read', pcSearchExcluded: [], pcSearchBarAuto: true } }); });

for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test('Search this PC is off until turned on; a dialog names what happens; Cancel leaves it off; Turn on saves the switch and the choice together', async ({ page, request }) => {
      await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
      const sw = page.locator('#pc-on');
      await expect(sw).not.toBeChecked();
      await expect(page.locator('#pc-after')).toBeDisabled();
      await sw.check();
      const dlg = page.locator('dialog.pc-dialog');
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText('Turn on Search this PC?');
      await expect(dlg).toContainText('never changes, moves or deletes');
      await expect(dlg).toContainText('the model of the chat you are in'); // not in a chat frame: it says so plainly
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(sw).not.toBeChecked();
      expect((await (await request.get('/api/settings')).json()).pcSearchEnabled).not.toBe(true);
      await sw.check();
      await page.locator('dialog.pc-dialog').getByRole('button', { name: 'Turn on' }).click();
      await expect(sw).toBeChecked();
      await expect(page.locator('#pc-after')).toBeEnabled();
      const saved = await (await request.get('/api/settings')).json();
      expect([saved.pcSearchEnabled, saved.pcSearchAfter]).toEqual([true, 'read']);
    });

    test('Excluded folders: the fixed list is read-only, the person adds and removes their own, and a path that is not a folder is refused', async ({ page, request }) => {
      await request.put('/api/settings', { data: { pcSearchEnabled: true } });
      await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
      await page.locator('#pc-excl-open').click();
      await expect(page.locator('#pc-fixed li')).not.toHaveCount(0);
      expect(await page.locator('#pc-fixed button').count()).toBe(0);
      await expect(page.locator('#pc-fixed')).toContainText('.ssh');
      await expect(page.locator('#pc-fixed')).toContainText('AppData');
      const folder = mkdtempSync(join(tmpdir(), 'bunny-e2e-pc-'));
      await page.locator('#pc-add-path').fill(folder);
      await page.locator('#pc-add-go').click();
      await expect(page.locator('#pc-excl-count')).toHaveText('1');
      await expect(page.locator('#pc-mine li').first()).toContainText('bunny-e2e-pc-');
      await page.locator('#pc-add-path').fill('C:\\no\\such\\folder-xyz');
      await page.locator('#pc-add-go').click();
      await expect(page.locator('#pc-excl-msg')).toContainText('not a folder');
      await expect(page.locator('#pc-excl-count')).toHaveText('1');
      await page.locator('#pc-mine').getByRole('button', { name: /Remove/ }).click();
      await expect(page.locator('#pc-excl-count')).toHaveText('0');
    });

    test('Activity says nothing yet when nothing was searched, and the Quick ask line tells the truth about its tools', async ({ page }) => {
      await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
      await page.locator('#pc-act-open').click();
      await expect(page.locator('#pc-act')).toContainText('Nothing yet.');
      await page.goto('/src/ui/settings.html?embed=1&section=desktop');
      await expect(page.locator('body')).toContainText('It uses no tools except reading the web');
      await expect(page.locator('body')).not.toContainText('it never uses tools or asks for permissions in the bar');
    });

    test('the result list: marked snippets are text (never HTML), 8 rows then Show more, the buttons only where the desktop bridge is, no sideways scroll on a phone', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 780 });
      await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
      const result = await page.evaluate(async () => {
        const { pcResultsView, markedNodes } = await import('/src/ui/pc-results.js');
        const rows = Array.from({ length: 11 }, (_, i) => ({ ref: `f${i}-abc`, name: `tax return ${i}.pdf`, folder: 'C:\\Users\\me\\Documents\\a-very-long-folder-name-for-the-tax-returns', modified: '2025-03-01 10:00:00', snippet: i === 0 ? 'Income <img src=x onerror="window.pwned=1"> and the TAX return' : 'plain tax text', openable: i % 2 === 0 }));
        const calls = [];
        const host = document.createElement('div');
        document.body.append(host);
        host.append(pcResultsView(document, rows, { terms: ['tax'], bridge: { pcSearch: { open: async (r) => { calls.push(['open', r]); return { ok: true }; }, show: async (r) => { calls.push(['show', r]); return { ok: true }; }, copy: async (r) => { calls.push(['copy', r]); return { ok: true }; } } }, onAsk: (row) => calls.push(['ask', row.ref]) }));
        const bare = document.createElement('div');
        document.body.append(bare);
        bare.append(pcResultsView(document, rows.slice(0, 2), { terms: ['tax'] }));
        const first = host.querySelector('.pc-row');
        host.querySelector('.pc-row button')?.click();
        await new Promise((r) => setTimeout(r, 20));
        return {
          visible: [...host.querySelectorAll('.pc-row')].filter((r) => !r.hidden).length,
          more: host.querySelector('.pc-more')?.textContent,
          marks: [...first.querySelectorAll('mark')].map((m) => m.textContent),
          imgs: first.querySelectorAll('img').length, pwned: window.pwned ?? null, snippet: first.querySelector('.pc-snippet').textContent,
          buttons: [...first.querySelectorAll('button')].map((b) => b.textContent), bareButtons: bare.querySelectorAll('button').length, calls,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1, nodes: markedNodes(document, 'a TAX b tax', ['tax']).map((n) => n.nodeName),
        };
      });
      expect(result.visible).toBe(8);
      expect(result.more).toBe('Show more (3)');
      expect(result.marks).toEqual(['TAX']);
      expect(result.imgs).toBe(0);
      expect(result.pwned).toBeNull();
      expect(result.snippet).toContain('<img src=x onerror=');
      expect(result.buttons).toEqual(['Open', 'Show in folder', 'Ask about this file', 'Copy path']);
      expect(result.bareButtons).toBe(0, 'a page without the desktop bridge draws the list without Open, Show in folder and Copy path');
      expect(result.calls[0]).toEqual(['open', 'f0-abc']);
      expect(result.overflow).toBe(false);
      expect(result.nodes).toEqual(['#text', 'MARK', '#text', 'MARK']);
    });
  });
}

// ---- in a chat, with the stand-in index over invented files (BUNNY_PCSEARCH_FAKE) ----
import { resetProfile, connectAnthropic, pickFirstModel } from './helpers.js';

for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 780 }]]) {
  test(`in a chat (${label}): the search step lists the invented files with the match marked, the files are read and named, and the answer carries on`, async ({ page, request }) => {
    await resetProfile(request);
    await request.put('/api/settings', { data: { pcSearchEnabled: true, pcSearchAfter: 'read' } });
    await page.setViewportSize(size);
    await connectAnthropic(page);
    await page.goto('/');
    await pickFirstModel(page);
    await page.locator('#input').fill('find my tax returns [[call search_pc {"terms":["tax"]}]]');
    await page.locator('#send').click();
    const step = page.locator('.tool-call-header', { hasText: 'Searched this PC for “tax” · 3 results' });
    await expect(step).toBeAttached({ timeout: 20_000 });
    await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
    for (const line of await page.locator('.tool-group-line').all()) { if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click(); } // the steps are folded into a group: open it
    await expect(step).toBeVisible();
    await expect(page.locator('.tool-call-header', { hasText: /^Read \d+ files?: / }).first()).toBeVisible();
    await step.click();
    const rows = page.locator('.pc-results .pc-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.first().locator('.pc-name')).toContainText('tax');
    await expect(rows.first().locator('.pc-folder')).toContainText('Documents'); // a saved chat keeps names, folders and dates; a snippet (file text) is shown live only (SP-8)
    await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    // a browser tab has no desktop bridge: the list has no Open, Show in folder or Copy path
    await expect(page.locator('.pc-results button', { hasText: /^(Open|Show in folder|Copy path)$/ })).toHaveCount(0);
    await expect(page.locator('.pc-results button', { hasText: 'Ask about this file' }).first()).toBeVisible();
    const chips = page.locator('.pc-sources .pc-chip');
    await expect(chips).toHaveCount(3); // the three files read are named under the answer, numbered
    await expect(chips.first().locator('b')).toHaveText('1');
    await expect(page.locator('.pc-sources-label')).toHaveText('Sources');
    await page.screenshot({ path: `test-results/search-pc-chat-${label}.png` });
    // the Activity record names what was done, by name
    const entries = (await (await request.get('/api/pcsearch/activity')).json()).entries;
    expect(entries.some((e) => e.kind === 'search' && e.results === 3 && e.who === 'window')).toBe(true);
    expect(entries.some((e) => e.kind === 'read' && e.files.length === 3)).toBe(true);
    await request.put('/api/settings', { data: { pcSearchEnabled: false } });
  });
}

test('answer marks: [1] and [2] become marks only for the sources the reply used, never inside code or a link; chips need the desktop bridge to open', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
  const out = await page.evaluate(async () => {
    const { markSourceNumbers, sourcesRow } = await import('/src/ui/pc-results.js');
    const root = document.createElement('div');
    root.innerHTML = '<p>Filed in April [1], total income $84,200 [2]. Not a source [7] or [0]. <code>a[1]</code> <a href="https://x.example/">link [2]</a></p>';
    document.body.append(root);
    markSourceNumbers(root, 2);
    const sources = [{ n: 1, name: 'Tax return 2025 - signed.pdf', folder: 'C:\docs', part: '3 pages', ref: 'f1-a', openable: true }, { n: 2, name: 'Accountant letter.docx', folder: 'C:\docs', part: 'whole file', ref: 'f2-b', openable: false }];
    const calls = [];
    const bare = sourcesRow(document, sources);
    const wired = sourcesRow(document, sources, { bridge: { pcSearch: { open: async (r) => { calls.push(['open', r]); return { ok: true }; }, show: async (r) => { calls.push(['show', r]); return { ok: true }; } } } });
    document.body.append(bare, wired);
    wired.querySelectorAll('button')[0].click();
    wired.querySelectorAll('button')[1].click();
    await new Promise((r) => setTimeout(r, 20));
    return { marks: [...root.querySelectorAll('b.pc-mark')].map((m) => m.textContent), text: root.textContent, codeMarks: root.querySelectorAll('code b, a b').length, bareButtons: bare.querySelectorAll('button').length, chips: wired.querySelectorAll('.pc-chip').length, calls, label: wired.querySelector('.pc-sources-label').textContent };
  });
  expect(out.marks).toEqual(['[1]', '[2]']);
  expect(out.text).toContain('Not a source [7] or [0]');
  expect(out.codeMarks).toBe(0);
  expect(out.bareButtons).toBe(0);
  expect(out.chips).toBe(2);
  expect(out.calls).toEqual([['open', 'f1-a'], ['show', 'f2-b']]);
  expect(out.label).toBe('Sources');
});

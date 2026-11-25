import { test, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// SEARCH-PC: the Settings rows (on for finding only until the person turns it off; turning it on again has the one-time dialog), the fixed and own excluded folders, and the result list in a browser. Invented data only.
test.describe.configure({ mode: 'serial' });
// every test starts from, and leaves behind, the default: Search this PC on for finding only. (The run shares one server and a saved key cannot be removed through the API, so the default is written as its own values; "nothing saved" is checked on a fresh data folder in test/pc-default-f8.test.js.)
const DEFAULT = { data: { pcSearchEnabled: true, pcSearchAfter: 'show', pcSearchBarAuto: true, pcSearchExcluded: [], pcSearchNoticeShown: false } };
test.beforeEach(async ({ request }) => { await resetProfile(request); await request.put('/api/settings', DEFAULT); });
test.afterEach(async ({ request }) => { await resetProfile(request); await request.put('/api/settings', DEFAULT); });

for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test('Search this PC is ON by default (finding only, showing what it found); a saved false shows it off; turning it on again asks, Cancel leaves it off, and Turn on saves the switch and the choice together', async ({ page, request }) => {
      await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
      const sw = page.locator('#pc-on');
      await expect(sw).toBeChecked();
      await expect(page.locator('#pc-after')).toBeEnabled();
      await expect(page.locator('#pc-after')).toHaveValue('show');
      await expect(page.locator('#pc-on-state')).toHaveText('on');
      // turning it off saves a false, which stays off after a reload
      await sw.uncheck();
      await expect(sw).not.toBeChecked();
      await expect(page.locator('#pc-after')).toBeDisabled();
      expect((await (await request.get('/api/settings')).json()).pcSearchEnabled).toBe(false);
      await page.reload();
      await expect(page.locator('#pc-on')).not.toBeChecked();
      // turning it on again asks, once, with the dialog
      await sw.check();
      const dlg = page.locator('dialog.pc-dialog');
      await expect(dlg).toBeVisible();
      await expect(dlg).toContainText('Turn on Search this PC?');
      await expect(dlg).toContainText('never changes, moves or deletes');
      await expect(dlg).toContainText('the model of the chat you are in'); // not in a chat frame: it says so plainly
      await dlg.getByRole('button', { name: 'Cancel' }).click();
      await expect(sw).not.toBeChecked();
      expect((await (await request.get('/api/settings')).json()).pcSearchEnabled).toBe(false);
      await sw.check();
      await page.locator('dialog.pc-dialog').getByRole('button', { name: 'Turn on' }).click();
      await expect(sw).toBeChecked();
      await expect(page.locator('#pc-after')).toBeEnabled();
      const saved = await (await request.get('/api/settings')).json();
      expect([saved.pcSearchEnabled, saved.pcSearchAfter]).toEqual([true, 'show']);
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
    // the steps are folded into a group: open it. The page can fold the group again just after the reply ends (it did on a busy PC), so open it again until the step shows
    await expect(async () => {
      for (const line of await page.locator('.tool-group-line').all()) { if ((await line.getAttribute('aria-expanded')) !== 'true') await line.click(); }
      await expect(step).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
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

// ---- AGENT-FLOW F8 and QUICK-ASK-JUST-WORKS: on by default for finding only, the first search says so once, and the card when it is off. They sit here, after the empty-Activity test, because the run shares one server and its activity record ----
const NOTICE = /Search this PC is on, for finding files only/;
async function ask(page, text, searches) {
  await page.locator('#input').fill(text);
  await page.locator('#send').click();
  // the reply has started when the search step is on the page (the stop button is hidden before it starts, so it alone proves nothing)
  await expect(page.locator('.tool-call-header', { hasText: 'Searched this PC' })).toHaveCount(searches, { timeout: 30_000 });
  await expect(page.locator('#stop')).toBeHidden({ timeout: 30_000 });
}

test('default on: a profile on its defaults searches ("nothing saved" is checked on a fresh data folder in test/pc-default-f8.test.js), the first search shows one notice, and the second shows none', async ({ page, request }) => {
  await resetProfile(request);
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);
  // the notice is a live card (it is not saved with the chat): count the times one is put on the page
  await page.evaluate((source) => {
    window.__notices = 0;
    new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && new RegExp(source).test(n.textContent ?? '') && n.querySelector?.('.capability-reason')) window.__notices += 1; }).observe(document.body, { childList: true, subtree: true });
  }, NOTICE.source);
  await ask(page, 'find my tax returns [[call search_pc {"terms":["tax"]}]]', 1);
  expect(await page.evaluate(() => window.__notices), 'one notice in the first search').toBe(1);
  const list = await (await request.get('/api/sessions')).json();
  const chat = JSON.stringify(await (await request.get(`/api/sessions/${list[0].id}`)).json());
  expect(chat).toContain('Searched this PC');
  expect(chat, 'the notice is not saved with the chat').not.toMatch(NOTICE);
  await ask(page, 'and again [[call search_pc {"terms":["return"]}]]', 2);
  expect(await page.evaluate(() => window.__notices), 'a second search: no second notice').toBe(1);
  const after = await (await request.get('/api/settings')).json();
  expect(after.pcSearchNoticeShown).toBe(true);
});

test('off: the card in the chat turns on finding only, and the search works in the same reply', async ({ page, request }) => {
  await resetProfile(request);
  await request.put('/api/settings', { data: { pcSearchEnabled: false, pcSearchAfter: 'read', pcSearchNoticeShown: true } });
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);
  await page.locator('#input').fill('find my tax returns [[call request_capability {"capability":"pc_search","reason":"find your tax return"}]] [[call search_pc {"terms":["tax"]}]]');
  await page.locator('#send').click();
  const card = page.locator('.capability-card', { hasText: 'Search this PC' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toContainText('File names and paths it finds, and the text of files it reads, go to the model');
  await expect(card).toContainText('Why it asks: "find your tax return"');
  await expect(card).toContainText('You can turn it off in Settings › Capabilities');
  await card.getByRole('button', { name: 'Turn on Search this PC' }).click();
  await expect(page.locator('#stop')).toBeHidden({ timeout: 30_000 });
  const settings = await (await request.get('/api/settings')).json();
  expect(settings.pcSearchEnabled).toBe(true);
  expect(settings.pcSearchAfter, 'finding only: the reading choice is unchanged').toBe('read');
  const list = await (await request.get('/api/sessions')).json();
  const saved = JSON.stringify(await (await request.get(`/api/sessions/${list[0].id}`)).json());
  expect(saved).toContain('Searched this PC');
});

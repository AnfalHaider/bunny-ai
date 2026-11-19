import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// SEARCH-PC in the Quick ask bar, state by state as drawn (figures 4 to 8 and the honest states). The bar's own page runs here with a stand-in for its preload
// (window.quickAsk): the real window needs Electron, but every state is plain data from the answerer, so the page can be driven by it.
// (Chromium will not load a module script from file://; Electron does. The repository's electron/quick-ask and src/ui folders are served on loopback for this run, files unchanged.)
const ROOT = fileURLToPath(new URL('../', import.meta.url));
let server;
let BAR = '';
test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
    if (!/^(electron\/quick-ask|src\/ui)\/[\w./-]+$/.test(path) || path.includes('..')) { res.writeHead(404).end(); return; }
    try { const body = await readFile(join(ROOT, path)); res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(body); } catch { res.writeHead(404).end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  BAR = `http://127.0.0.1:${server.address().port}/electron/quick-ask/bar.html`;
});
test.afterAll(() => new Promise((r) => server.close(r)));

async function openBar(page, { pcSearch = true } = {}) {
  await page.addInitScript((look) => {
    window.__calls = [];
    let listener = () => {};
    const note = (name) => (...args) => { window.__calls.push([name, ...args]); return Promise.resolve({ ok: true }); };
    window.quickAsk = new Proxy({
      init: () => Promise.resolve({ theme: 'system', font: 'system', motion: '', model: 'Auto', pcSearch: look.pcSearch }),
      onAnswer: (fn) => { listener = fn; return () => {}; },
      onEscape: () => () => {},
      ask: note('ask'), pcOpen: note('pcOpen'), pcShow: note('pcShow'), pcCopy: note('pcCopy'), openInBunny: note('openInBunny'), stop: note('stop'),
    }, { get: (target, key) => (key in target ? target[key] : note(String(key))) });
    window.__emit = (event) => listener(event);
  }, { pcSearch });
  await page.setViewportSize({ width: 760, height: 700 });
  await page.goto(BAR);
  await expect(page.locator('#text')).toBeVisible();
}
const calls = (page) => page.evaluate(() => window.__calls);
const emit = (page, event) => page.evaluate((e) => window.__emit(e), event);
const ROWS = [
  { ref: 'f1-a', name: 'Tax return 2025 - signed.pdf', folder: 'C:\\Users\\sam\\Documents\\Taxes', modified: '2025-04-12 10:00:00', snippet: 'total income tax return for the year ended 31 Dec 2024, filed jointly', openable: true },
  { ref: 'f2-b', name: 'Accountant letter - tax return.docx', folder: 'C:\\Users\\sam\\Documents\\Taxes', modified: '2025-04-02 10:00:00', snippet: 'Dear Sam, your tax return is ready', openable: true },
  { ref: 'f3-c', name: 'tax helper.exe', folder: 'C:\\Users\\sam\\Downloads', modified: '2025-01-02 10:00:00', snippet: '', openable: false },
];

for (const scheme of ['light', 'dark']) {
  test.describe(scheme, () => {
    test.use({ colorScheme: scheme });

    test('the + menu has Search this PC when it is on; choosing it puts a chip in the pill and Enter asks for a search; the chip can be removed', async ({ page }) => {
      await openBar(page);
      await page.locator('#text').fill('tax');
      await page.locator('#plus').click();
      await expect(page.locator('#pc-item')).toBeVisible();
      await expect(page.locator('#pc-item')).toContainText('Looks for this in files on this computer');
      await page.locator('#pc-item').click();
      await expect(page.locator('#pc-chip')).toContainText('Search this PC');
      await expect(page.locator('#msg')).toContainText('Enter searches');
      await page.locator('#pc-chip button').click();
      await expect(page.locator('#pc-chip')).toHaveCount(0);
      await page.locator('#text').fill('tax');
      await page.locator('#plus').click();
      await page.locator('#pc-item').click();
      await page.locator('#text').fill('tax return 2025');
      await page.keyboard.press('Enter');
      await expect.poll(async () => (await calls(page)).find((c) => c[0] === 'ask')).toEqual(['ask', 'tax return 2025', [], 'search-pc']);
    });

    test('without the switch the + menu has no Search this PC, and a question about a file is answered with how to turn it on, nothing asked', async ({ page }) => {
      await openBar(page, { pcSearch: false });
      await page.locator('#text').fill('tax');
      await page.locator('#plus').click();
      await expect(page.locator('#pc-item')).toBeHidden();
      await page.keyboard.press('Escape');
      await page.locator('#text').fill('find my tax return file');
      await page.keyboard.press('Enter');
      await expect(page.locator('#card')).toContainText('Search this PC is off');
      await expect(page.locator('#card')).toContainText('Turn it on in Settings › Capabilities to let Bunny look for files on this computer. Nothing was searched.');
      await page.locator('#card button', { hasText: 'Open Bunny settings' }).click();
      const all = await calls(page);
      expect(all.some((c) => c[0] === 'ask')).toBe(false);
      expect(all.find((c) => c[0] === 'openInBunny')).toEqual(['openInBunny', 'search-settings']);
    });

    test('searching, the list with its line, the keys, reading, a file that cannot be read, the answer with its sources', async ({ page }) => {
      await openBar(page);
      await page.locator('#text').fill('tax return 2025');
      await page.keyboard.press('Enter');
      await emit(page, { type: 'pc', state: 'searching', excluded: 9 });
      await expect(page.locator('#busy')).toContainText('Searching this PC…');
      await expect(page.locator('#busy')).toContainText('Windows Search · 9 folders excluded');
      await emit(page, { type: 'pc', state: 'results', title: 'Searched this PC for “tax return” · 3 results', total: 6, excluded: 9, rows: ROWS });
      const rows = page.locator('#pc-list .pcr');
      await expect(rows).toHaveCount(3);
      await expect(page.locator('#pc-list')).toContainText('3 of 6 results · Windows Search · 9 folders excluded');
      await expect(page.locator('#pc-list')).toContainText('Narrow it down, or ask about a file?');
      await expect(rows.first().locator('mark').first()).toHaveText(/tax/i);
      await expect(rows.first()).toHaveClass(/chosen/);
      await expect(rows.nth(2).locator('button', { hasText: 'Show in folder' })).toBeVisible(); // a program is shown, not opened
      await expect(rows.nth(2).locator('button', { hasText: /^Open$/ })).toHaveCount(0);
      await emit(page, { type: 'delta', text: 'These are the files I found.' });
      await emit(page, { type: 'done', model: 'Auto · Sonnet' });
      await page.locator('#follow').focus();
      await page.keyboard.press('ArrowDown');
      await expect(rows.nth(1)).toHaveClass(/chosen/);
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter'); // the third is a program: Show in folder
      await page.keyboard.press('Control+Enter'); // ask about the chosen file
      const all = await calls(page);
      expect(all.filter((c) => c[0] === 'pcOpen' || c[0] === 'pcShow')).toEqual([['pcOpen', 'f2-b'], ['pcShow', 'f3-c']]);
      expect(all.filter((c) => c[0] === 'ask').at(-1)[1]).toContain('(ref f3-c)');
      // reading, a file that cannot be read, then the answer with its sources
      await emit(page, { type: 'pc', state: 'reading', excluded: 9, files: ['Tax return 2025 - signed.pdf', 'Accountant letter - tax return.docx'] });
    });

    test('the answer with sources: the Read line, numbered chips that open the files, and where the text went', async ({ page }) => {
      await openBar(page);
      await page.locator('#text').fill('when did I file my 2024 return');
      await page.keyboard.press('Enter');
      await emit(page, { type: 'pc', state: 'reading', excluded: 9, files: ['Tax return 2025 - signed.pdf', 'Accountant letter - tax return.docx'] });
      await expect(page.locator('#busy')).toContainText('Reading 2 files: Tax return 2025 - signed.pdf, Accountant letter - tax return.docx');
      await emit(page, { type: 'pc', state: 'unreadable', excluded: 9, name: 'Scan 2023.pdf', why: 'it is a scanned picture with no text' });
      await expect(page.locator('#pc-list')).toContainText('Could not read “Scan 2023.pdf”: it is a scanned picture with no text.');
      await expect(page.locator('#pc-list')).toContainText('Only the file name and folder were used');
      await expect(page.locator('#pc-list')).toContainText('over 8 MB, in an excluded folder, locked by another program');
      const sources = [{ n: 1, name: 'Tax return 2025 - signed.pdf', folder: 'C:\\x', part: '3 pages', ref: 'f1-a', openable: true }, { n: 2, name: 'Accountant letter - tax return.docx', folder: 'C:\\x', part: 'whole file', ref: 'f2-b', openable: false }];
      await emit(page, { type: 'pc', state: 'read', excluded: 9, sources });
      await emit(page, { type: 'delta', text: 'Your 2024 return was filed on 12 April 2025 [1].' });
      await emit(page, { type: 'done', model: 'Auto · Sonnet', sources });
      await expect(page.locator('#pc-list')).toContainText('Read 2 files · Tax return 2025 - signed.pdf (3 pages), Accountant letter - tax return.docx (whole file)');
      const chips = page.locator('#pc-list .pcchip');
      await expect(chips).toHaveCount(2);
      await expect(chips.first()).toContainText('1 Tax return 2025 - signed.pdf · 3 pages');
      await expect(page.locator('#meta')).toHaveText('Answered by Auto · Sonnet · files read on this PC, sent to the model');
      await chips.nth(1).click();
      expect((await calls(page)).filter((c) => c[0] === 'pcShow' || c[0] === 'pcOpen')).toEqual([['pcShow', 'f2-b']]);
    });

    test('nothing found says how many folders are excluded and leads to them; Windows Search not available says what to do', async ({ page }) => {
      await openBar(page);
      await page.locator('#text').fill('zzzz');
      await page.keyboard.press('Enter');
      await emit(page, { type: 'pc', state: 'none', excluded: 9 });
      await expect(page.locator('#card')).toContainText('Windows has nothing indexed that matches. 9 folders are excluded, and files Windows has not indexed are not searched. Try another word, or check the excluded folders.');
      await expect(page.locator('#follow')).toHaveAttribute('placeholder', 'Type to search again');
      await page.locator('#card button', { hasText: 'Excluded folders' }).click();
      expect((await calls(page)).find((c) => c[0] === 'openInBunny')).toEqual(['openInBunny', 'search-settings']);
      await page.reload();
      await page.locator('#text').fill('tax');
      await page.keyboard.press('Enter');
      await emit(page, { type: 'pc', state: 'unavailable', excluded: 9 });
      await expect(page.locator('#card')).toContainText('Windows Search is not available');
      await expect(page.locator('#card')).toContainText('The Windows Search service is off or still building its index. Bunny does not search the disk itself. Start the service in Windows, then ask again.');
    });
  });
}

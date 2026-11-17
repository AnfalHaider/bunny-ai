import { test, expect } from '@playwright/test';

// L-1 (the owner's screenshot of Settings -> Code): nothing may sit on the border of its card. Measured on the embedded pages the Settings
// window shows, at 800 px (the content pane of a 1280 window) and 390 px, in light and dark, on the invented profile of the suite.
const WIDTHS = [[800, 16], [390, 12]]; // [width, the smallest gap to the card's border in px]
const SCHEMES = ['light', 'dark'];

/** Every text and control inside a .group: how far it is from the group's left and right border. */
async function gaps(page) {
  return page.evaluate(() => {
    const out = [];
    for (const group of document.querySelectorAll('.group')) {
      const g = group.getBoundingClientRect();
      if (!g.width || getComputedStyle(group).display === 'none') continue;
      for (const el of group.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.closest('[hidden]')) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
        const control = ['INPUT', 'SELECT', 'BUTTON', 'TEXTAREA'].includes(el.tagName);
        if (!own && !control) continue;
        out.push({ what: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${String(el.className).split(' ')[0]} "${(el.textContent || el.value || '').trim().slice(0, 24)}"`, left: Math.round(r.left - g.left), right: Math.round(g.right - r.right), group: group.id || group.className });
      }
    }
    return out;
  });
}

for (const scheme of SCHEMES) {
  for (const [width, least] of WIDTHS) {
    for (const section of ['code', 'privacy', 'appearance', 'capabilities']) {
      test(`settings → ${section}: nothing sits on a card border (${width} px, ${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/src/ui/settings.html?embed=1&section=${section}`);
        await page.waitForTimeout(600);
        const tight = (await gaps(page)).filter((x) => x.left < least || x.right < least);
        expect(tight, JSON.stringify(tight.slice(0, 6))).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      });
    }
  }
}

test('Code → Permission rules: one left edge for the heading, the text, the switch, the lists, the add row and the Try box; a line above the block', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  await page.waitForTimeout(600);
  const lefts = await page.evaluate(() => {
    const q = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().left) : null; };
    return { h3: q('#perm-rules h3'), lead: q('#perm-rules .lead'), tabs: q('#perm-rules .tabs2'), lists: q('#rules-lists .rl') ?? q('#rules-lists'), add: q('#rules-add'), tryBox: q('#rules-try-box'), card: q('#perm-rules').parentElement ? Math.round(document.querySelector('#perm-rules').parentElement.getBoundingClientRect().left) : null };
  });
  const edges = [lefts.h3, lefts.lead, lefts.tabs, lefts.add, lefts.tryBox].filter((x) => x !== null);
  expect(Math.max(...edges) - Math.min(...edges)).toBeLessThanOrEqual(1);
  expect(lefts.h3 - lefts.card).toBeGreaterThanOrEqual(16);
  const style = await page.evaluate(() => getComputedStyle(document.querySelector('#perm-rules')));
  expect(parseFloat(style.paddingLeft)).toBeGreaterThanOrEqual(16);
  expect(style.borderTopWidth).toBe('1px');
});

test('Privacy → Storage rows: the labels are 16 px in from the border, like every settings row', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/src/ui/settings.html?embed=1&section=privacy');
  await page.waitForTimeout(600);
  const pad = await page.evaluate(() => { const kv = document.querySelector('#storage > .kv'); return kv ? getComputedStyle(kv).paddingLeft : null; });
  expect(parseFloat(pad)).toBeGreaterThanOrEqual(16);
});

test('the Session pane keeps its own tight rows (the .kv fix does not change it)', async ({ page }) => {
  await page.goto('/');
  const pad = await page.evaluate(() => { const kv = document.querySelector('#rail .kv'); const s = getComputedStyle(kv); return [s.paddingLeft, s.paddingTop]; });
  expect(pad).toEqual(['0px', '4px']);
});

test('Appearance → Code: the two theme pickers start on the same line as the rows under them', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/src/ui/settings.html?embed=1&section=appearance');
  await page.waitForTimeout(600);
  const edges = await page.evaluate(() => {
    const pick = document.querySelector('.code-theme-pick select');
    const group = pick.closest('.group');
    const row = group.querySelector('.row .name');
    return { pick: Math.round(pick.getBoundingClientRect().left), row: row ? Math.round(row.getBoundingClientRect().left) : null };
  });
  expect(edges.row).not.toBeNull();
  expect(Math.abs(edges.pick - edges.row)).toBeLessThanOrEqual(1);
});

test('Providers: the key note has room above it', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/src/ui/providers.html');
  const margin = await page.evaluate(() => { const note = [...document.querySelectorAll('.page > p.note')].find((p) => /DPAPI/.test(p.textContent)); return note ? parseFloat(getComputedStyle(note).marginTop) : null; });
  expect(margin).toBeGreaterThanOrEqual(12);
});

test('Capabilities: "No tools built yet." is one quiet line, not a tall empty row', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto('/src/ui/settings.html?embed=1&section=capabilities');
  await page.waitForTimeout(600);
  const height = await page.evaluate(() => { const row = [...document.querySelectorAll('.group > .row.desc')].find((r) => /No tools built yet/.test(r.textContent)); return row ? row.getBoundingClientRect().height : null; });
  if (height !== null) expect(height).toBeLessThan(56);
});

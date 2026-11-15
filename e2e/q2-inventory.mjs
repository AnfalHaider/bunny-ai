/**
 * Q-2 inventory: every interactive control on every page, read from the live DOM.
 *
 *   BASE=http://127.0.0.1:5392 OUT=<temp> node e2e/q2-inventory.mjs
 *
 * Invented profile only: refuses to run unless /api/health says fake: true.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
if (!BASE || !OUT) throw new Error('set BASE and OUT');
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });

const PAGES = [
  '/', '/src/ui/settings.html?embed=1', '/src/ui/providers.html', '/src/ui/automation.html', '/src/ui/customize.html',
];
const browser = await chromium.launch();
const out = {};
for (const url of PAGES) {
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL: BASE })).newPage();
  await p.goto(url); await p.waitForTimeout(1200);
  out[url] = await p.evaluate(() => {
    const sel = 'button, a[href], input, select, textarea, summary, [role="tab"], [role="menuitem"], [role="option"], [data-view], [data-action], [data-settings], [data-section]';
    const seen = new Set(); const rows = [];
    for (const e of document.querySelectorAll(sel)) {
      const sect = e.closest('[data-section]')?.getAttribute('data-section') ?? e.closest('section, aside, header, nav, .menu, [role="menu"]')?.id ?? '';
      const name = (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 70);
      const key = `${e.tagName}|${e.id}|${name}|${sect}|${e.getAttribute('data-key') || ''}`;
      if (seen.has(key)) continue; seen.add(key);
      rows.push({ tag: e.tagName.toLowerCase(), id: e.id, type: e.type || '', name, sect, key: e.getAttribute('data-key') || e.getAttribute('data-view') || e.getAttribute('data-pane') || e.getAttribute('data-settings') || e.getAttribute('data-section') || '', hidden: e.hidden || !e.offsetParent });
    }
    return rows;
  });
  console.log(url, out[url].length);
}
await browser.close();
writeFileSync(`${OUT}/inventory.json`, JSON.stringify(out, null, 1));

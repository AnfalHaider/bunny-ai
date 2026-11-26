// Renders section 3c of the drawing at 390 and 1100 px, both themes: errors, overflow, screenshots.
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const OUT = process.env.OUT || 'C:/Work/lm3c';
fs.mkdirSync(OUT, { recursive: true });
const url = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[1100, 900], [390, 900]]) for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(url); await p.waitForTimeout(400);
    const ov = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const sec = p.locator('section', { has: p.locator('h2', { hasText: '3c' }) });
    await sec.screenshot({ path: `${OUT}/3c-${w}-${scheme}.png` });
    const empty = await p.evaluate(() => ['pc-card','pc-card-p','pc-add','pc-refuse','pc-gone','pc-nolm','pc-menu'].filter((i) => !document.getElementById(i).innerHTML.trim()));
    console.log(w, scheme, 'overflow', ov, 'empty', JSON.stringify(empty), 'errors', JSON.stringify(errs));
    await ctx.close();
  }
  await b.close();
})();

// Loads the drawing at phone and desktop widths in both themes: page errors, sideways scroll, and pictures.
const { chromium } = require('playwright');
const path = require('node:path');
(async () => {
  const b = await chromium.launch();
  const url = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/');
  for (const [w, h] of [[390, 900], [1100, 900]]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
      const p = await ctx.newPage();
      const errs = [];
      p.on('pageerror', (e) => errs.push(String(e)));
      p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      await p.goto(url);
      await p.waitForTimeout(200);
      const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, rows: document.querySelectorAll('.mrow').length, h: document.documentElement.scrollHeight }));
      console.log(w, scheme, JSON.stringify(r), errs.length ? errs : 'no errors');
      for (const k of ['none', 'setup', 'ready', 'run']) {
        await p.click(`#st button[data-k="${k}"]`);
        const o = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (o > 0) console.log('  overflow in state', k, o);
      }
      await p.click('#st button[data-k="ready"]');
      await p.screenshot({ path: path.join(__dirname, `chk-${w}-${scheme}.png`), fullPage: true });
      await ctx.close();
    }
  }
  await b.close();
})();

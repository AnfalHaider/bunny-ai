// Design: Engines rules with a rule in each list, invented profile. Usage: node check-rules-rows.cjs <output folder>
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const O = process.argv[2]; const W = 'http://127.0.0.1:5612';
(async () => {
  const b = await chromium.launch();
  for (const [w, h, nm] of [[1000, 1100, 'd'], [390, 1200, 'm']]) for (const sc of ['light', 'dark']) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc });
    await c.addInitScript(() => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; });
    const p = await c.newPage(); p.on('pageerror', (e) => console.log('ERR', e.message.slice(0, 100)));
    await fetch(W + '/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ useBunnyEngine: true }) });
    for (const id of ['claude-code', 'codex']) await fetch(W + '/api/engines/' + id, { method: 'DELETE' }).catch(() => {});
    await p.goto(W + '/src/ui/settings.html?embed=1&section=engines'); await p.waitForTimeout(1200);
    for (const id of ['claude-code', 'codex']) { await p.locator('#engines-list .er[data-id="' + id + '"] [data-act="download"]').click(); await p.locator('#engines-list .er[data-id="' + id + '"] .seg').waitFor({ timeout: 20000 }).catch(() => {}); }
    await p.waitForTimeout(500);
    await p.locator('#engine-bunny-rules').evaluate((e) => e.click()).catch(() => {});
    await p.waitForTimeout(500);
    const go = p.getByRole('button', { name: /Turn it off/ }); if (await go.count()) { await go.first().click(); await p.waitForTimeout(800); }
    for (const [k, rule] of [['deny', 'Read(./secrets/**)'], ['deny', 'Bash(rm:*)'], ['ask', 'Bash(git push:*)'], ['allow', 'Bash(npm test:*)']]) {
      await p.locator('[data-add-input="' + k + '"]').fill(rule); await p.locator('[data-add="' + k + '"]').click(); await p.waitForTimeout(250);
    }
    await p.locator('[data-add-input="deny"]').fill('rm everything'); await p.locator('[data-add="deny"]').click(); await p.waitForTimeout(250);
    console.log(nm, sc, 'line error:', await p.locator('[data-line-error="deny"]').innerText());
    await p.locator('[data-add-input="deny"]').fill('');
    console.log(nm, sc, 'rows:', (await p.locator('.rg .rr').allInnerTexts()).map((t) => t.split(String.fromCharCode(10)).join(' ')).join(' | '));
    const cr = await p.evaluate(() => { const lum = (s) => { const m = s.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; };
      return [...document.querySelectorAll('.gh2, .rr .k, .rr code, .rr .rm, .ra .btn2')].map((e) => { const cs = getComputedStyle(e); let bg = e, bgc; while (bg) { bgc = getComputedStyle(bg).backgroundColor; if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bgc)) break; bg = bg.parentElement; } const a = lum(cs.color), bb = lum(bgc || 'rgb(255,255,255)'); return e.className + ':' + (((Math.max(a, bb) + .05) / (Math.min(a, bb) + .05))).toFixed(1); }); });
    console.log(nm, sc, 'contrast:', [...new Set(cr)].join(' '));
    await p.screenshot({ path: O + '/rules-rows-' + nm + '-' + sc + '.png', fullPage: true });
    await c.close();
  }
  await b.close();
})();

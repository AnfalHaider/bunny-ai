// Design's check of TIGHT-ROWS in a build, invented profile. Usage: node check-rows.cjs <output folder> (window proxy on 127.0.0.1:5612)
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const O = process.argv[2]; const W = 'http://127.0.0.1:5612'; const NL = String.fromCharCode(10);
(async () => {
  const b = await chromium.launch(); const out = [];
  for (const [w, h, nm] of [[1000, 640, 'd'], [390, 844, 'm']]) for (const sc of ['light', 'dark']) {
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc });
    await c.addInitScript(() => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; });
    const p = await c.newPage(); p.on('pageerror', (e) => out.push('ERR ' + e.message.slice(0, 100)));
    await p.goto(W + '/src/ui/customize.html?embed=1'); await p.waitForTimeout(1500);
    for (const k of ['connectors', 'skills', 'plugins']) {
      await p.click('.cz-tab[data-kind=' + k + ']'); await p.waitForTimeout(500);
      const m = await p.evaluate(() => { const rs = [...document.querySelectorAll('#cz-list > *')]; const sw = document.querySelector('#cz-list [role=switch]'); const r0 = rs[0] ? rs[0].getBoundingClientRect() : null; const s0 = sw ? sw.getBoundingClientRect() : null; const nmEl = rs[0] ? rs[0].querySelector('b') : null; return { n: rs.length, total: Math.round(document.querySelector('#cz-list').getBoundingClientRect().height), each: rs.map((r) => Math.round(r.getBoundingClientRect().height)), switchSameLine: r0 && s0 ? (s0.top >= r0.top && s0.bottom <= r0.bottom) : null, menuBtn: !!document.querySelector('#cz-list [aria-haspopup=menu], #cz-list .cz-more'), text: rs.slice(0, 2).map((r) => r.innerText.split(String.fromCharCode(10)).join(' | ').slice(0, 120)) }; });
      out.push(nm + ' ' + sc + ' ' + k + ' ' + JSON.stringify(m));
      await p.screenshot({ path: O + '/chk-cz-' + k + '-' + nm + '-' + sc + '.png', fullPage: true });
    }
    await p.click('.cz-tab[data-kind=connectors]'); await p.waitForTimeout(300);
    const mb = p.locator('#cz-list [aria-haspopup=menu], #cz-list .cz-more').first();
    if (await mb.count()) { await mb.click(); await p.waitForTimeout(300); out.push(nm + ' ' + sc + ' menu: ' + (await p.evaluate(() => [...document.querySelectorAll('[role=menu]:not([hidden])')].map((m) => m.innerText.split(String.fromCharCode(10)).join(' / ')).join(' || ')))); await p.screenshot({ path: O + '/chk-cz-menu-' + nm + '-' + sc + '.png', fullPage: true }); }
    await p.goto(W + '/src/ui/customize.html?embed=1'); await p.waitForTimeout(800);
    await p.click('.cz-scope [data-scope=discover]'); await p.waitForTimeout(400); await p.screenshot({ path: O + '/chk-cz-discover-' + nm + '-' + sc + '.png', fullPage: true });
    await p.goto(W + '/src/ui/automation.html?embed=1'); await p.waitForTimeout(1200);
    out.push(nm + ' ' + sc + ' automation rows: ' + JSON.stringify(await p.evaluate(() => [...document.querySelectorAll('.cz-row, .trow, [class*=row]')].filter((e) => e.getBoundingClientRect().height > 20 && e.getBoundingClientRect().height < 120).slice(0, 12).map((e) => Math.round(e.getBoundingClientRect().height)))));
    await p.screenshot({ path: O + '/chk-auto-' + nm + '-' + sc + '.png', fullPage: true });
    await c.close();
  }
  require('fs').writeFileSync(O + '/log.txt', out.join(NL)); console.log(out.join(NL)); await b.close();
})();

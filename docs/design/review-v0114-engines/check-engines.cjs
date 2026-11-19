// Design's check of the built Settings → Engines page against the approved drawing, invented profile (fake engine stand-in). Usage: node check-engines.cjs <output folder> (window proxy on 127.0.0.1:5612)
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const O = process.argv[2]; const W = 'http://127.0.0.1:5612'; const NL = String.fromCharCode(10); const out = [];
const log = (k, v) => { out.push(k + ': ' + v); console.log(k + ': ' + v); };
(async () => {
  const b = await chromium.launch();
  for (const [w, h, nm] of [[1000, 900, 'd'], [390, 844, 'm']]) for (const sc of ['light', 'dark']) {
    const tag = nm + ' ' + sc;
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc });
    await c.addInitScript(() => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; });
    const p = await c.newPage(); p.on('pageerror', (e) => log(tag + ' PAGEERROR', e.message.slice(0, 120)));
    for (const id of ['claude-code', 'codex']) await fetch(W + '/api/engines/' + id, { method: 'DELETE' }).catch(() => {});
    await p.goto(W + '/src/ui/settings.html?embed=1&section=engines'); await p.waitForTimeout(1200);
    const rowInfo = () => p.evaluate(() => [...document.querySelectorAll('#engines-list .er')].map((r) => { const a = r.getBoundingClientRect(); const sw = r.querySelector('.seg,.onoff,[role=switch]'); const s = sw ? sw.getBoundingClientRect() : null; return { name: (r.querySelector('b') || {}).textContent, h: Math.round(a.height), dim: (r.querySelector('.l2') || {}).textContent, switchInline: s ? (s.top >= a.top - 1 && s.bottom <= a.bottom + 1) : null, chips: [...r.querySelectorAll('.chip,.badge')].map((x) => x.textContent).join('/'), btn: [...r.querySelectorAll('.btn2')].map((x) => x.textContent.trim()).join('/') }; }));
    log(tag + ' rows (nothing installed)', JSON.stringify(await rowInfo()));
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-empty.png', fullPage: true });
    await p.locator('#engines-list .er[data-id="claude-code"] [data-act="download"]').click(); await p.waitForTimeout(400);
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-downloading.png', fullPage: true });
    await p.locator('#engines-list .er[data-id="claude-code"] .seg').waitFor({ timeout: 20000 }); await p.waitForTimeout(300);
    log(tag + ' rows (Claude Code installed)', JSON.stringify(await rowInfo()));
    const dots = await p.evaluate(() => [...document.querySelectorAll('#engines-list .er')].map((r) => (r.querySelector('b') || {}).textContent + ':' + [...r.querySelectorAll('.seg button')].map((x) => x.textContent.trim() + (x.querySelector('.rc') ? '*' : '') + (x.disabled ? '(off)' : '')).join('|')).join('  '));
    log(tag + ' switch sides (* = recommended dot)', dots);
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-installed.png', fullPage: true });
    const mn = p.locator('#engines-list .er[data-id="claude-code"] .mn'); if (await mn.count()) { await mn.first().click(); await p.waitForTimeout(250); log(tag + ' menu', await p.evaluate(() => [...document.querySelectorAll('.menu2')].map((m) => m.innerText.split(String.fromCharCode(10)).join(' / ')).join(' || '))); await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-menu.png', fullPage: true }); }
    log(tag + ' overflow', await p.evaluate(() => document.documentElement.scrollWidth - innerWidth));
    log(tag + ' other rows', await p.evaluate(() => [...document.querySelectorAll('#engines-section .row .name')].map((e) => e.textContent).join(' | ') + ' // note hidden=' + (document.getElementById('engines-note') || {}).hidden));
    await c.close();
  }
  require('fs').writeFileSync(O + '/log.txt', out.join(NL)); await b.close();
})();

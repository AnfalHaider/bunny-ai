// Design: built chat top bar, devices chip and ⋯ sheet at phone widths, invented profile. Usage: node check-topbar.cjs <output folder> <main port> (window proxy on 127.0.0.1:5612)
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const O = process.argv[2], MAIN = Number(process.argv[3]); const W = 'http://127.0.0.1:5612', PASS = 'invented passcode 12', LAN = 'http://127.0.0.2:' + MAIN;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36';
const bridge = () => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; localStorage.setItem('bunny.modelAuto', '1'); };
const out = []; const log = (k, v) => { out.push(k + ': ' + v); console.log(k + ': ' + v); };
const bar = (p) => p.evaluate(() => { const tb = document.querySelector('.topbar'); const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; }; const btns = [...tb.querySelectorAll('button')].filter(vis); const cut = btns.filter((e) => e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.getAttribute('aria-label') || e.id || e.textContent.trim()); const t = document.getElementById('chat-title'); const c = document.getElementById('remote-chip'); return { n: btns.length, labels: btns.map((e) => e.getAttribute('aria-label') || e.id || e.textContent.trim()).join(','), cut, titleW: t ? Math.round(t.getBoundingClientRect().width) : null, chip: c ? c.innerText.trim() : null, notes: ['remote-note', 'device-note', 'device-notice'].filter((i) => document.getElementById(i)) }; });
(async () => {
  const b = await chromium.launch();
  await fetch(W + '/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) });
  for (const w of (process.argv[4] ? [1100] : [360, 390, 412, 720, 1100])) for (const sc of ['light', 'dark']) {
    const h = w === 1100 ? 760 : 820; const tag = w + ' ' + sc;
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc }); await c.addInitScript(bridge);
    const p = await c.newPage(); p.on('pageerror', (e) => log(tag + ' PAGEERROR', e.message.slice(0, 100)));
    await p.goto(W + '/src/ui/index.html'); await p.waitForTimeout(1800);
    await p.evaluate(() => { const t = document.getElementById('chat-title'); if (t && !t.textContent.trim()) t.textContent = 'Fix the failing sync test'; });
    log(tag + ' top bar', JSON.stringify(await bar(p)));
    await p.screenshot({ path: O + '/topbar-' + w + '-' + sc + '.png', clip: { x: 0, y: 0, width: w, height: 130 } });
    const more = p.locator('.topbar [aria-haspopup="menu"], .topbar #topbar-more, .topbar .more').first();
    if (await more.isVisible()) { await more.click(); await p.waitForTimeout(300); log(tag + ' sheet', (await p.evaluate(() => [...document.querySelectorAll('[role=menu]:not([hidden]), .sheet:not([hidden])')].map((m) => m.innerText.split(String.fromCharCode(10)).join(' / ')).join(' || '))).slice(0, 300)); await p.screenshot({ path: O + '/sheet-' + w + '-' + sc + '.png' }); } else log(tag + ' sheet', 'no ⋯ button found');
    await c.close();
  }
  // chip events
  const c = await b.newContext({ viewport: { width: 1100, height: 760 } }); await c.addInitScript(bridge);
  const p = await c.newPage(); await p.goto(W + '/src/ui/index.html'); await p.waitForTimeout(1500);
  log('chip state words', (await bar(p)).chip);
  const r = await fetch(LAN + '/api/remote/signin', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ passcode: PASS }) });
  await p.waitForTimeout(2500); log('after a sign-in', JSON.stringify(await bar(p)));
  const dlg = await p.$('#level-dialog'); if (dlg) { await p.screenshot({ path: O + '/chip-dialog.png' }); await p.locator('#level-go').click(); await p.waitForTimeout(800); }
  await p.screenshot({ path: O + '/chip-signin.png', clip: { x: 0, y: 0, width: 1100, height: 120 } });
  const dev = (await (await fetch(W + '/api/remote')).json()).devices[0];
  await fetch(W + '/api/remote/devices/' + dev.id + '/level', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'everything' }) });
  await p.waitForTimeout(2500); log('after Everything', JSON.stringify(await bar(p)));
  await p.screenshot({ path: O + '/chip-everything.png', clip: { x: 0, y: 0, width: 1100, height: 120 } });
  await p.locator('#remote-chip').click(); await p.waitForTimeout(500); log('after a click', JSON.stringify(await bar(p)));
  await p.screenshot({ path: O + '/chip-click.png' });
  // device page
  const sc0 = r.headers.get('set-cookie').split(';')[0]; const ix = sc0.indexOf('='); const cookie = { name: sc0.slice(0, ix), value: sc0.slice(ix + 1), url: LAN };
  for (const lvl of ['everything', 'chats']) {
    await fetch(W + '/api/remote/devices/' + dev.id + '/level', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: lvl }) });
    const c2 = await b.newContext({ viewport: { width: 390, height: 780 }, userAgent: UA }); await c2.addCookies([cookie]);
    const q = await c2.newPage(); await q.goto(LAN + '/'); await q.waitForTimeout(2200);
    log('device page ' + lvl, JSON.stringify(await q.evaluate(() => ({ chip: (document.getElementById('device-chip') || {}).innerText || null, notes: ['remote-note', 'device-note', 'device-notice', 'device-level-line'].filter((i) => document.getElementById(i)) }))));
    await q.screenshot({ path: O + '/devicepage-' + lvl + '.png', clip: { x: 0, y: 0, width: 390, height: 140 } }); await c2.close();
  }
  require('fs').writeFileSync(O + '/log-topbar.txt', out.join(String.fromCharCode(10))); await b.close();
})();

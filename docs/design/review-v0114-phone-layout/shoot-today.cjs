// Design: pictures of today's chat top bar and Settings at phone widths, invented profile. Usage: node shoot-today.cjs <output folder> <main port> (window proxy on 127.0.0.1:5612)
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const O = process.argv[2], MAIN = Number(process.argv[3]); const W = 'http://127.0.0.1:5612', PASS = 'invented passcode 12', LAN = 'http://127.0.0.2:' + MAIN;
const bridge = () => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; localStorage.setItem('bunny.modelAuto', '1'); };
(async () => {
  const b = await chromium.launch();
  await fetch(W + '/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: PASS }) });
  await fetch(LAN + '/api/remote/signin', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36' }, body: JSON.stringify({ passcode: PASS }) });
  const dev = (await (await fetch(W + '/api/remote')).json()).devices[0];
  await fetch(W + '/api/remote/devices/' + dev.id + '/level', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'chats' }) });
  for (const w of [360, 390, 412, 720]) for (const sc of ['light', 'dark']) {
    const h = w === 720 ? 900 : 800;
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc }); await c.addInitScript(bridge);
    const p = await c.newPage();
    await p.goto(W + '/src/ui/index.html'); await p.waitForTimeout(2200);
    const x = p.locator('#remote-note .rn-x'); if (await x.count()) { await x.click(); await p.waitForTimeout(250); }
    const m = await p.evaluate(() => { const tb = document.querySelector('.topbar'); const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth + 1; }; return { barW: Math.round(tb.getBoundingClientRect().width), scrollW: tb.scrollWidth, cut: [...tb.querySelectorAll('button')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1; }).map((e) => e.getAttribute('aria-label') || e.id || e.textContent.trim()), title: (document.getElementById('chat-title') || {}).getBoundingClientRect ? Math.round(document.getElementById('chat-title').getBoundingClientRect().width) : null, chip: (document.getElementById('remote-chip') || { innerText: null }).innerText }; });
    await p.screenshot({ path: O + '/today-composer-' + w + '-' + sc + '.png', clip: { x: 0, y: h - 240, width: w, height: 240 } });
    console.log(w, sc, 'chat', JSON.stringify(m));
    await p.screenshot({ path: O + '/today-chat-' + w + '-' + sc + '.png', clip: { x: 0, y: 0, width: w, height: 190 } });
    await p.keyboard.press('Control+Comma'); await p.waitForTimeout(1500);
    const s = await p.evaluate(() => { const l = document.querySelector('.settings-nav-list'); const rows = l ? [...l.querySelectorAll('.nav-row')] : []; return { n: rows.length, strip: l ? [Math.round(l.getBoundingClientRect().width), l.scrollWidth] : null, shown: rows.filter((r) => { const q = r.getBoundingClientRect(); return q.left >= 0 && q.right <= innerWidth + 1; }).length, names: rows.map((r) => r.textContent.trim()).join(',') }; });
    console.log(w, sc, 'settings', JSON.stringify(s));
    await p.screenshot({ path: O + '/today-settings-' + w + '-' + sc + '.png', });
    await c.close();
  }
  await b.close();
})();

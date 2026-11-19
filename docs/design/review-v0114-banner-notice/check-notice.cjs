// Design's check of BANNER-NOTICE in a build, invented profile. Usage: node check-notice.cjs <output folder> <main port> (window proxy on 127.0.0.1:5612, launcher as in earlier checks)
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const O = process.argv[2], MAIN = Number(process.argv[3]);
const W = 'http://127.0.0.1:5612', PASS = 'invented passcode 12', LAN = 'http://127.0.0.2:' + MAIN;
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36';
const bridge = () => { window.bunnyDesktop = { getPrefs: async () => ({}), setPrefs: async () => ({}), openInBrowser: async () => ({}) }; localStorage.setItem('bunny.modelAuto', '1'); };
const out = []; const log = (k, v) => { out.push(k + ': ' + v); console.log(k + ': ' + v); };
const put = (p, body, m = 'PUT') => fetch(W + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const state = async (p) => p.evaluate(() => {
  const n = document.getElementById('remote-note'), c = document.getElementById('remote-chip');
  const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width)]; };
  return { chip: c ? c.innerText.trim() : null, chipBad: c ? c.classList.contains('is-bad') : null, note: n ? n.innerText.split(String.fromCharCode(10)).join(' ').trim() : null, noteBox: n ? r(n) : null, bar: !!document.getElementById('remote-bar'), chipBox: c ? r(c) : null };
});
(async () => {
  const b = await chromium.launch();
  await put('/api/remote', { enabled: true, passcode: PASS });
  for (const [w, h, nm] of [[1100, 760, 'd'], [390, 844, 'm']]) for (const sc of ['light', 'dark']) {
    const tag = nm + ' ' + sc;
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc }); await c.addInitScript(bridge);
    const p = await c.newPage(); p.on('pageerror', (e) => log(tag + ' PAGEERROR', e.message.slice(0, 120)));
    await p.goto(W + '/src/ui/index.html'); await p.waitForTimeout(1800);
    log(tag + ' open, nobody signed in', JSON.stringify(await state(p)));
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-open.png' });
    if (sc === 'light' && nm === 'd') { await p.waitForTimeout(10500); log(tag + ' after 11 s, note', JSON.stringify((await state(p)).note)); }
    await c.close();
  }
  const r = await fetch(LAN + '/api/remote/signin', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA }, body: JSON.stringify({ passcode: PASS }) });
  const sc0 = r.headers.get('set-cookie').split(';')[0]; const ix = sc0.indexOf('='); const cookie = { name: sc0.slice(0, ix), value: sc0.slice(ix + 1), url: LAN };
  for (const [w, h, nm] of [[1100, 760, 'd'], [390, 844, 'm']]) for (const sc of ['light', 'dark']) {
    const tag = nm + ' ' + sc;
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc }); await c.addInitScript(bridge);
    const p = await c.newPage(); p.on('pageerror', (e) => log(tag + ' PAGEERROR', e.message.slice(0, 120)));
    await p.goto(W + '/src/ui/index.html'); await p.waitForTimeout(2200);
    log(tag + ' signed in: sign-in question shown', !!(await p.$('#level-dialog')));
    if (await p.$('#level-dialog')) { await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-dialog.png' }); await p.locator('#level-go').click(); await p.waitForTimeout(1500); }
    log(tag + ' after Keep Chats', JSON.stringify(await state(p)));
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-signedin.png' });
    const x = p.locator('#remote-note .rn-x'); if (await x.count()) { await x.click(); await p.waitForTimeout(300); }
    log(tag + ' after dismiss', JSON.stringify(await state(p)));
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-dismissed.png' });
    await p.locator('#remote-chip').click(); await p.waitForTimeout(300); log(tag + ' chip click brings the note', JSON.stringify((await state(p)).note));
    await p.reload(); await p.waitForTimeout(1800); log(tag + ' after reload, note back', !!(await state(p)).note);
    await c.close();
  }
  const dev = (await (await fetch(W + '/api/remote')).json()).devices[0];
  await put('/api/remote/devices/' + dev.id + '/level', { level: 'everything' }, 'PATCH');
  for (const [w, h, nm] of [[1100, 760, 'd'], [720, 800, 'n'], [390, 844, 'm']]) for (const sc of ['light', 'dark']) {
    const tag = nm + ' ' + sc;
    const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc }); await c.addInitScript(bridge);
    const p = await c.newPage();
    await p.goto(W + '/src/ui/index.html'); await p.waitForTimeout(2000);
    log(tag + ' EVERYTHING', JSON.stringify(await state(p)));
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-everything.png' });
    if (sc === 'light' && nm === 'd') { await p.waitForTimeout(11000); log(tag + ' Everything after 11 s, note still there', !!(await state(p)).note); }
    const x = p.locator('#remote-note .rn-x'); if (await x.count()) { await x.click(); await p.waitForTimeout(300); }
    await p.screenshot({ path: O + '/chk-' + nm + '-' + sc + '-everything-dismissed.png' });
    log(tag + ' Everything dismissed', JSON.stringify(await state(p)));
    await c.close();
  }
  for (const lvl of ['everything', 'chats']) {
    await put('/api/remote/devices/' + dev.id + '/level', { level: lvl }, 'PATCH');
    for (const [w, h, nm] of [[390, 780, 'm'], [1000, 700, 'd']]) for (const sc of ['light', 'dark']) {
      const c = await b.newContext({ viewport: { width: w, height: h }, colorScheme: sc, userAgent: UA }); await c.addCookies([cookie]);
      const p = await c.newPage(); p.on('pageerror', (e) => log('devpage PAGEERROR', e.message.slice(0, 100)));
      await p.goto(LAN + '/'); await p.waitForTimeout(2200);
      const info = await p.evaluate(() => ({ line: !!document.getElementById('device-level-line'), ids: [...document.querySelectorAll('[id]')].map((e) => e.id).filter((i) => /note|chip|level|device/i.test(i)).join(','), text: [...document.querySelectorAll('[id*=note],[id*=chip],[id*=level]')].map((e) => e.innerText.trim().slice(0, 90)).join(' | ') }));
      log('device page ' + lvl + ' ' + nm + ' ' + sc, JSON.stringify(info));
      await p.screenshot({ path: O + '/chk-dev-' + lvl + '-' + nm + '-' + sc + '.png' });
      await c.close();
    }
  }
  require('fs').writeFileSync(O + '/log.txt', out.join(String.fromCharCode(10))); await b.close();
})();

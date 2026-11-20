// Design: built Settings -> Engines with Use Bunny's engine turned off, invented profile, fake engine. Usage: node check-engine-rules.cjs <output folder>
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
    const confirm = await p.evaluate(() => (document.querySelector('[role=dialog], .confirm-card, dialog') || {}).innerText || 'none');
    console.log(nm, sc, 'confirm:', confirm.split(String.fromCharCode(10)).join(' | ').slice(0, 400));
    await p.screenshot({ path: O + '/rules-confirm-' + nm + '-' + sc + '.png', fullPage: true });
    const go = p.getByRole('button', { name: /Turn it off/ }); if (await go.count()) { await go.first().click(); await p.waitForTimeout(800); }
    await p.screenshot({ path: O + '/rules-off-' + nm + '-' + sc + '.png', fullPage: true });
    console.log(nm, sc, 'page text after:', (await p.evaluate(() => document.getElementById('engines-section').innerText)).split(String.fromCharCode(10)).join(' | ').slice(0, 900));
    await c.close();
  }
  await b.close();
})();

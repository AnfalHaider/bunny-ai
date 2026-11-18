// Design: "Copied" check of the Quick ask bar in a HEADED browser, invented data. Usage: node check-copied.cjs <extracted build> <out folder>
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const fs = require('fs'), http = require('http'), path = require('path');
const ROOT = path.resolve(process.argv[2]), S = path.resolve(process.argv[3]);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const srv = http.createServer((q, r) => { const t = path.normalize(path.join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname))); try { r.writeHead(200, { 'content-type': types[path.extname(t)] || 'application/octet-stream' }).end(fs.readFileSync(t)); } catch { r.writeHead(404).end(); } });
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch({ headless: false });
  const ctx = await b.newContext({ viewport: { width: 640, height: 400 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(() => { let l = null; window.quickAsk = new Proxy({ init: async () => ({ theme: 'light', font: 'system', model: 'Auto', motion: '' }), onAnswer: (f) => { l = f; return () => {}; }, onEscape: () => () => {}, resize: async () => ({}) }, { get: (t, k) => t[k] || (async () => ({ ok: true })) }); window.__emit = (e) => l && l(e); });
  const p = await ctx.newPage(); await p.goto(origin + '/electron/quick-ask/bar.html'); await p.waitForTimeout(600);
  await p.locator('#text').click(); await p.keyboard.type('Show me a command'); await p.locator('#go').click(); await p.waitForTimeout(200);
  await p.evaluate(() => { window.__emit({ type: 'delta', text: 'Try this:\n\n```powershell\nGet-ChildItem -Recurse\n```\n\nIt only reads.' }); window.__emit({ type: 'done', model: 'Auto', finished: true }); }); await p.waitForTimeout(300);
  await p.locator('button[aria-label^="Copy"]').first().click(); await p.waitForTimeout(300);
  console.log('answer Copy -> "' + await p.locator('.copied').innerText().catch(() => 'NONE') + '", clipboard=' + JSON.stringify((await p.evaluate(() => navigator.clipboard.readText())).slice(0, 40)));
  await p.screenshot({ path: S + '/q-copied-headed-answer.png' });
  const cb = p.locator('#ans pre button').first(); await cb.click(); await p.waitForTimeout(300);
  console.log('code Copy -> "' + await cb.innerText() + '", clipboard=' + JSON.stringify(await p.evaluate(() => navigator.clipboard.readText())));
  await p.screenshot({ path: S + '/q-copied-headed-code.png' });
  await b.close(); srv.close();
})();

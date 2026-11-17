import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/package.json');
const { chromium } = require('playwright');
const OUT = 'docs/design/review-w48b-build/shots';
const URL = 'file:///C:/Users/anfal/AppData/Local/Temp/claude/db2ceb7d21a15b59/6d10cf2b-4154-4546-8a5d-e8a524c281d8/scratchpad/w48b/electron/quick-ask/bar.html';
const b = await chromium.launch(); const log = [];
const scenarios = {
  image: { pick: { ok: true, id: 'f1', name: 'error-screen.png', preview: 'CANVAS' } },
  pdf: { pick: { ok: true, id: 'f2', name: 'quarterly-report-final-version-2-with-a-very-long-file-name.pdf' } },
  text: { pick: { ok: true, id: 'f3', name: 'notes.txt' } },
  toobig: { pick: { ok: false, message: 'That file is over 8 MB, so Bunny left it out.' } },
  cancel: { pick: { ok: false, cancelled: true } },
};
for (const scheme of ['light','dark']) {
  const ctx = await b.newContext({ viewport: { width: 700, height: 300 }, colorScheme: scheme });
  for (const [nm, sc] of Object.entries(scenarios)) {
    const p = await ctx.newPage();
    await p.addInitScript((sc) => { const c = document.createElement('canvas'); c.width = 34; c.height = 22; const g = c.getContext('2d'); const gr = g.createLinearGradient(0,0,34,22); gr.addColorStop(0,'#6a5acd'); gr.addColorStop(1,'#f2b66d'); g.fillStyle = gr; g.fillRect(0,0,34,22);
      const pick = { ...sc.pick }; if (pick.preview === 'CANVAS') pick.preview = c.toDataURL('image/png');
      window.__calls = []; window.quickAsk = { submit: async (t, a) => { window.__calls.push(['submit', t, JSON.stringify(a)]); return new Promise(() => {}); }, captureScreenshot: async () => ({ ok: false, message: 'x' }), pickFile: async () => { window.__calls.push(['pickFile']); return pick; }, dropFile: async () => { window.__calls.push(['dropFile']); return {}; } }; }, sc);
    await p.goto(URL); await p.waitForTimeout(300);
    await p.fill('#text', 'What is in this?');
    await p.click('#plus'); await p.waitForTimeout(150);
    if (nm === 'image') await p.screenshot({ path: OUT + '/menu-' + scheme + '.png' });
    log.push(scheme + ' ' + nm + ' menu items: ' + JSON.stringify(await p.locator('#menu [role=menuitem]').allInnerTexts()));
    await p.click('#file-item'); await p.waitForTimeout(250);
    const chip = await p.locator('#chips').evaluate(e => ({ hidden: e.hidden, text: e.innerText, w: Math.round(e.scrollWidth), cw: Math.round(e.clientWidth), imgs: e.querySelectorAll('img').length }));
    const msg = await p.locator('#msg').evaluate(e => ({ hidden: e.hidden, text: e.innerText, cls: e.className }));
    const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth || document.documentElement.scrollHeight > document.documentElement.clientHeight);
    log.push(scheme + ' ' + nm + ' chip ' + JSON.stringify(chip) + ' msg ' + JSON.stringify(msg) + ' overflow ' + over);
    await p.screenshot({ path: OUT + '/' + nm + '-' + scheme + '.png' });
    if (nm === 'image' || nm === 'pdf') { await p.click('#go'); await p.waitForTimeout(250); log.push(scheme + ' ' + nm + ' calls ' + JSON.stringify(await p.evaluate(() => window.__calls))); await p.screenshot({ path: OUT + '/' + nm + '-sending-' + scheme + '.png' }); }
    if (nm === 'pdf') { /* remove */ }
    await p.close();
  }
  // remove chip button
  const p = await ctx.newPage();
  await p.addInitScript(() => { window.__calls = []; window.quickAsk = { submit: async () => ({}), captureScreenshot: async () => ({ ok: false }), pickFile: async () => ({ ok: true, id: 'f3', name: 'notes.txt' }), dropFile: async () => { window.__calls.push('dropFile'); return {}; } }; });
  await p.goto(URL); await p.click('#plus'); await p.click('#file-item'); await p.waitForTimeout(200); await p.click('#chips button'); await p.waitForTimeout(200);
  log.push(scheme + ' remove: chipsHidden ' + await p.locator('#chips').evaluate(e => e.hidden) + ' calls ' + JSON.stringify(await p.evaluate(() => window.__calls)) + ' removeLabel check done');
  await ctx.close();
}
fs.writeFileSync(OUT + '/log.txt', log.join('\n')); await b.close(); console.log(log.join('\n'));

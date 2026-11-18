// Design's check of the Quick ask bar in the v0.1.13 candidate: runs the bar's own page (electron/quick-ask/bar.html) from an extracted build, at the bar's size,
// with a stand-in for the bridge, on invented data. Usage: node check-bar.cjs <extracted build folder> <output folder>
const { chromium } = require('D:/Projects/OPEN CODE PROJECTS/BUNNY-AI/node_modules/playwright');
const fs = require('fs');
const http = require('http');
const path = require('path');
const NL = String.fromCharCode(10);
const typeIn = async (p, t) => { await p.locator('#text').click(); await p.keyboard.type(t); };
const ROOT = path.resolve(process.argv[2]);
const S = path.resolve(process.argv[3]);
fs.mkdirSync(S, { recursive: true });
const out = [];
const log = (k, v) => { out.push(k + ': ' + v); console.log(k + ': ' + v); };
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json' };
const srv = http.createServer((req, res) => {
  const t = path.normalize(path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  const rel = t.startsWith(ROOT + path.sep) ? t.slice(ROOT.length + 1).split(String.fromCharCode(92)).join('/') : '';
  if (!/^(electron\/quick-ask|src\/ui)\//.test(rel)) { res.writeHead(404).end(); return; }
  try { res.writeHead(200, { 'content-type': types[path.extname(t)] || 'application/octet-stream' }).end(fs.readFileSync(t)); } catch { res.writeHead(404).end(); }
});
const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const LONG = Array.from({ length: 9 }, (_, i) => '**Step ' + (i + 1) + '.** Put the ingredient list on the left and the timings on the right, so the cook can read both at a glance. Keep each line under ten words.').join(NL + NL);
const CODE = ['Here is a one-liner that lists the five biggest files in a folder:', '', '```powershell', 'Get-ChildItem -Recurse -File | Sort-Object Length -Descending | Select-Object -First 5 Name, Length', '```', '', 'It reads only; nothing is changed. Add `-Force` to include hidden files.'].join(NL);
(async () => {
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: 640, height: 700 }, colorScheme: scheme });
    await ctx.addInitScript((a) => {
      window.__calls = []; let l = null; let esc = null; window.__h = [];
      const rec = (n) => async () => { window.__calls.push(n); return { ok: true }; };
      window.quickAsk = {
        captureScreenshot: async () => ({ ok: true, data: a.pix }), pickFile: async () => ({ ok: true, id: 'x1', name: 'recipe-notes.pdf', kind: 'pdf', size: 1000 }), dropFile: rec('dropFile'), submit: rec('submit'),
        ask: async () => ({ ok: true }), stop: rec('stop'), openInBunny: async (t) => { window.__calls.push('open:' + (t || '')); return { ok: true }; },
        resize: async (h) => { window.__h.push(h); return { ok: true }; }, onAnswer: (fn) => { l = fn; return () => {}; },
        init: async () => ({ theme: a.scheme, font: 'system', model: 'Auto', motion: '' }), close: rec('close'), escHandled: rec('escHandled'), onEscape: (fn) => { esc = fn; return () => {}; },
      };
      window.__emit = (e) => l && l(e); window.__esc = () => esc && esc();
    }, { pix: PIX, scheme });
    const fresh = async () => { const p = await ctx.newPage(); p.on('pageerror', (e) => log(scheme + ' PAGEERROR', e.message.slice(0, 140))); await p.goto(origin + '/electron/quick-ask/bar.html'); await p.waitForTimeout(700); return p; };
    const shot = async (p, name) => { await p.waitForTimeout(350); await p.screenshot({ omitBackground: true, path: S + '/q-' + name + '-' + scheme + '.png' }); };
    const hint = async (p) => (await p.locator('#hint').innerText().catch(() => 'NONE')).split(NL).join(' ');
    let p = await fresh();
    log(scheme + ' empty pill', await p.evaluate(() => { const e = document.querySelector('.bar') || document.querySelector('.pill'); const r = e.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height) + ' radius ' + getComputedStyle(e).borderRadius + ' bg ' + getComputedStyle(e).backgroundColor; }));
    log(scheme + ' placeholder', await p.evaluate(() => document.getElementById('text').placeholder));
    log(scheme + ' visible buttons when empty', await p.evaluate(() => [...document.querySelectorAll('button')].filter((x) => { const r = x.getBoundingClientRect(); const cs = getComputedStyle(x); return r.width > 2 && cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none'; }).map((x) => x.id + ':' + x.getAttribute('aria-label')).join(',') || 'none'));
    await shot(p, 'empty');
    await typeIn(p, 'How do I plan a week of cheap dinners?'); await shot(p, 'typing'); log(scheme + ' keys line when typing', await hint(p));
    await p.locator('#plus').click(); await p.waitForTimeout(300); await shot(p, 'menu'); log(scheme + ' resize heights asked', await p.evaluate(() => window.__h.join(',')));
    await p.evaluate(() => window.__esc()); await p.waitForTimeout(200);
    log(scheme + ' Esc with menu open', 'menu hidden=' + (await p.evaluate(() => document.getElementById('menu').hidden)) + ' calls=' + (await p.evaluate(() => window.__calls.join(','))));
    await p.locator('#plus').click(); await p.locator('#shot-item').click(); await p.waitForTimeout(250); await shot(p, 'chip');
    await p.locator('#go').click(); await p.waitForTimeout(350); await shot(p, 'thinking');
    log(scheme + ' Stop icon', await p.evaluate(() => { const s = document.querySelector('#go svg'); const r = s ? s.getBoundingClientRect() : { width: 0, height: 0 }; return JSON.stringify({ ns: s && s.namespaceURI, w: r.width, h: r.height, btn: Math.round(document.getElementById('go').getBoundingClientRect().width) }); }));
    log(scheme + ' keys while thinking', await hint(p));
    await p.evaluate(() => window.__esc()); await p.waitForTimeout(150); log(scheme + ' Esc while answering', await p.evaluate(() => window.__calls.slice(-2).join(',')));
    await p.evaluate(() => { window.__emit({ type: 'delta', text: 'A short plan: cook a big pot of **beans and rice** on Sunday, then change the toppings each night.' }); window.__emit({ type: 'done', model: 'Auto', finished: true }); }); await p.waitForTimeout(250); await shot(p, 'short');
    log(scheme + ' visible buttons after answer', await p.evaluate(() => [...document.querySelectorAll('button')].filter((x) => { const r = x.getBoundingClientRect(); return r.width > 2 && getComputedStyle(x).opacity !== '0'; }).map((x) => (x.id || '-') + ':' + x.getAttribute('aria-label') + ':' + Math.round(x.getBoundingClientRect().width) + 'px svg ' + Math.round((x.querySelector('svg') || { getBoundingClientRect: () => ({ width: 0 }) }).getBoundingClientRect().width)).join(' | ')));
    await p.locator('button[aria-label^="Copy"]').first().click(); await p.waitForTimeout(250); await shot(p, 'copied');
    log(scheme + ' text after Copy', await p.evaluate(() => (document.querySelector('.copied') || document.querySelector('#said') || { innerText: 'no confirmation element' }).innerText));
    log(scheme + ' keys after answer', await hint(p));
    await p.keyboard.press('Control+Enter'); await p.waitForTimeout(150); log(scheme + ' Ctrl+Enter', await p.evaluate(() => window.__calls.slice(-1)[0]));
    await p.close();
    for (const nm of ['long', 'code']) {
      const text = nm === 'long' ? LONG : CODE;
      p = await fresh(); await typeIn(p, 'Question for ' + nm); await p.locator('#go').click(); await p.waitForTimeout(200);
      await p.evaluate((t) => { window.__emit({ type: 'delta', text: t.slice(0, 200) }); }, text); await p.waitForTimeout(100);
      await p.evaluate((t) => { window.__emit({ type: 'delta', text: t.slice(200) }); window.__emit({ type: 'done', model: 'Auto', finished: true }); }, text); await p.waitForTimeout(250);
      if (nm === 'long') log(scheme + ' long answer', 'scrollTop ' + (await p.evaluate(() => document.getElementById('ans').scrollTop)) + ' of ' + (await p.evaluate(() => document.getElementById('ans').scrollHeight)) + '; latest pill ' + (await p.evaluate(() => !!document.querySelector('.latest, #latest, [data-latest]'))));
      if (nm === 'code') log(scheme + ' code block Copy button', await p.evaluate(() => !!document.querySelector('.cpy, .code-copy, #ans pre button, #ans .copy')));
      await shot(p, nm); await p.close();
    }
    p = await fresh(); await typeIn(p, 'Q1 first question'); await p.locator('#go').click(); await p.waitForTimeout(150);
    await p.evaluate(() => { window.__emit({ type: 'delta', text: 'First answer.' }); window.__emit({ type: 'done', model: 'Auto', finished: true }); }); await p.waitForTimeout(250);
    await p.locator('#follow').fill('And what about a microwave?'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    await p.evaluate(() => { window.__emit({ type: 'delta', text: 'Second answer.' }); window.__emit({ type: 'done', model: 'Auto', finished: true }); }); await p.waitForTimeout(250);
    log(scheme + ' earlier turns', await p.evaluate(() => (/Earlier/i.test(document.body.innerText) ? 'Earlier row present' : 'no earlier row'))); await shot(p, 'earlier'); await p.close();
    for (const nm of ['no-model', 'offline', 'needs-window']) {
      const ev = nm === 'no-model' ? { type: 'error', kind: 'none', message: '' } : nm === 'offline' ? { type: 'error', kind: 'offline', message: '' } : { type: 'needs-window', text: 'I can open that folder for you.' };
      p = await fresh(); await typeIn(p, 'Open my downloads folder'); await p.locator('#go').click(); await p.waitForTimeout(200); await p.evaluate((e) => window.__emit(e), ev); await p.waitForTimeout(300);
      log(scheme + ' ' + nm + ' focus', await p.evaluate(() => (document.activeElement && (document.activeElement.id || document.activeElement.textContent.slice(0, 24))) || 'none'));
      log(scheme + ' ' + nm + ' buttons', await p.evaluate(() => [...document.querySelectorAll('#card button')].map((x) => x.textContent.trim()).join(' | '))); await shot(p, nm); await p.close();
    }
    await ctx.close();
  }
  fs.writeFileSync(S + '/log-bar.txt', out.join(NL)); await b.close(); srv.close();
})();

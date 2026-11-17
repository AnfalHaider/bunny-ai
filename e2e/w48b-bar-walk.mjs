/**
 * QA, W4-8 at 5c8c25a: the quick-ask bar page at the real window size (700 x 300, and a narrower 420 x 300 for a small screen), light and dark:
 * the + menu is not cut off in any state, "Opening Bunny…" is normal text with a small spinner, a real problem stays amber with no spinner.
 * The bar page runs in Chromium with a stand-in for the two bridge calls (captureScreenshot, submit). Electron itself is NOT started here.
 *   node e2e/w48b-bar-walk.mjs      (screenshots to $SHOTS or the temp folder)
 */
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const SHOTS = process.env.SHOTS || join(mkdtempSync(join(tmpdir(), 'bunny-w48b-')), 'shots'); mkdirSync(SHOTS, { recursive: true });
const BAR = pathToFileURL(resolve('electron/quick-ask/bar.html')).href;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 230) : ''}`); };
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const quick = readFileSync(resolve('electron/quick-ask.js'), 'utf8');
check('W0', 'the real window is created 700 wide and 300 high and set to 300 high when shown (so the page is tested at the size it really gets)', /width: 700/.test(quick) && /height: 300/.test(quick) && /height: 300 \}\)/.test(quick));

const browser = await chromium.launch();
async function open({ w, scheme, submit = 'wait', reduced = false }) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 300 }, colorScheme: scheme, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(({ pixel, mode }) => {
    window.__submits = 0;
    window.quickAsk = {
      captureScreenshot: async () => ({ ok: true, data: pixel }),
      submit: () => { window.__submits += 1; return mode === 'wait' ? new Promise(() => {}) : Promise.resolve({ ok: false }); },
    };
  }, { pixel: PIXEL, mode: submit });
  await page.goto(BAR);
  return { ctx, page, errors };
}
const geometry = (page) => page.evaluate(() => {
  const m = document.getElementById('menu'); const r = m.getBoundingClientRect(); const b = document.body.getBoundingClientRect();
  const items = [...m.querySelectorAll('[role=menuitem]')].map((i) => ({ clipped: i.scrollWidth > i.clientWidth + 1 || i.scrollHeight > i.clientHeight + 1, bottom: i.getBoundingClientRect().bottom, right: i.getBoundingClientRect().right }));
  return { hidden: m.hidden, top: r.top, bottom: r.bottom, left: r.left, right: r.right, bodyBottom: b.bottom, inner: [window.innerWidth, window.innerHeight], htmlH: document.documentElement.clientHeight, bodyH: Math.round(b.height), items, scrollH: document.documentElement.scrollHeight };
});
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1} of a long note`).join('\n');
const states = {
  'plain': async () => {},
  'with a screenshot chip': async (p) => { await p.locator('#plus').click(); await p.locator('#shot-item').click(); await p.locator('.chip').waitFor(); },
  'with 25 lines of text': async (p) => { await p.locator('#text').fill(lines(25)); },
  'with a problem message': async (p) => { await p.evaluate(() => { document.getElementById('msg').hidden = false; document.getElementById('msg').textContent = 'Bunny could not take a screenshot.'; document.getElementById('msg').classList.add('is-problem'); }); },
  'while Opening Bunny…': null, // done through the page below
};
for (const w of [700, 420]) for (const scheme of ['light', 'dark']) {
  const tag = `${w}px/${scheme}`;
  for (const [name, prep] of Object.entries(states)) {
    if (!prep) continue;
    const { ctx, page } = await open({ w, scheme });
    await prep(page);
    await page.locator('#plus').click();
    const g = await geometry(page);
    check(`M1 ${tag} ${name}`, `the + menu (${name}) is fully inside the window: its bottom ${Math.round(g.bottom)} and right ${Math.round(g.right)} are within 300 high and ${w} wide, and not cut by the page`, !g.hidden && g.bottom <= g.inner[1] + 0.5 && g.bottom <= g.bodyBottom + 0.5 && g.right <= g.inner[0] + 0.5 && g.left >= 0 && g.top >= 0, JSON.stringify({ top: Math.round(g.top), bottom: Math.round(g.bottom), inner: g.inner, bodyBottom: Math.round(g.bodyBottom) }));
    check(`M2 ${tag} ${name}`, 'its items are not clipped (text and sub-line fully inside each item)', g.items.length >= 1 && g.items.every((i) => !i.clipped), JSON.stringify(g.items));
    if (name === 'plain') {
      check(`M3 ${tag}`, 'html and body fill the whole window (height 300) and nothing scrolls', g.htmlH === 300 && g.bodyH === 300 && g.scrollH <= 300, `html ${g.htmlH}, body ${g.bodyH}, scroll ${g.scrollH}`);
      await page.screenshot({ path: join(SHOTS, `menu-${w}-${scheme}.png`) });
    }
    await ctx.close();
  }
  // the menu opened while Opening Bunny… shows
  { const { ctx, page } = await open({ w, scheme });
    await page.locator('#text').fill('hello'); await page.locator('#go').click();
    await page.locator('#plus').click();
    const g = await geometry(page);
    check(`M1 ${tag} while Opening Bunny…`, 'the + menu opened while "Opening Bunny…" shows is fully inside the window', !g.hidden && g.bottom <= g.inner[1] + 0.5 && g.bottom <= g.bodyBottom + 0.5, JSON.stringify({ bottom: Math.round(g.bottom), inner: g.inner }));
    await ctx.close(); }

  // ---- Opening Bunny… is normal text with a spinner
  { const { ctx, page, errors } = await open({ w, scheme });
    await page.locator('#text').fill('hello');
    await page.locator('#go').click();
    const msg = page.locator('#msg');
    const info = await page.evaluate(() => {
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const m = document.getElementById('msg'); const sp = m.querySelector('.spin');
      const bg = (() => { for (let e = m; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const x = c.match(/[\d.]+/g); if (x && (x.length < 4 || Number(x[3]) > 0.5)) return parse(c); } return [255, 255, 255]; })();
      return { text: m.textContent, color: getComputedStyle(m).color, body: getComputedStyle(document.body).color, rgb: parse(getComputedStyle(m).color), bg, problem: m.classList.contains('is-problem'), spin: sp ? { w: sp.getBoundingClientRect().width, anim: getComputedStyle(sp).animationName, top: getComputedStyle(sp).borderTopColor, aria: sp.getAttribute('aria-hidden') } : null, submits: window.__submits, goOn: document.getElementById('go').classList.contains('on') };
    });
    check(`O1 ${tag}`, '"Opening Bunny…" shows as the normal text colour (same as the body text), not as a problem, with a 12 px spinner that animates and is hidden from screen readers', info.text === 'Opening Bunny…' && info.color === info.body && !info.problem && info.spin && Math.round(info.spin.w) === 12 && /spin/.test(info.spin.anim) && info.spin.aria === 'true', JSON.stringify({ text: info.text, color: info.color, body: info.body, spin: info.spin }));
    check(`O2 ${tag}`, 'its text contrast is at least 4.5:1', ratio(info.rgb, info.bg) >= 4.5, ratio(info.rgb, info.bg).toFixed(2));
    check(`O3 ${tag}`, 'Send happened once and the Send button no longer looks ready (no "on" class) while it is opening', info.submits === 1 && !info.goOn, `${info.submits} submits, on=${info.goOn}`);
    await page.locator('#text').press('Enter'); await page.locator('#go').click({ force: true }).catch(() => {});
    check(`O4 ${tag}`, 'pressing Enter or clicking Send again while it is opening does not send twice', (await page.evaluate(() => window.__submits)) === 1);
    check(`O5 ${tag}`, 'the message area is a status region so a screen reader hears it', (await msg.getAttribute('role')) === 'status');
    await page.screenshot({ path: join(SHOTS, `opening-${w}-${scheme}.png`) });
    check(`O6 ${tag}`, 'no page error', errors.length === 0, errors.join('|'));
    await ctx.close(); }
  // reduced motion: the spinner stands still
  { const { ctx, page } = await open({ w, scheme, reduced: true });
    await page.locator('#text').fill('hello'); await page.locator('#go').click();
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('#msg .spin')).animationName);
    check(`O7 ${tag}`, 'with "reduce motion" on, the spinner does not animate', anim === 'none', anim);
    await ctx.close(); }

  // ---- a real problem is amber with no spinner, and a retry replaces it
  { const { ctx, page } = await open({ w, scheme, submit: 'fail' });
    await page.locator('#text').fill('hello'); await page.locator('#go').click();
    await page.locator('#msg:not([hidden])').waitFor();
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const m = document.getElementById('msg');
      let bg = [255, 255, 255]; for (let e = m; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const x = c.match(/[\d.]+/g); if (x && (x.length < 4 || Number(x[3]) > 0.5)) { bg = parse(c); break; } }
      return { text: m.textContent, color: getComputedStyle(m).color, rgb: parse(getComputedStyle(m).color), bg, body: getComputedStyle(document.body).color, spin: m.querySelector('.spin') !== null, problem: m.classList.contains('is-problem'), goOn: document.getElementById('go').classList.contains('on') };
    });
    const amber = scheme === 'light' ? 'rgb(180, 83, 9)' : 'rgb(233, 173, 82)';
    check(`P1 ${tag}`, `a real problem ("Bunny could not open.") is amber (${amber}), has no spinner, and differs from the body text`, info.text === 'Bunny could not open.' && info.color === amber && !info.spin && info.problem && info.color !== info.body, JSON.stringify(info).slice(0, 200));
    check(`P2 ${tag}`, 'the amber text has contrast of at least 4.5:1 on the bar', ratio(info.rgb, info.bg) >= 4.5, ratio(info.rgb, info.bg).toFixed(2));
    check(`P3 ${tag}`, 'after the problem the text box and Send work again (Send looks ready, the person can try again)', info.goOn);
    await page.locator('#go').click();
    const again = await page.evaluate(() => ({ submits: window.__submits }));
    check(`P4 ${tag}`, 'trying again sends again (2 submits) and the message is shown again as a problem', again.submits === 2, JSON.stringify(again));
    await page.locator('#text').type('x');
    check(`P5 ${tag}`, 'typing clears the problem message', (await page.locator('#msg').isHidden()));
    await ctx.close(); }
}
await browser.close();
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);

/**
 * QA walk for D1 (Design's four fixes and the purple bunny), invented profile, both widths and both themes.
 *   BUNNY_DATA_DIR=<temp> BUNNY_FAKE_UPSTREAM=1 PORT=5394 node src/server/main.js
 *   BASE=http://127.0.0.1:5394 OUT=<temp> node e2e/q2-d1-walk.mjs
 * A fresh profile has no provider connected, which is the state the first fix is about.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const rows = [];
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(String.fromCharCode(10))[0]; }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(8), name, '::', String(note).slice(0, 240));
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const browser = await chromium.launch();
const SIZES = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 800 } };
for (const size of ['desktop', 'phone']) for (const theme of ['light', 'dark']) {
  const tag = `${size}-${theme}`;
  const ctx = await browser.newContext({ viewport: SIZES[size], colorScheme: theme, baseURL: BASE });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 100)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 100)); });
  const shot = (n) => page.screenshot({ path: `${OUT}/d1-${tag}-${n}.png`, fullPage: true });

  await row(`G-${tag}`, `greeting with no provider shows an Add-a-provider button that opens Providers (${tag})`, async () => {
    await page.goto('/'); await page.waitForSelector('#greeting'); await page.waitForTimeout(500);
    const btn = page.getByRole('link', { name: /add a provider/i }).or(page.getByRole('button', { name: /add a provider/i })).first();
    ok(await btn.count(), 'no Add a provider control: ' + (await page.locator('main, .greeting-wrap, #welcome').first().innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 120));
    ok(await btn.isVisible(), 'not visible'); await shot('greeting');
    const box = await btn.boundingBox(); ok(box && box.width >= 80 && box.height >= 28, 'button too small: ' + JSON.stringify(box));
    await Promise.all([page.waitForURL(/providers\.html/, { timeout: 5000 }).catch(() => {}), btn.click()]); ok(/providers\.html/.test(page.url()), 'did not open Providers: ' + page.url());
  });
  await row(`P-${tag}`, `Providers: the custom provider form comes before Popular providers (${tag})`, async () => {
    await page.goto('/src/ui/providers.html'); await page.waitForTimeout(800); await shot('providers');
    const y = await page.evaluate(() => { const h = [...document.querySelectorAll('h2')]; const top = (re) => h.find((e) => re.test(e.textContent))?.getBoundingClientRect().top ?? null; return { custom: top(/custom provider/i), popular: top(/popular providers/i) }; });
    ok(y.custom !== null && y.popular !== null, 'a heading is missing: ' + JSON.stringify(y)); ok(y.custom < y.popular, 'custom form is below Popular providers: ' + JSON.stringify(y));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(over <= 1, 'horizontal overflow ' + over);
    return JSON.stringify(y);
  });
  await row(`S-${tag}`, `Settings window: ${size === 'phone' ? 'sections are a one-row pill strip' : 'sections are a left list'} (${tag})`, async () => {
    await page.goto('/'); await page.waitForSelector('#greeting'); if (size === 'phone') { await page.locator('#sidebar-toggle').click(); await page.waitForTimeout(400); } await page.locator('#settings-open').click(); await page.waitForTimeout(700); await shot('settings');
    const lay = await page.evaluate(() => { const list = document.querySelector('#settings-nav-list'); const rows = [...list.querySelectorAll('button.nav-row')].filter((b) => b.offsetParent); const tops = new Set(rows.map((b) => Math.round(b.getBoundingClientRect().top))); const cs = getComputedStyle(list); return { rows: rows.length, distinctTops: tops.size, flexDir: cs.flexDirection, overflowX: cs.overflowX, display: cs.display, pillRadius: getComputedStyle(rows[0]).borderRadius }; });
    const inView = await page.evaluate(() => [...document.querySelectorAll('#settings-nav-list button.nav-row')].filter((b) => b.offsetParent).filter((b) => { const r = b.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; }).length);
    if (size === 'phone') { ok(inView >= 3, `only ${inView} section pill(s) can be seen at once on a phone (each pill is as wide as the strip: .nav-row width 100% at src/ui/app.css:259 is not overridden by the phone rule)`); ok(lay.distinctTops === 1, 'pills wrap or stack: ' + JSON.stringify(lay)); ok(/auto|scroll/.test(lay.overflowX), 'the strip does not scroll sideways: ' + JSON.stringify(lay)); }
    else ok(lay.distinctTops > 5, 'the list is not vertical: ' + JSON.stringify(lay));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(over <= 1, 'horizontal overflow ' + over);
    await page.locator('#settings-nav-list button[data-section="about"]').scrollIntoViewIfNeeded().catch(() => {}); await page.locator('#settings-nav-list button[data-section="about"]').click(); await page.waitForTimeout(500);
    ok(/section=about/.test(await page.locator('#settings-frame').getAttribute('src')), 'the last pill did not open its section');
    return JSON.stringify(lay);
  });
  await row(`A-${tag}`, `Automation: ${size === 'phone' ? 'the Add buttons are full width' : 'buttons keep their size'} (${tag})`, async () => {
    await page.goto('/src/ui/automation.html'); await page.waitForTimeout(800); await shot('automation');
    const w = await page.evaluate(() => { const form = [...document.querySelectorAll('form.add-row')]; return form.map((f) => { const b = f.querySelector('button[type=submit], button.primary'); const fr = f.getBoundingClientRect(); const br = b?.getBoundingClientRect(); return { formW: Math.round(fr.width), btnW: br ? Math.round(br.width) : 0 }; }); });
    ok(w.length >= 5, 'forms found: ' + w.length);
    if (size === 'phone') ok(w.every((x) => x.btnW >= x.formW - 34), 'a button is narrower than its form: ' + JSON.stringify(w));
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); ok(over <= 1, 'horizontal overflow ' + over);
    return JSON.stringify(w);
  });
  await row(`B-${tag}`, `the hopping bunny is purple from the accent tokens, normal and grumpy (${tag})`, async () => {
    await page.goto('/'); await page.waitForSelector('#greeting');
    const out = await page.evaluate(() => {
      const make = (extra) => { const host = document.createElement('div'); host.className = 'bunny-working' + extra; host.style.cssText = 'position:fixed;left:20px;top:20px;z-index:9999';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'bunny-mark'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '48'); svg.setAttribute('height', '48');
        for (const cls of ['ear', 'face', 'eye', 'nose']) { const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('class', cls); c.setAttribute('cx', '12'); c.setAttribute('cy', '12'); c.setAttribute('r', '4'); svg.append(c); }
        host.append(svg); document.body.append(host); return host; };
      const read = (h) => Object.fromEntries(['face', 'ear', 'eye', 'nose'].map((c) => [c, getComputedStyle(h.querySelector('.' + c)).fill]));
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
      return { accent, normal: read(make('')), grumpy: read(make(' is-grumpy')) };
    });
    const rgb = (t) => { const m = /rgb\((\d+), (\d+), (\d+)\)/.exec(t); return m ? m.slice(1).map(Number) : null; };
    const face = rgb(out.normal.face); ok(face, 'no face colour: ' + JSON.stringify(out));
    ok(face[2] > face[1] && face[0] > face[1] && face[2] >= 140, `the face is not purple: ${out.normal.face}`);
    ok(out.grumpy.face === out.normal.face, 'the grumpy face is a different colour: ' + JSON.stringify(out));
    ok(/255, 255, 255/.test(out.normal.eye) || theme === 'dark', 'eyes are not the on-accent colour: ' + out.normal.eye);
    await shot('bunny'); return JSON.stringify(out);
  });
  await row(`E-${tag}`, `no console errors (${tag})`, async () => { ok(!errs.length, errs.join(' ; ')); });
  await ctx.close();
}
writeFileSync(`${OUT}/d1-walk.json`, JSON.stringify(rows, null, 1));
console.log(`\n${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);
await browser.close();

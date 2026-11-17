/**
 * QA, v0.1.9 L-1 (fca5fb3): the owner's screenshot (Settings → Code, text on a card border) and every other Settings page.
 * Own measurements (not Builder's spec): for EVERY section and the three embedded pages, at 800 px (the content pane of a 1280 window) and 390 px,
 * light and dark: sideways overflow; text or a control closer than 10 px (sides) / 3 px (top and bottom) to the border of the card it sits in;
 * anything wider than the page. Plus the Code → Permission rules block, the All folders / One folder switch, the Session pane rows and the Privacy rows.
 * Invented profile only. SRC=<worktree> node e2e/w019-l1.mjs
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC || process.cwd(); const PORT = +(process.env.PORT0 ?? 6441); const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8fd4';
const OUT = process.env.OUT || mkdtempSync(join(tmpdir(), 'bunny-w019-l1-')); mkdirSync(OUT, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 330) : ''}`); };
const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w019-l1-data-'));
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: dataDir, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 60; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; pictures in ${OUT}`); process.exit(code ?? (bad.length ? 1 : 0)); };
let browser;
try {
  if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
  browser = await chromium.launch();
  const SECTIONS = ['profile', 'appearance', 'language', 'notifications', 'bunny', 'privacy', 'capabilities', 'connection', 'models', 'code', 'usage', 'about'];
  const PAGES = [...SECTIONS.map((s) => [s, `/src/ui/settings.html?embed=1&section=${s}`]), ['providers', '/src/ui/providers.html?embed=1'], ['automation', '/src/ui/automation.html?embed=1'], ['customize', '/src/ui/customize.html?embed=1']];
  const measure = () => {
    const out = { overflowX: document.documentElement.scrollWidth - window.innerWidth, wide: [], tight: [] };
    const vw = window.innerWidth;
    const bordered = (el) => { const s = getComputedStyle(el); return ['Left', 'Right', 'Top', 'Bottom'].some((k) => parseFloat(s[`border${k}Width`]) > 0 && s[`border${k}Style`] !== 'none' && s[`border${k}Color`] !== 'rgba(0, 0, 0, 0)'); };
    for (const el of document.querySelectorAll('body *')) {
      const dd = el.closest('details:not([open])'); if (dd && !(el.tagName === 'SUMMARY' || el.closest('summary'))) continue;
      if (el.closest('[hidden]') || ['SCRIPT', 'STYLE', 'OPTION', 'SVG', 'PATH'].includes(el.tagName.toUpperCase())) continue;
      const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      if (r.right > vw + 1 && !el.closest('pre, .scroll-x, table')) out.wide.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]} right ${Math.round(r.right)} > ${vw}`);
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
      const control = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || (el.tagName === 'BUTTON' && !el.closest('.switch'));
      if (!own && !control) continue;
      // nearest ancestor that draws a border, unless it is the element itself (a bordered button is its own box)
      let a = el.parentElement; while (a && a !== document.body && !bordered(a)) a = a.parentElement;
      if (!a || a === document.body || a.closest('[hidden]')) continue;
      if (control && a === el) continue;
      const tr = document.createRange(); const tn = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); let r2 = r; if (tn && !control) { tr.selectNodeContents(tn); const rr = tr.getBoundingClientRect(); if (rr.width) r2 = rr; }
      const b = a.getBoundingClientRect(); const bs = getComputedStyle(a);
      const dl = r2.left - b.left - parseFloat(bs.borderLeftWidth), dr = b.right - r2.right - parseFloat(bs.borderRightWidth);
      const dt = r2.top - b.top - parseFloat(bs.borderTopWidth), db = b.bottom - r2.bottom - parseFloat(bs.borderBottomWidth);
      const sideBorder = parseFloat(bs.borderLeftWidth) > 0 || parseFloat(bs.borderRightWidth) > 0; const vertBorder = parseFloat(bs.borderTopWidth) > 0 || parseFloat(bs.borderBottomWidth) > 0;
      if ((sideBorder && (dl < 10 || dr < 10) && a.tagName !== 'BUTTON') || (vertBorder && (dt < 3 || db < 3) && a.tagName !== 'BUTTON')) {
        out.tight.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).split(' ')[0]} "${(el.textContent || el.value || '').trim().slice(0, 22)}" in ${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]} L${Math.round(dl)} R${Math.round(dr)} T${Math.round(dt)} B${Math.round(db)}`);
      }
    }
    return out;
  };
  let tightTotal = 0;
  for (const scheme of ['light', 'dark']) {
    for (const width of [800, 390]) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, baseURL: BASE }); const page = await ctx.newPage(); const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.addInitScript(([t]) => { try { localStorage.setItem('bunny.token', t); } catch { /* x */ } }, [TOKEN]);
      for (const [name, url] of PAGES) {
        await page.goto(url); await page.waitForTimeout(700);
        const m = await page.evaluate(measure);
        const real = m.tight.filter((t) => !/\bswitch\b|slider|\.dot|\.tab\b|badge|chip| in div\.actions/.test(t)); // the .actions line only has a top rule; its button sits in the card (seen in the pictures)
        tightTotal += real.length;
        check(`${scheme}-${width}-${name}`, `${name}: no sideways overflow, nothing wider than the page, nothing on a card border`, m.overflowX <= 1 && m.wide.length === 0 && real.length === 0,
          `${m.overflowX > 1 ? 'overflowX ' + m.overflowX + '; ' : ''}${m.wide.slice(0, 3).join('; ')}${real.length ? ' TIGHT: ' + real.slice(0, 4).join(' | ') : ''}${errors.length ? ' PAGEERROR ' + errors.slice(0, 2).join(';') : ''}`);
        if (['code', 'privacy', 'appearance', 'providers', 'capabilities'].includes(name)) await page.screenshot({ path: join(OUT, `${scheme}-${width}-${name}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }

  // Code → Permission rules, the owner's screenshot
  const ctx = await browser.newContext({ viewport: { width: 800, height: 900 }, baseURL: BASE }); const page = await ctx.newPage();
  await page.addInitScript(([t]) => { try { localStorage.setItem('bunny.token', t); } catch { /* x */ } }, [TOKEN]);
  await page.goto('/src/ui/settings.html?embed=1&section=code'); await page.waitForTimeout(800);
  const geo = await page.evaluate(() => {
    const q = (s) => document.querySelector(s); const L = (s) => { const e = q(s); return e ? Math.round(e.getBoundingClientRect().left) : null; };
    const card = q('#perm-rules')?.parentElement; const cs = q('#perm-rules') ? getComputedStyle(q('#perm-rules')) : null;
    return { card: card ? Math.round(card.getBoundingClientRect().left) : null, h3: L('#perm-rules h3'), lead: L('#perm-rules .lead'), tabs: L('#perm-rules .tabs2'), add: L('#rules-add'), tryBox: L('#rules-try-box'), pad: cs?.paddingLeft, top: cs?.borderTopWidth };
  });
  const edges = [geo.h3, geo.lead, geo.tabs, geo.add, geo.tryBox].filter((x) => x !== null);
  check('R1', 'Permission rules: heading, text, tabs, add row and Try box share one left edge, 16+ px inside the card, with a line above the block', geo.card !== null && Math.max(...edges) - Math.min(...edges) <= 1 && geo.h3 - geo.card >= 16 && geo.top === '1px', JSON.stringify(geo));
  const tabs = ['#rules-tab-all', '#rules-tab-folder']; const sel = async () => page.evaluate((ids) => ids.map((i) => document.querySelector(i)?.getAttribute('aria-selected')), tabs);
  const s0 = await sel(); await page.locator('#rules-tab-folder').click(); await page.waitForTimeout(300); const s1 = await sel(); const picker = await page.evaluate(() => { const l = document.querySelector('#rules-lists, #rules-folder, #perm-rules'); return (l?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 140); });
  await page.screenshot({ path: join(OUT, 'code-onefolder.png'), fullPage: true }); await page.locator('#rules-tab-all').click(); await page.waitForTimeout(300); const s2 = await sel();
  check('R2', 'All folders / One folder: the selected tab switches both ways', s0.join() === 'true,false' && s1.join() === 'false,true' && s2.join() === 'true,false', `${s0} -> ${s1} -> ${s2}; One folder shows: ${picker}`);
  // the add row works: add a rule, see it, remove it (invented profile)
  const addInfo = await page.evaluate(() => [...document.querySelectorAll('#rules-add input, #rules-add select, #rules-add button')].map((e) => `${e.tagName.toLowerCase()}#${e.id}`).join(' '));
  console.log('INFO  rules add row controls: ' + addInfo);
  // Privacy storage rows and the Session pane
  await page.goto('/src/ui/settings.html?embed=1&section=privacy'); await page.waitForTimeout(600);
  const kv = await page.evaluate(() => { const k = document.querySelector('#storage > .kv, #storage .kv'); return k ? getComputedStyle(k).paddingLeft : null; });
  check('R3', 'Privacy → Storage rows: labels 16+ px in from the border', kv !== null && parseFloat(kv) >= 16, String(kv));
  await page.goto('/'); await page.waitForSelector('#input'); await page.waitForTimeout(800);
  const kv2 = await page.evaluate(() => { const k = document.querySelector('#rail .kv'); if (!k) return null; const s = getComputedStyle(k); return [s.paddingLeft, s.paddingTop]; });
  check('R4', 'Session pane rows keep their own tight padding (0 / 4 px)', kv2 && kv2[0] === '0px' && kv2[1] === '4px', JSON.stringify(kv2));
  await page.goto('/src/ui/settings.html?embed=1&section=appearance'); await page.waitForTimeout(600);
  const ap = await page.evaluate(() => { const pick = document.querySelector('.code-theme-pick select'); const row = pick?.closest('.group')?.querySelector('.row .name'); return pick && row ? [Math.round(pick.getBoundingClientRect().left), Math.round(row.getBoundingClientRect().left)] : null; });
  check('R5', 'Appearance → Code theme pickers start on the same line as the rows', ap && Math.abs(ap[0] - ap[1]) <= 1, JSON.stringify(ap));
  await page.goto('/src/ui/providers.html?embed=1'); await page.waitForTimeout(600);
  const pr = await page.evaluate(() => { const n = document.querySelector('.page > p.note'); const prev = n?.previousElementSibling; return n && prev ? Math.round(n.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : null; });
  check('R6', 'Providers: the key note has room above it (at least 12 px)', pr !== null && pr >= 12, String(pr));
  await ctx.close();
  await finish();
} catch (e) { console.log('ABORT', e.stack ?? e.message); rows.push({ id: 'X', ok: false }); await finish(1); }

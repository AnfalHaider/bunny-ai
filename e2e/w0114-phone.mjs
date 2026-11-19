/**
 * QA v0.1.14 PHONE-LAYOUT walk. Playwright mobile emulation (isMobile, touch, Android Chrome user agent) against an invented-profile Bunny.
 *   node e2e/w0114-phone.mjs <mode> <outDir>
 * modes: local (browser view at the PC's address), remote-chats (a device signed in at Chats, 127.0.0.2), remote-everything (same at Everything),
 *        installed (display-mode: standalone emulated, local), signedout (the sign-in page and the offline page, remote, no cookie)
 * For every size x theme x state it measures the page (and every iframe in it) and records breaks: page scrolls sideways, a control cut off by the screen or by a
 * clipping parent, two controls overlapping, a control covered by another, a label cut off, plus small targets. A screenshot is kept for each state with a break.
 * No OS keys, no real network, no real profile.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startHarness, wait } from './w0114-harness.mjs';

const MODE = process.argv[2] ?? 'local'; const OUT = process.argv[3] ?? join(process.cwd(), 'phone-out');
mkdirSync(join(OUT, 'shots'), { recursive: true });
const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36';

// [name, width, height, kind]  kind: P portrait, L landscape, K keyboard open (the layout viewport shrinks; a real Android Chrome shrinks only the visual viewport, see the doc)
const SIZES = [
  ['360x640', 360, 640, 'P'], ['360x740', 360, 740, 'P'], ['390x740', 390, 740, 'P'], ['412x740', 412, 740, 'P'], ['412x915', 412, 915, 'P'], ['720x740', 720, 740, 'P'], ['720x1280', 720, 1280, 'P'],
  ['640x360', 640, 360, 'L'], ['740x360', 740, 360, 'L'], ['844x390', 844, 390, 'L'],
  ['360x340-keyboard', 360, 340, 'K'], ['412x380-keyboard', 412, 380, 'K'], ['720x520-keyboard', 720, 520, 'K'],
];
const ONLY = process.argv[4] ? new Set(process.argv[4].split(',')) : null;
const DARK_SIZES = new Set(['360x640', '412x740', '720x740', '640x360']);
const FULL_STATES = ['home', 'chat', 'sidebar', 'picker', 'attach', 'export', 'typed', 'perm', 'effort', 'job', 'code', 'code-terminal', 'code-changes', 'code-browser', 'code-files', 'code-tasks', 'artifacts', 'projects', 'incognito', 'account', 'rowmenu', 'search', 'settings', 'providers', 'customize', 'automation'];
const SMALL_STATES = ['home', 'chat', 'sidebar', 'picker', 'typed', 'settings'];
const KEYBOARD_STATES = ['home', 'chat', 'typed'];

const h = await startHarness();
const base = MODE.startsWith('remote') ? h.remoteUrl : h.local;
let cookies = [];
if (MODE.startsWith('remote')) {
  const c0 = await h.browser.newContext();
  await h.remoteSignIn(c0, MODE === 'remote-everything' ? 'everything' : 'chats');
  cookies = await c0.cookies(); await c0.close();
}

// ---- the measuring function, run in the page and in each iframe ----
const AUDIT = (opts) => {
  const out = { breaks: [], small: [], info: {}, texts: [] };
  const de = document.documentElement; const W = innerWidth; const H = innerHeight; const vv = window.visualViewport;
  const rootScrolls = de.scrollHeight > H + 2;
  out.info = { W, H, vvW: Math.round(vv.width), vvH: Math.round(vv.height), scrollW: de.scrollWidth, scrollH: de.scrollHeight, bodyScrollH: document.body.scrollHeight, rootScrolls };
  const sel = (e) => { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; else if (typeof e.className === 'string' && e.className.trim()) s += '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.'); const t = (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24); return t ? `${s} "${t}"` : s; };
  const vis = (e) => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false; const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; for (let p = e.parentElement; p; p = p.parentElement) { const c = getComputedStyle(p); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) === 0) return false; if (p.hidden || p.inert || p.getAttribute('aria-hidden') === 'true') return false; { const pr0 = p.getBoundingClientRect(); if ((pr0.width <= 1 || pr0.height <= 1) && /hidden|clip/.test(c.overflow + c.overflowX + c.overflowY)) return false; } if (/^(fixed|absolute|sticky)$/.test(c.position)) { const pr = p.getBoundingClientRect(); if (pr.width > 0 && (pr.right <= 0.5 || pr.left >= innerWidth - 0.5)) return false; } } return true; };
  const inter = (a, b) => { const l = Math.max(a.left, b.left); const t = Math.max(a.top, b.top); const r = Math.min(a.right, b.right); const bt = Math.min(a.bottom, b.bottom); return { l, t, r, b: bt, w: Math.max(0, r - l), h: Math.max(0, bt - t) }; };
  const R = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  if (de.scrollWidth > W + 1) out.breaks.push({ kind: 'page-scrolls-sideways', el: 'html', note: `content ${de.scrollWidth}px wide on a ${W}px screen` });
  const els = [...document.querySelectorAll('button,a[href],input:not([type=hidden]):not([type=file]),select,textarea,summary,[role=button],[role=menuitem],[role=tab],[role=option],[role=radio],[role=checkbox],label,[tabindex]:not([tabindex="-1"])')].filter(vis);
  const seen = new Set();
  for (const el of els) {
    const r = el.getBoundingClientRect(); const full = r.width * r.height; if (!full) continue;
    // an element whose own box is bigger than its label only because of padding is fine; measure the box
    let culprit = null; let scroller = false; let skip = false;
    for (let p = el.parentElement; p && p !== de && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p); const ox = cs.overflowX; const oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const pr = p.getBoundingClientRect(); const i = inter(r, pr);
      if (i.w * i.h <= full * 0.03) { skip = true; break; } // wholly outside a clipping parent: reached by scrolling it, or collapsed on purpose; not a cut
      if (i.w * i.h < full * 0.92 && i.w * i.h > full * 0.03) { const canScroll = (/(auto|scroll)/.test(ox) && p.scrollWidth > p.clientWidth + 1) || (/(auto|scroll)/.test(oy) && p.scrollHeight > p.clientHeight + 1); culprit = p; scroller = canScroll; break; }
    }
    if (skip) continue;
    const key = sel(el);
    if (culprit) { const id = 'cut-by-parent|' + key; if (!seen.has(id)) { seen.add(id); out.breaks.push({ kind: scroller ? 'cut-in-scroller' : 'cut-by-parent', el: key, parent: sel(culprit), rect: R(r), parentRect: R(culprit.getBoundingClientRect()), note: scroller ? 'partly hidden, reachable only by scrolling the strip' : 'partly hidden, nothing scrolls' }); } continue; }
    const iv = inter(r, { left: 0, top: 0, right: W, bottom: H });
    if (iv.w * iv.h < full * 0.92) {
      const horizontal = r.right > W + 1 || r.left < -1;
      let fixedAnc = false; for (let p = el; p && p !== de; p = p.parentElement) { const c = getComputedStyle(p).position; if (c === 'fixed' || c === 'sticky') { fixedAnc = true; break; } }
      if (horizontal || !rootScrolls || fixedAnc) { const id = 'cut-by-screen|' + key; if (!seen.has(id)) { seen.add(id); out.breaks.push({ kind: 'cut-by-screen', el: key, rect: R(r), note: `box ${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)} on a ${W}x${H} screen` }); } }
    }
    // label cut off
    if (/^(BUTTON|SUMMARY|A|LABEL)$/.test(el.tagName)) { const cs = getComputedStyle(el); if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis') { const id = 'label-cut|' + key; if (!seen.has(id)) { seen.add(id); out.breaks.push({ kind: 'label-cut', el: key, rect: R(r), note: `text ${el.scrollWidth}px in ${el.clientWidth}px, no ellipsis` }); } } }
    if (Math.min(r.width, r.height) < 30 && el.tagName !== 'LABEL') out.small.push({ el: key, rect: R(r) });
  }
  // overlaps and covered controls (not while a dialog sits over the page)
  const inView = els.filter((e) => { const r = e.getBoundingClientRect(); return r.right > 0 && r.left < W && r.bottom > 0 && r.top < H; });
  if (opts.pairs) {
    for (let i = 0; i < inView.length; i++) for (let j = i + 1; j < inView.length; j++) {
      const a = inView[i]; const b = inView[j]; if (a.contains(b) || b.contains(a)) continue;
      if (a.tagName === 'LABEL' || b.tagName === 'LABEL') continue;
      const drawerA = a.closest('aside.sidebar'); const drawerB = b.closest('aside.sidebar'); if (Boolean(drawerA) !== Boolean(drawerB) && getComputedStyle(drawerA || drawerB).position === 'fixed') continue; // the open drawer is meant to sit over the page
      const ra = a.getBoundingClientRect(); const rb = b.getBoundingClientRect(); const x = inter(ra, rb); const area = x.w * x.h;
      if (area > 12 && area > 0.15 * Math.min(ra.width * ra.height, rb.width * rb.height)) {
        const cx = (x.l + x.r) / 2; const cy = (x.t + x.b) / 2; const top = document.elementFromPoint(cx, cy);
        if (top && (a.contains(top) || b.contains(top) || top.contains(a) || top.contains(b))) { const id = 'overlap|' + sel(a) + '|' + sel(b); if (!seen.has(id)) { seen.add(id); out.breaks.push({ kind: 'overlap', el: sel(a), other: sel(b), rect: R(ra), otherRect: R(rb), note: `${Math.round(x.w)}x${Math.round(x.h)} px on top of each other` }); } }
      }
    }
    for (const e of inView) {
      const r = e.getBoundingClientRect(); const cx = Math.min(W - 1, Math.max(0, r.left + r.width / 2)); const cy = Math.min(H - 1, Math.max(0, r.top + r.height / 2));
      if (r.width < 6 || r.height < 6) continue;
      const top = document.elementFromPoint(cx, cy);
      if (top && !(e.contains(top) || top.contains(e)) && !top.closest('aside.sidebar, [role=dialog], [role=menu], dialog, .picker-panel, .picker-scrim, .scrim, .modal, .modal-backdrop, .menu, .popover, #account-menu, #job-menu, #settings-overlay, .settings-overlay')) { const id = 'covered|' + sel(e); if (!seen.has(id)) { seen.add(id); out.breaks.push({ kind: 'covered', el: sel(e), rect: R(r), by: sel(top), note: 'another element sits on top of its middle' }); } }
    }
  }
  // the words the owner pointed at
  const body = document.body ? document.body.innerText : '';
  if (/Pick a model/i.test(body)) out.texts.push('Pick a model shown');
  return out;
};

const results = []; // {mode,size,theme,state,breaks,small,info,texts,shot}
const notes = [];
async function audit(page, opts) {
  const frames = page.frames(); const all = [];
  for (const f of frames) { try { const r = await f.evaluate(AUDIT, opts); r.frame = f === page.mainFrame() ? 'main' : (f.url().split('/').pop() || 'iframe').slice(0, 40); all.push(r); } catch { /* a frame that went away */ } }
  return all;
}

async function openState(page, state) {
  const dummy = null; void dummy;
  const idx = `${base}/src/ui/index.html`;
  const ready = async () => { await page.waitForSelector('#input', { timeout: 15000 }).catch(() => {}); await wait(700); };
  const click = async (sel, wt = 600) => {
    let l = page.locator(sel).filter({ visible: true }).first();
    if (await l.count()) { // inside the sidebar drawer: open it first, the way a person does
      const closed = await l.evaluate((e) => { const a = e.closest('aside.sidebar'); return Boolean(a) && a.getBoundingClientRect().width <= 1; });
      if (closed) { const tg = page.locator('#sidebar-toggle').filter({ visible: true }).first(); if (await tg.count()) { await tg.click({ timeout: 4000 }); await wait(800); } }
    }
    if (!(await l.count())) throw new Error('not on screen: ' + sel);
    try { await l.click({ timeout: 3000 }); } catch (e) { // a finger could not reach it either: say so, then open it by script so the rest of the state can still be measured
      await l.evaluate((el) => el.click()); notes.push(`unreachable by touch: ${sel} in state ${state} (${page.viewportSize().width}x${page.viewportSize().height}): ${String(e.message).slice(0, 60).replace(/\s+/g, ' ')}`);
    }
    await wait(wt);
  };
  const fresh = async (url = idx) => { await page.goto(url, { waitUntil: 'domcontentloaded' }); await ready(); };
  switch (state) {
    case 'home': await fresh(); return { pairs: true };
    case 'chat': await fresh(`${idx}?s=${h.chatId}`); await wait(800); return { pairs: true };
    case 'sidebar': await fresh(); await click('#sidebar-toggle'); return { pairs: false };
    case 'picker': await fresh(); await click('#picker-button'); return { pairs: false };
    case 'attach': await fresh(); await click('#attach'); return { pairs: false };
    case 'export': await fresh(`${idx}?s=${h.chatId}`); await click('#export'); return { pairs: false };
    case 'typed': await fresh(); await page.locator('#input').fill('A long message that goes over several lines on a phone screen. '.repeat(6)); await wait(500); return { pairs: true };
    case 'perm': await fresh(); await click('#mode-button'); return { pairs: false };
    case 'effort': await fresh(); await click('#effort-level'); return { pairs: false };
    case 'job': await fresh(); await click('#job-button'); return { pairs: false };
    case 'code': await fresh(); await click('#mode-code'); return { pairs: true };
    case 'code-terminal': case 'code-changes': case 'code-browser': case 'code-files': case 'code-tasks': {
      const label = { 'code-terminal': 'Terminal', 'code-changes': 'Changes', 'code-browser': 'Browser', 'code-files': 'Files', 'code-tasks': 'Tasks and plan' }[state];
      await fresh(); await click('#mode-code'); await click(`button.icon-btn[aria-label^="${label}"], button.icon-btn[title^="${label}"]`, 900); return { pairs: false };
    }
    case 'artifacts': await fresh(); await click('#artifacts-toggle', 900); return { pairs: false };
    case 'projects': await fresh(); await click('#new-project', 800); return { pairs: false };
    case 'incognito': await fresh(); await click('#incognito', 800); return { pairs: true };
    case 'account': await fresh(); await click('#account-button', 800); return { pairs: false };
    case 'rowmenu': await fresh(); await click('button.row-menu', 800); return { pairs: false };
    case 'search': await fresh(); await click('#search', 600); return { pairs: false };
    case 'settings': await fresh(); await click('#settings-open', 1200); return { pairs: false };
    case 'providers': await fresh(`${base}/src/ui/providers.html`); return { pairs: true };
    case 'customize': await fresh(`${base}/src/ui/customize.html`); return { pairs: true };
    case 'automation': await fresh(`${base}/src/ui/automation.html`); return { pairs: true };
    default: throw new Error('unknown state ' + state);
  }
}

async function record(page, size, theme, state, opts) {
  const frames = await audit(page, opts);
  const breaks = frames.flatMap((f) => f.breaks.map((b) => ({ ...b, frame: f.frame })));
  const small = frames.flatMap((f) => f.small.map((s) => ({ ...s, frame: f.frame })));
  const texts = frames.flatMap((f) => f.texts);
  let shot = null;
  if (breaks.length) { shot = `shots/${MODE}-${size}-${theme}-${state}.jpg`; await page.screenshot({ path: join(OUT, shot), type: 'jpeg', quality: 62 }).catch(() => { shot = null; }); }
  results.push({ mode: MODE, size, theme, state, info: frames[0]?.info, breaks, small: small.length, smallList: small.slice(0, 6), texts, shot });
}

try {
  if (MODE === 'signedout') {
    for (const [name, w, hh] of SIZES.filter((s) => s[3] !== 'K')) for (const theme of ['light', 'dark']) {
      const ctx = await h.browser.newContext({ viewport: { width: w, height: hh }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: theme, userAgent: UA }); const page = await ctx.newPage();
      for (const [state, url] of [['signin', `${h.remoteUrl}/`], ['offline', `${h.local}/src/ui/offline.html`]]) { try { await page.goto(url, { waitUntil: 'domcontentloaded' }); await wait(700); await record(page, name, theme, state, { pairs: true }); } catch (e) { notes.push(`${state} ${name} ${theme}: ${e.message.slice(0, 80)}`); } }
      await ctx.close();
    }
  } else {
    for (const [name, w, hh, kind] of SIZES) for (const theme of ['light', 'dark']) {
      if (ONLY && !ONLY.has(name)) continue;
      if (theme === 'dark' && !DARK_SIZES.has(name)) continue;
      const states = kind === 'K' ? KEYBOARD_STATES : (theme === 'dark' || MODE === 'remote-everything') ? SMALL_STATES : (MODE === 'remote-chats' || MODE === 'installed') ? [...SMALL_STATES, 'code', 'code-terminal', 'code-files', 'attach', 'export', 'account'] : FULL_STATES;
      const ctx = await h.browser.newContext({ viewport: { width: w, height: hh }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: theme, userAgent: UA });
      if (cookies.length) await ctx.addCookies(cookies);
      if (MODE === 'installed') await ctx.addInitScript(() => { const orig = window.matchMedia.bind(window); window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? Object.assign(orig('all'), { matches: true, media: q }) : orig(q)); try { Object.defineProperty(navigator, 'standalone', { value: true }); } catch { /* x */ } });
      const page = await ctx.newPage();
      if (MODE === 'installed') { try { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }); } catch (e) { notes.push('display-mode media emulation not available: ' + e.message.slice(0, 80)); } }
      for (const state of states) {
        try { const opts = await openState(page, state); await record(page, name, theme, state, opts);
          if (state === 'settings') { // every tab of the settings window
            const sections = await page.locator('#settings-nav-list [data-section]').evaluateAll((els) => els.map((e) => e.dataset.section)).catch(() => []);
            for (const s of sections) { try { await page.locator(`#settings-nav-list [data-section="${s}"]`).first().click({ timeout: 3000 }); await wait(900); await record(page, name, theme, `settings-${s}`, { pairs: false }); } catch (e) { notes.push(`settings-${s} ${name} ${theme}: ${e.message.slice(0, 70)}`); } }
          }
        } catch (e) { notes.push(`${state} ${MODE} ${name} ${theme}: ${e.message.slice(0, 90)}`); }
      }
      await ctx.close();
      console.log('done', MODE, name, theme, results.length);
    }
  }
} catch (e) { notes.push('SCRIPT ERROR ' + (e?.stack ?? e)); }
writeFileSync(join(OUT, `result-${MODE}.json`), JSON.stringify({ mode: MODE, results, notes }, null, 1));
console.log('finished', MODE, 'states measured:', results.length, 'with breaks:', results.filter((r) => r.breaks.length).length, 'notes:', notes.length);
await h.close(); process.exit(0);

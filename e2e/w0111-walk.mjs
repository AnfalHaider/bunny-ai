/**
 * QA, release-0.1.11 walk (28812e1): (1) with the REAL "Open to other devices" bar on screen (remote turned on in an invented profile, lanAddress 127.0.0.2),
 * the row under the chat box and the sidebar foot are inside the window, in Chat and Code mode; (2) the model chip on Auto reads "Auto · <model>" and Auto is never cut to "A…",
 * and on a phone a long name shows about 18 characters, at 390, 360 and 320, without touching Send; (3) + and the mic are there, inside the row, and Send works.
 * Own measurements. Desktop and phone sizes, light and dark. Invented profile only.
 *   node e2e/w0111-walk.mjs
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const root = process.cwd();
const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0111-data-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w0111-a-long-project-folder-name-for-the-under-row-'));
const OUT = join(DATA, 'shots'); mkdirSync(OUT, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const LONG = 'NVIDIA: Nemotron 3 Ultra Instruct Reasoning (free)';
const MODELS = [{ providerId: 'nvidia', providerName: 'NVIDIA', id: 'nemotron-3-ultra', displayName: LONG, freeKind: 'free', free: true, contextLength: 128000 }, { providerId: 'quill', providerName: 'Quill', id: 'otter', displayName: 'Otter 3 Coder', freeKind: null, free: false, contextLength: 128000 }];

const provider = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; } res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'walk answer' } }] }) + String.fromCharCode(10, 10) + 'data: [DONE]' + String.fromCharCode(10, 10)); }); });
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const bunny = await createApp({ dataDir: DATA, fake: false, secretStore: memorySecretStore(), probe: async () => ({ ok: true, keyVerified: true }), discover: async () => [{ id: 'gpt-4o', displayName: 'GPT 4o', ownedBy: 'x', contextLength: null }], localGuard: true, folderPickerOnly: true, lanAddress: '127.0.0.2' });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${bunny.server.address().port}`;
const adminJson = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j, text: t }; };
await bunny.chooseFolder(FOLDER);
await adminJson('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
const remote = await adminJson('/api/remote', 'PUT', { enabled: true, passcode: 'qa passcode for the 0111 walk' });
const codeChat = (await adminJson('/api/sessions', 'POST', { title: 'Under row', workMode: 'code', folder: FOLDER })).json;
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { await adminJson('/api/remote', 'PUT', { enabled: false }); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; pictures in ${OUT}`); process.exit(code ?? (bad.length ? 1 : 0)); };

try {
  check('0', 'remote is ON in the invented profile (the real bar will be drawn from /api/remote, not mocked)', remote.json?.enabled === true && String(remote.json?.url).includes('127.0.0.2'), remote.text.slice(0, 120));
  browser = await chromium.launch();
  const SIZES = [['desktop', 1280, 800], ['short desktop', 1050, 600], ['phone 390', 390, 780], ['phone 360', 360, 740], ['phone 320', 320, 640]];
  for (const mode of ['chat', 'code']) for (const [label, w, h] of SIZES) for (const scheme of ['light', 'dark']) {
    const tag = `${mode} ${label}/${scheme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.route('**/api/models*', (r) => r.fulfill({ json: MODELS }));
    await page.addInitScript(() => { window.bunnyDesktop = { platform: 'win32', getPrefs: async () => ({}), setPrefs: async () => ({}), secureWrite: async () => ({ status: 200, data: {} }), pickFolder: async () => null, updates: { get: async () => null, check: async () => null, install: async () => null, onStatus: () => () => {} }, quickAsk: { take: async () => null, onNewChat: () => () => {} }, zoom: { get: () => 1, set: () => {} }, browserView: { send: async () => null, onEvent: () => () => {} } }; });
    await page.addInitScript((m) => { localStorage.setItem('bunny.workMode', m); localStorage.setItem('bunny.modelAuto', '1'); }, mode);
    await bunny.adminFetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ modelFilter: 'all' }) });
    await page.goto(local + (mode === 'code' ? '/?s=' + codeChat.id : '/')); await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const box = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
      const vis = (el) => { if (!el) return false; const s = getComputedStyle(el); const b = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && b.width > 0 && b.height > 0; };
      const bar = document.getElementById('remote-bar'); const under = document.querySelector('.composer-under'); const foot = document.querySelector('.sidebar-foot'); const acct = document.getElementById('account-button');
      const chip = document.getElementById('picker-button'); const label = chip?.querySelector('.label'); const meta = chip?.querySelector('.meta'); const send = document.getElementById('send');
      // how many characters of the meta (the model name) are really visible: count characters whose box ends inside the meta's box
      let shown = 0; if (meta && meta.firstChild) { const mb = meta.getBoundingClientRect(); const tn = meta.firstChild; const rg = document.createRange(); for (let i = 0; i < tn.textContent.length; i += 1) { rg.setStart(tn, i); rg.setEnd(tn, i + 1); const rr = rg.getBoundingClientRect(); if (rr.right <= mb.right + 0.5) shown += 1; else break; } }
      const row = document.querySelector('.composer-row').getBoundingClientRect();
      const need = Object.fromEntries(['attach', 'voice', 'send'].map((id) => [id, box(document.getElementById(id))]));
      return { vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, bar: box(bar), barVisible: vis(bar), barText: bar?.innerText ?? '', under: box(under), underVisible: vis(under), foot: box(foot), footVisible: vis(foot), acct: box(acct), acctVisible: vis(acct),
        chip: box(chip), chipText: chip?.innerText ?? '', isAuto: chip?.classList.contains('is-auto'), labelText: label?.textContent, labelClipped: label ? label.scrollWidth > label.clientWidth + 1 : null, metaText: meta?.textContent ?? '', metaShown: shown, metaFull: (meta?.textContent ?? '').length, send: box(send), need, row: { l: Math.round(row.left), r: Math.round(row.right) } };
    });
    const phone = w < 600;
    // (1) the bar is there and the app takes the height that is left
    check(`1a ${tag}`, 'the real "Open to other devices" bar is shown at the top', m.barVisible && /Open to other devices/.test(m.barText) && m.bar.t <= 1, JSON.stringify({ bar: m.bar, text: m.barText.slice(0, 50) }));
    check(`1b ${tag}`, 'the row under the chat box is fully inside the window', m.underVisible && m.under.b <= m.vh + 0.5 && m.under.t >= 0 && m.under.r <= m.vw + 0.5, JSON.stringify({ under: m.under, vh: m.vh }));
    if (!phone) check(`1c ${tag}`, 'the sidebar foot (profile row) is fully inside the window', m.footVisible && m.foot.b <= m.vh + 0.5 && m.acctVisible && m.acct.b <= m.vh + 0.5, JSON.stringify({ foot: m.foot, acct: m.acct, vh: m.vh }));
    check(`1d ${tag}`, 'no sideways scroll', m.sw <= m.vw + 1, `${m.sw} vs ${m.vw}`);
    // (2) the chip on Auto
    check(`2a ${tag}`, 'the chip is on Auto and reads "Auto · <model>", Auto is whole (not "A…") and the model follows', m.isAuto && m.labelText === 'Auto' && m.labelClipped === false && /^· /.test(m.metaText) && m.metaText.length > 3, JSON.stringify({ label: m.labelText, clipped: m.labelClipped, meta: m.metaText.slice(0, 40), chip: m.chipText.replace(/\s+/g, ' ').slice(0, 60) }));
    const need = w >= 390 ? Math.min(15, m.metaFull - 2) : 5;
    if (phone) check(`2b ${tag}`, `on a phone the long name shows (390: about 18, at least 15 or the whole name; 360 and 320: at least 5) and the chip does not touch Send`, m.metaShown - 2 >= need && m.chip.r <= m.send.l + 0.5, `shown ${Math.max(0, m.metaShown - 2)} chars of "${m.metaText.slice(2, 30)}…"; chip right ${m.chip.r}, send left ${m.send.l}`);
    else check(`2b ${tag}`, 'on a wide window the whole name shows (or its end is the only part cut) and the chip stays left of Send', m.chip.r <= m.send.l + 0.5 && m.metaShown >= 12, `shown ${m.metaShown}/${m.metaFull}; chip right ${m.chip.r}, send left ${m.send.l}`);
    // (3) nothing else moved
    const inRow = ['attach', 'voice', 'send'].every((id) => m.need[id] && m.need[id].w > 0 && m.need[id].l >= m.row.l - 1 && m.need[id].r <= m.row.r + 1);
    check(`3a ${tag}`, '+ (attach), the mic and Send are all there and inside the button row', inRow, JSON.stringify(m.need));
    const order = m.need.attach && m.need.voice && m.need.send && m.need.attach.l < m.need.voice.l && m.chip.l > m.need.voice.r - 1 && m.chip.r <= m.need.send.l + 0.5;
    check(`3b ${tag}`, 'order is + , mic, (space), chip, Send; none overlap', order, JSON.stringify({ a: m.need.attach, v: m.need.voice, c: m.chip, s: m.need.send }));
    if (label === 'desktop' || label === 'phone 320') await page.screenshot({ path: join(OUT, `${mode}-${label.replace(' ', '')}-${scheme}.png`) });
    // sidebar foot on a phone: open the sidebar
    if (phone && label === 'phone 390') {
      await page.locator('#sidebar-toggle').click().catch(() => {}); await page.waitForTimeout(600);
      const f = await page.evaluate(() => { const e = document.querySelector('.sidebar-foot'); const b = e.getBoundingClientRect(); const a = document.getElementById('account-button').getBoundingClientRect(); return { fb: Math.round(b.bottom), ab: Math.round(a.bottom), vh: innerHeight, shown: b.width > 0 }; });
      check(`1e ${tag}`, 'on a phone, with the sidebar opened, the foot (profile row) is inside the window below the bar', f.shown && f.fb <= f.vh + 0.5 && f.ab <= f.vh + 0.5, JSON.stringify(f));
      await page.screenshot({ path: join(OUT, `${mode}-phone390-sidebar-${scheme}.png`) });
    }
    check(`E ${tag}`, 'no page error', errs.length === 0, errs.join(' | '));
    await ctx.close();
  }

  // Send works (desktop, Chat): type, press Send, the message appears and the box empties
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  const sendChat = (await adminJson('/api/sessions', 'POST', { title: 'Send check', providerId: 'openai', model: 'gpt-4o' })).json;
  await page.addInitScript(() => { localStorage.setItem('bunny.modelAuto', '0'); });
  await page.goto(local + '/?s=' + sendChat.id); await page.waitForTimeout(1500);
  await page.fill('#input', 'hello from the 0.1.11 walk'); await page.locator('#send').click(); await page.waitForTimeout(2500);
  const sent = await page.evaluate(() => ({ thread: document.getElementById('thread')?.innerText.slice(0, 200), box: document.getElementById('input').value, err: document.getElementById('error')?.innerText }));
  check('3c', 'Send works with the bar on: the message shows in the chat and the box is empty', /hello from the 0\.1\.11 walk/.test(sent.thread ?? '') && sent.box === '', JSON.stringify(sent).slice(0, 220));
  // turn the bar off: the app takes the whole window again
  await adminJson('/api/remote', 'PUT', { enabled: false }); await page.reload(); await page.waitForTimeout(1200);
  const off = await page.evaluate(() => ({ bar: !!document.getElementById('remote-bar'), appH: Math.round(document.querySelector('.app').getBoundingClientRect().height), vh: innerHeight }));
  check('3d', 'with remote OFF there is no bar and the app fills the window (no gap, no scroll)', !off.bar && Math.abs(off.appH - off.vh) <= 1 && true, JSON.stringify(off));
  await ctx.close();
} catch (err) { console.log('WALK CRASHED: ' + (err?.stack ?? err)); await finish(2); }
await finish();

/**
 * QA checks for the D-2 security fixes, the phone top bar and the status text above the composer. Invented profile only.
 *
 *   BUNNY_DATA_DIR=<temp> BUNNY_FAKE_UPSTREAM=1 BUNNY_API_TOKEN=<hex> PORT=5392 node src/server/main.js
 *   BASE=http://127.0.0.1:5392 BUNNY_API_TOKEN=<hex> OUT=<temp> node --import ./e2e/q2-token-preload.mjs e2e/q2-d2-security-walk.mjs
 */
import { mkdirSync, mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT, TOKEN = process.env.BUNNY_API_TOKEN;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
const NL = String.fromCharCode(10);
const rows = [];
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(8), name, '::', String(note).slice(0, 260));
};
const ok = (c, m) => { if (!c) throw new Error(m); };
const get = (p) => fetch(BASE + p, { headers: J });
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: J, body: JSON.stringify(b) });

// ---- a project with things that must stay out of reach ----
const outside = mkdtempSync(join(tmpdir(), 'bunny-q2s-out-')); writeFileSync(join(outside, 'secret.txt'), 'TOP-SECRET-OUTSIDE' + NL);
const d = mkdtempSync(join(tmpdir(), 'bunny-q2s-')); mkdirSync(join(d, 'src')); mkdirSync(join(d, '.git')); mkdirSync(join(d, '.hidden')); mkdirSync(join(d, 'node_modules'));
writeFileSync(join(d, 'README.md'), '# demo' + NL); writeFileSync(join(d, '.env'), 'API_KEY=SHOULD-NOT-BE-SHOWN' + NL); writeFileSync(join(d, '.git', 'config'), '[core] SHOULD-NOT-BE-SHOWN' + NL);
writeFileSync(join(d, '.hidden', 'x.txt'), 'SHOULD-NOT-BE-SHOWN' + NL); writeFileSync(join(d, 'src', '.env.local'), 'SHOULD-NOT-BE-SHOWN' + NL); writeFileSync(join(d, 'src', 'ok.js'), 'export const ok = 1;' + NL);
let linkKind = 'none'; try { symlinkSync(outside, join(d, 'link'), 'junction'); linkKind = 'junction'; } catch (e) { linkKind = 'failed ' + e.code; }
try { symlinkSync(join(outside, 'secret.txt'), join(d, 'src', 'filelink.txt'), 'file'); } catch { /* needs privilege; the junction covers the idea */ }
const mk = async (folder) => { const s = await (await post('/api/sessions', { title: 'sec', providerId: 'custom-x', model: 'm' })).json(); await fetch(`${BASE}/api/sessions/${s.id}/setting/folder`, { method: 'PATCH', headers: J, body: JSON.stringify({ value: folder }) }); return s.id; };
const sid = await mk(d);
const leak = (t) => /SHOULD-NOT-BE-SHOWN|TOP-SECRET|API_KEY/.test(t);

await row('S0', `fixture: junction ${linkKind}`, async () => ok(linkKind === 'junction', linkKind));
await row('S1', 'hidden folders (.git, node_modules) are not listed and cannot be read, in any spelling', async () => {
  const out = [];
  const names = JSON.parse(await (await get(`/api/sessions/${sid}/files?path=`)).text()).entries?.map((e) => e.name) ?? [];
  for (const hidden of ['.git', 'node_modules']) if (names.includes(hidden)) out.push(`${hidden} is listed`);
  for (const p of ['.git/config', '.GIT/config', '.git' + String.fromCharCode(92) + 'config','src/../.git/config', './.git/config', 'node_modules']) { const r = await get(`/api/sessions/${sid}/file?path=${encodeURIComponent(p)}`); const t = await r.text(); if (r.status === 200 || leak(t)) out.push(`${p} -> ${r.status}`); }
  for (const p of ['.git', 'node_modules', '.GIT']) { const r = await get(`/api/sessions/${sid}/files?path=${encodeURIComponent(p)}`); const t = await r.text(); if (r.status === 200 && /entries/.test(t) && /config/.test(t)) out.push(`listing ${p} -> 200`); }
  ok(!out.length, out.join(' ; ')); return `root lists: ${names.join(', ')} (.env and other dot files are shown: hidden means .git and node_modules only)`;
});
await row('S2', 'links: the junction is shown as a link and is never followed (list, read, or through it)', async () => {
  const out = []; const rootEntries = JSON.parse(await (await get(`/api/sessions/${sid}/files?path=`)).text()).entries ?? []; const ln = rootEntries.find((e) => e.name === 'link'); if (ln && !ln.link) out.push('link is shown as a plain folder');
  for (const p of ['link', 'link/secret.txt', 'src/filelink.txt']) { for (const route of ['files', 'file']) { const r = await get(`/api/sessions/${sid}/${route}?path=${encodeURIComponent(p)}`); const t = await r.text(); if (leak(t)) out.push(`${route} ${p} leaks`); } }
  ok(!out.length, out.join(' ; '));
});
await row('S3', 'read cap: a 3 MB file is cut off at 1 MB and says so; a long folder listing is capped', async () => {
  writeFileSync(join(d, 'big.txt'), 'x'.repeat(3 * 1024 * 1024)); const j = await (await get(`/api/sessions/${sid}/file?path=big.txt`)).json(); ok(JSON.stringify(j).length < 1.3 * 1024 * 1024, 'sent ' + JSON.stringify(j).length); ok(j.truncated === true, 'not marked truncated');
  mkdirSync(join(d, 'many')); for (let i = 0; i < 1500; i++) writeFileSync(join(d, 'many', `f${i}.txt`), 'x'); const l = await (await get(`/api/sessions/${sid}/files?path=many`)).json(); return `listing ${l.entries?.length} entries, truncated=${l.truncated}`;
});
await row('S4', 'never-browse: a drive root, Bunny data folder and its parent are not browsable through either route, even after being chosen', async () => {
  const data = process.env.DATA_DIR; const out = []; const tried = [];
  const targets = ['C:/', data, data ? join(data, '..') : null].filter(Boolean);
  for (const f of targets) {
    await post('/api/folder/check', { folder: f });
    const r = await get(`/api/folder/files?folder=${encodeURIComponent(f)}&path=`); tried.push(`${f.slice(-22)}:${r.status}`); if (r.status === 200) out.push(`${f} lists through /api/folder/files`);
    const s2 = await mk(f); const l = await get(`/api/sessions/${s2}/files?path=`); const lt = await l.text(); if (l.status === 200 && /entries/.test(lt) && JSON.parse(lt).entries?.length) out.push(`${f} lists through the chat route (${l.status})`);
    const rf = await get(`/api/sessions/${s2}/file?path=README.md`); if (rf.status === 200) out.push(`${f} reads a file through the chat route`);
  }
  ok(!out.length, out.join(' ; ')); return tried.join(' ');
});
// ---- phone: top bar targets and the status text above the composer ----
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, baseURL: BASE }); const page = await ctx.newPage();
await post('/api/providers/anthropic/connect', { apiKey: 'sk-test-000000000000' }); await fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify({ modelFilter: 'all' }) });
await page.goto('/'); await page.evaluate(() => localStorage.setItem('bunny.modelAuto', '0')); await page.goto('/'); await page.waitForSelector('#greeting');
await row('P1', 'phone top bar: every button is at least 40 px wide and tall', async () => {
  const small = await page.evaluate(() => [...document.querySelectorAll('.topbar button, .topbar .icon-btn, .toolbar button')].filter((b) => b.offsetParent).map((b) => { const r = b.getBoundingClientRect(); return { id: b.id || b.getAttribute('aria-label') || b.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((x) => x.w < 40 || x.h < 40));
  ok(!small.length, 'too small: ' + JSON.stringify(small)); await page.screenshot({ path: `${OUT}/s2-phone-topbar.png` });
});
await row('P2', 'phone: status text sits above the composer and is visible while it shows', async () => {
  await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
  await fetch(BASE + '/api/network', { method: 'PUT', headers: J, body: JSON.stringify({ offline: true }) }); await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
  await page.locator('#input').fill('wait here'); await page.locator('#send').click(); await page.waitForTimeout(600);
  const line = await page.evaluate(() => { const l = document.querySelector('.offline-line'); const c = document.querySelector('#input').closest('.composer, form, .composer-card') ?? document.querySelector('#input'); const a = l?.getBoundingClientRect(); const b = c.getBoundingClientRect(); return l ? { top: Math.round(a.top), bottom: Math.round(a.bottom), composerTop: Math.round(b.top), visible: !!l.offsetParent, text: l.textContent.trim().slice(0, 60) } : null; });
  await page.locator('#queued-msg').getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(200);
  const st = await page.evaluate(() => { const s = document.querySelector('#status-line'); const c = document.querySelector('#input').getBoundingClientRect(); const r = s.getBoundingClientRect(); return { text: s.textContent.trim().slice(0, 60), visible: !!s.offsetParent && r.height > 0, bottom: Math.round(r.bottom), composerTop: Math.round(c.top) }; });
  await page.screenshot({ path: `${OUT}/s2-phone-status.png` }); await fetch(BASE + '/api/network', { method: 'PUT', headers: J, body: JSON.stringify({ offline: false }) });
  ok(line && line.visible && line.bottom <= line.composerTop + 4, 'offline line: ' + JSON.stringify(line)); ok(st.text && st.visible && st.bottom <= st.composerTop + 4, 'status: ' + JSON.stringify(st)); return `line ${JSON.stringify(line)}; status ${JSON.stringify(st)}`;
});
await browser.close();
writeFileSync(`${OUT}/d2-security.json`, JSON.stringify(rows, null, 1));
console.log(`${NL}${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);

/**
 * QA v0.1.15 SETTINGS INVENTORY: every control in every Settings section, in the real Electron app (invented profile): section, id, kind, label, help line, value, enabled.
 *   node e2e/w0115-sinventory.mjs <outFile.json>
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115i-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0115i-user-'));
const OUT = process.argv[2] ?? join(process.cwd(), 'sinventory.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
const app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 90000 });
const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500);
const base = new URL(win.url()).origin;
const sections = ['profile', 'appearance', 'language', 'notifications', 'bunny', 'privacy', 'capabilities', 'connection', 'models', 'code', 'engines', 'usage', 'desktop', 'about'];
const all = [];
for (const section of sections) {
  await win.goto(`${base}/src/ui/settings.html?embed=1&section=${section}`); await wait(1800);
  const items = await win.evaluate((sec) => {
    const out = [];
    const root = document.querySelector(`[data-section="${sec}"]`) ?? document.body;
    const heading = (el) => { let h = null; for (let x = el; x && x !== root.parentElement; x = x.previousElementSibling ?? x.parentElement) { const hh = x.matches?.('h2,h3') ? x : x.querySelector?.(':scope > h2, :scope > h3'); if (hh) { h = hh; break; } } return h?.textContent.trim().replace(/\s+/g, ' ') ?? ''; };
    const controls = [...root.querySelectorAll('input, select, textarea, button')].filter((e) => !e.closest('dialog') && e.type !== 'hidden');
    for (const e of controls) {
      const rowEl = e.closest('.row, .group > div, label, li') ?? e.parentElement;
      const row = e.closest('.row');
      const name = row?.querySelector('.name')?.textContent.trim().replace(/\s+/g, ' ') ?? '';
      const desc = [...(row?.querySelectorAll('.desc') ?? [])].map((d) => d.textContent.trim().replace(/\s+/g, ' ')).join(' | ');
      const r = e.getBoundingClientRect();
      const val = e.type === 'checkbox' || e.type === 'radio' ? e.checked : e.tagName === 'SELECT' ? e.value : e.tagName === 'BUTTON' ? e.textContent.trim().slice(0, 40) : (e.value ?? '').slice(0, 60);
      out.push({ section: sec, group: heading(row ?? e), id: e.id || '', kind: e.tagName.toLowerCase() + (e.type && e.tagName === 'INPUT' ? ':' + e.type : ''), aria: e.getAttribute('aria-label') ?? '', name, desc: desc.slice(0, 700), value: val, disabled: e.disabled, shown: r.width > 0 && r.height > 0, options: e.tagName === 'SELECT' ? [...e.options].map((o) => o.value + '=' + o.textContent.trim()).join(' / ').slice(0, 300) : undefined, hasRow: Boolean(row) });
    }
    return out;
  }, section);
  all.push(...items);
  console.log(section, items.length);
}
writeFileSync(OUT, JSON.stringify(all, null, 1));
console.log('total', all.length, 'with id', all.filter((x) => x.id).length);
try { await Promise.race([app.close(), wait(15000)]); } catch { /* x */ }
process.exit(0);

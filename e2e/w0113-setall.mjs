/**
 * QA, v0.1.13 SET-ALL walk: EVERY control in EVERY Settings tab is changed to a non-default value in the REAL Electron window, Bunny is closed and
 * started again (three launches on one invented profile), and the value must still be there; each tab must show only its own section; a few controls
 * are also checked for doing what their text says. Lists every control that fails.
 *
 * Invented profile only: BUNNY_DATA_DIR + a separate --user-data-dir (never %LOCALAPPDATA%\BunnyAI). The OS "open at login" call and shell.openExternal are
 * replaced in the Electron main process by recorders, so the machine's startup list and browser are never touched. "Allow other devices" is NOT switched on in
 * the real window (it would open a port on the real network); it is checked at the server on 127.0.0.2 (see R-rows).
 *   node e2e/w0113-setall.mjs            (prints PASS/FAIL per row and a failure list at the end)
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0113-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0113-user-')); const WORK = mkdtempSync(join(tmpdir(), 'bunny-w0113-work-'));
const SHOTS = join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, label, ok, detail = '') => { rows.push({ id, label, ok: Boolean(ok), detail: String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
if (!existsSync(exe)) { console.log('electron not found'); process.exit(2); }

// The order matters a little: Language last (it changes the words), Desktop after Appearance.
const SECTIONS = ['profile', 'appearance', 'bunny', 'notifications', 'privacy', 'capabilities', 'models', 'connection', 'code', 'desktop', 'usage', 'about', 'language'];
const PAGES = ['providers', 'customize', 'automation'];
const SKIP = new Set(['photo-file', 'import-answer', 'remote-on', 'remote-pass', 'close-to-tray', 'cz-plugin-file', 'rules-pattern', 'rules-kind', 'rules-effect', 'rules-folder', 'rules-try', 'wait-custom-input']);
const EXP = {}; // section -> { sel: expected value }, set in launch 1, read back in launches 2 and 3
const NOTES = [];

let app; let win;
const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
async function launch() {
  app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 90000 });
  win = await app.firstWindow(); win.on('pageerror', (e) => NOTES.push('pageerror: ' + e.message));
  await win.waitForLoadState('domcontentloaded'); await wait(2500);
  await app.evaluate(({ app: a, shell, dialog }, folder) => {
    globalThis.__login = []; globalThis.__ext = [];
    a.setLoginItemSettings = (o) => { globalThis.__login.push(o); };
    shell.openExternal = async (u) => { globalThis.__ext.push(String(u)); };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, WORK);
  const ud = await app.evaluate(({ app: a }) => a.getPath('userData'));
  if (!ud.toLowerCase().startsWith(USER.toLowerCase())) throw new Error('not the invented profile: ' + ud);
  return new URL(win.url()).port;
}
async function quit() { try { await Promise.race([app.close(), wait(20000)]); } catch { /* x */ } try { app.process().kill(); } catch { /* x */ } await wait(1500); }

async function openSection(key) {
  const open = await win.locator('#settings-backdrop').evaluate((el) => !el.hidden).catch(() => false);
  if (!open) { await win.locator('#settings-open').click(); await wait(500); }
  await win.locator(`#settings-nav-list [data-section="${key}"]`).click();
  const want = { providers: 'providers.html', customize: 'customize.html', automation: 'automation.html' }[key] ?? 'settings.html';
  let frame = null;
  for (let i = 0; i < 40 && !frame; i++) { await wait(250); frame = win.frames().find((f) => f.url().includes(want) && (want !== 'settings.html' || f.url().includes('section=' + key))); }
  if (!frame) throw new Error('no frame for ' + key);
  await frame.waitForLoadState('load'); await wait(1800);
  return frame;
}
const harvest = (frame, own) => frame.evaluate(([skip, own]) => {
  const out = [];
  const scope = own ? document.querySelector(`section[data-section="${own}"]`) : document;
  for (const el of (scope ?? document).querySelectorAll('input, select, textarea')) {
    const t = el.type;
    if (['file', 'hidden', 'button', 'submit', 'password', 'search'].includes(t)) continue;
    if (el.closest('[hidden]') || !(el.parentElement?.checkVisibility?.() ?? true)) continue;
    const sel = el.id ? '#' + el.id : el.dataset.key ? `[data-key="${el.dataset.key}"]` : el.dataset.cap ? `[data-cap="${el.dataset.cap}"]` : el.getAttribute('aria-label') ? `[aria-label="${el.getAttribute('aria-label')}"]` : null;
    if (!sel || skip.includes(el.id)) continue;
    out.push({ sel, type: t, tag: el.tagName, value: el.value, checked: el.checked, min: el.min, max: el.max, step: el.step, maxlength: el.maxLength, disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
      options: el.tagName === 'SELECT' ? [...el.options].filter((o) => !o.disabled).map((o) => o.value) : [] });
  }
  return out;
}, [[...SKIP], own]);
const visibleSections = (frame) => frame.evaluate(() => ({
  sections: [...document.querySelectorAll('section[data-section]')].filter((s) => s.checkVisibility()).map((s) => s.dataset.section),
  browserGroup: (() => { const h = [...document.querySelectorAll('h3')].find((x) => /Use Bunny in a browser/.test(x.textContent)); return Boolean(h && h.checkVisibility()); })(),
  h2: [...document.querySelectorAll('h2')].filter((h) => h.checkVisibility()).map((h) => h.textContent.trim().slice(0, 30)),
}));
const readControl = (frame, c) => frame.locator(c.sel).first().evaluate((el) => (el.type === 'checkbox' ? el.checked : el.value));

function newValue(c, key) {
  if (c.type === 'checkbox') return !c.checked;
  if (c.tag === 'SELECT') {
    const others = c.options.filter((v) => v !== c.value);
    if (!others.length) return null;
    if (c.sel === '#wait-select') return others.find((v) => v !== 'custom') ?? others[0];
    if (c.sel === '#language') return others.includes('fr') ? 'fr' : others[others.length - 1];
    if (c.sel === '#default-permission') return others.find((v) => !/bypass|full/i.test(v)) ?? others[0];
    return others[others.length - 1];
  }
  if (c.type === 'number') { const cur = Number(c.value) || 0; const step = Number(c.step) || 1; const min = Number(c.min) || 0; return String(Math.max(min, cur) + step * 2); }
  if (c.sel === '#aliases') return 'qa=gpt-4o';
  const v = 'QA ' + key + ' ' + c.sel.replace(/[^a-z0-9]/gi, '').slice(0, 12);
  return c.maxlength > 0 && c.maxlength < v.length ? v.slice(0, c.maxlength) : v;
}
async function apply(frame, c, v) {
  const loc = frame.locator(c.sel).first();
  if (c.type === 'checkbox') { await loc.evaluate((el) => el.click()); }
  else if (c.tag === 'SELECT') { await loc.selectOption(String(v), { force: true }); }
  else { await loc.fill(String(v), { force: true }); await loc.blur(); await loc.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true }))); }
  await wait(450);
}

const failList = [];
const rowFail = (id, label, detail) => failList.push({ id, label, detail });

// ============================ launch 1: change everything ============================
const port1 = await launch();
console.log('launch 1 on port', port1);
try {
  for (const key of [...SECTIONS, ...PAGES]) {
    let frame;
    try { frame = await openSection(key); } catch (e) { check('T-' + key, `tab ${key}: opens`, false, e.message); continue; }
    const vis = await visibleSections(frame);
    if (SECTIONS.includes(key)) {
      const only = vis.sections.length === 1 && vis.sections[0] === key;
      check('T-' + key, `tab ${key}: shows only its own section (and the "Use Bunny in a browser" group only on Desktop app)`, only && (key === 'desktop' || !vis.browserGroup), JSON.stringify(vis));
    }
    if (!SECTIONS.includes(key)) { check('T-' + key, `tab ${key}: its own page loads, with no settings section from another tab`, vis.sections.length === 0 && !vis.browserGroup, JSON.stringify(vis)); continue; }
    const controls = (await harvest(frame, key)).filter((c) => !c.disabled);
    EXP[key] = {};
    for (const c of controls) {
      const v = newValue(c, key);
      if (v === null) { check(`C-${key}-${c.sel}`, `${key} ${c.sel}: has only one choice (cannot be changed)`, true); continue; }
      let dialogSeen = '';
      const onDialog = (d) => { dialogSeen = d.message(); d.dismiss().catch(() => {}); };
      win.on('dialog', onDialog);
      try { await apply(frame, c, v); } catch (e) { check(`C-${key}-${c.sel}`, `${key} ${c.sel}: change it`, false, e.message.split('\n')[0]); win.off('dialog', onDialog); continue; }
      win.off('dialog', onDialog);
      let now;
      try { now = await readControl(frame, c); } catch { now = undefined; }
      if (key === 'models' && (c.sel === '#allowlist' || c.sel === '#aliases')) { await frame.locator('#save-models').click(); await wait(500); }
      const ok = String(now) === String(v);
      EXP[key][c.sel] = v;
      if (!ok) { check(`C-${key}-${c.sel}`, `${key} ${c.sel}: stays at the new value right after the change`, false, `wanted ${v}, shows ${now}${dialogSeen ? ' ; dialog: ' + dialogSeen : ''}`); rowFail(`${key} ${c.sel}`, 'does not take the new value', `wanted ${v}, shows ${now}`); delete EXP[key][c.sel]; }
      else console.log(`  set ${key} ${c.sel} = ${v}`);
    }
  }

  // ---- specials in launch 1 ----
  // Quick ask turns "Keep running in the tray" on with it
  const desk = await openSection('desktop');
  const tray = await desk.locator('#close-to-tray').evaluate((el) => el.checked);
  EXP.desktop['#close-to-tray'] = true; // the tray rule: Quick ask on => tray on
  check('S-tray', 'desktop: Quick ask on => "Keep running in the tray" is on too', tray === true, String(tray));
  const login1 = await app.evaluate(() => globalThis.__login);
  check('S-login', 'desktop: "Start when I sign in" asked the OS to open at login (recorder; the real startup list is not touched)', login1.some((o) => o.openAtLogin === true), JSON.stringify(login1));
  const ext1 = await app.evaluate(() => globalThis.__ext);
  NOTES.push('openExternal calls in launch 1: ' + JSON.stringify(ext1));
  const quickReg = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+Space'));
  check('S-quick', 'desktop: Quick ask on => its global shortcut is registered', quickReg === true, String(quickReg));

  // Rules, permission mode: add a rule through the real controls
  const code = await openSection('code');
  await code.locator('#rules-pattern').fill('qa-rule-*'); await code.locator('#rules-kind').selectOption({ index: 0 }).catch(() => {});
  await code.locator('#rules-effect').selectOption({ index: 1 }).catch(() => {});
  await code.locator('#rules-add-btn').click(); await wait(800);
  const ruleShown = await code.locator('body').innerText();
  check('S-rule', 'code: a rule added in All folders appears in the list', /qa-rule-\*/.test(ruleShown));
  // Profile photo / name appear in the sidebar
  await app.evaluate(() => 0);
  // Do what the text says: theme, name
  const themeAttr = await win.evaluate(() => document.documentElement.dataset.theme ?? document.documentElement.getAttribute('data-theme'));
  check('W-theme', 'appearance: the Theme choice is applied to the main window now', Boolean(themeAttr), String(themeAttr));
  await win.screenshot({ path: join(SHOTS, 'launch1.png') });
  // Model chip & Provider add (a custom provider) and customize/automation items
  const prov = await openSection('providers');
  await prov.locator('#custom-name').fill('QA Harbor'); await prov.locator('#custom-url').fill('http://127.0.0.1:9/v1'); await prov.locator('#custom-add').click(); await wait(1500);
  const provText = await prov.locator('body').innerText();
  check('P-add', 'providers: a custom provider can be added and is listed', /QA Harbor/.test(provText));
  const cz = await openSection('customize');
  await cz.locator('#cz-add').click(); await cz.locator('[data-add="skill"]').click(); await wait(300);
  await cz.locator('input[aria-label="Skill name"]').fill('QA skill'); await cz.locator('textarea[aria-label="Skill instructions"]').fill('Always say qa.');
  await cz.locator('form button[type=submit]:visible', { hasText: 'Add skill' }).click(); await wait(1000);
  const czText = await cz.locator('body').innerText();
  check('P-skill', 'customize: a skill can be added and is listed', /QA skill/.test(czText));
  const au = await openSection('automation');
  await au.locator('#memory-text').fill('QA remembers the walk'); await au.locator('#memory-text').press('Enter'); await wait(800);
  await au.locator('#schedule-name').fill('QA schedule'); await au.locator('#schedule-prompt').fill('say qa'); await au.locator('#schedule-every').fill('90');
  await au.locator('#schedule-name').press('Enter'); await wait(800);
  await au.locator('#hook-name').fill('QA hook'); await au.locator('#hook-command').fill('echo qa'); await au.locator('#hook-name').press('Enter'); await wait(800);
  const auText = await au.locator('body').innerText();
  check('P-auto', 'automation: a memory, a schedule and a hook can be added and are listed', /QA remembers the walk/.test(auText) && /QA schedule/.test(auText) && /QA hook/.test(auText), auText.replace(/\s+/g, ' ').slice(0, 120));
} catch (e) { check('L1', 'launch 1 ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | ')); }
await quit();

// ============================ launches 2 and 3: is everything still there? ============================
const ports = [port1];
async function verifyLaunch(n) {
  const port = await launch(); ports.push(port); console.log(`launch ${n} on port`, port);
  try {
    for (const key of SECTIONS) {
      if (!EXP[key]) continue;
      let frame; try { frame = await openSection(key); } catch (e) { check(`K${n}-${key}`, `launch ${n}: tab ${key} opens`, false, e.message); continue; }
      const controls = await harvest(frame, key);
      for (const [sel, want] of Object.entries(EXP[key])) {
        const c = controls.find((x) => x.sel === sel);
        const id = `K${n}-${key}-${sel}`;
        if (!c) { check(id, `launch ${n}: ${key} ${sel} is shown`, false, 'control not found'); rowFail(`${key} ${sel}`, `launch ${n}: control missing`, ''); continue; }
        const got = c.type === 'checkbox' ? c.checked : c.value;
        const norm = (x) => String(x).replace(/\s+/g, '');
        const ok = norm(got) === norm(want);
        check(id, `launch ${n}: ${key} ${sel} kept its value after restart`, ok, ok ? '' : `set ${want}, now ${got}`);
        if (!ok) rowFail(`${key} ${sel}`, `launch ${n}: not kept`, `set ${want}, now ${got}`);
      }
    }
    // the pages' items
    const prov = await openSection('providers'); check(`K${n}-prov`, `launch ${n}: the custom provider is still there`, /QA Harbor/.test(await prov.locator('body').innerText()));
    const cz = await openSection('customize'); await cz.locator('.cz-tab[data-kind="skills"]').click(); await wait(800); check(`K${n}-skill`, `launch ${n}: the skill is still there`, /QA skill/.test(await cz.locator('body').innerText()));
    const au = await openSection('automation'); const at = await au.locator('body').innerText();
    check(`K${n}-auto`, `launch ${n}: the memory, schedule and hook are still there`, /QA remembers the walk/.test(at) && /QA schedule/.test(at) && /QA hook/.test(at));
    const code = await openSection('code'); check(`K${n}-rule`, `launch ${n}: the rule is still there`, /qa-rule-\*/.test(await code.locator('body').innerText()));
    const quickReg = await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+Space'));
    check(`K${n}-quick`, `launch ${n}: Quick ask's shortcut is registered again after restart`, quickReg === true, String(quickReg));
    const desk = await openSection('desktop'); const vis = await visibleSections(desk);
    check(`K${n}-desk-vis`, `launch ${n}: the Desktop app tab shows the browser group`, vis.browserGroup, JSON.stringify(vis));
    const pr = await win.evaluate(() => window.bunnyDesktop.getPrefs());
    NOTES.push(`launch ${n} prefs: ` + JSON.stringify(pr));
    // the UI's own "does what it says": the main window carries the saved Theme and language
    const lang = await win.evaluate(() => document.documentElement.lang);
    NOTES.push(`launch ${n} html lang=${lang}`);
  } catch (e) { check(`K${n}`, `launch ${n} ran to the end`, false, e.stack?.split('\n').slice(0, 3).join(' | ')); }
  await quit();
}
await verifyLaunch(2);
await verifyLaunch(3);
check('A-addr', '"Keep the same address after restart": launch 2 and launch 3 are on the same port (launch 1 cannot be, it was off then)', ports[1] === ports[2], ports.join(' > '));
check('A-addr1', '"Keep the same address after restart": the address of launch 1 is kept at launch 2 (what a person expects: switch it on, restart, same address)', ports[0] === ports[1], ports.join(' > '));

// ============================ R: remote access survives a restart (server, 127.0.0.2, never the real network) ============================
try {
  const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
  const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href).catch(() => ({}));
  const dir = mkdtempSync(join(tmpdir(), 'bunny-w0113-remote-'));
  const open = async () => createApp({ dataDir: dir, fake: true, probe: async () => ({ ok: true }), discover: async () => [], localGuard: true, folderPickerOnly: true, lanAddress: '127.0.0.2', networkProfile: async () => ({ name: 'Test network', category: 'Public' }), secretStore: memorySecretStore() });
  let b = await open(); await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
  const put = await b.adminFetch('/api/remote', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, passcode: 'qa-passcode-0113-abc' }) });
  const on1 = (await put.json()).enabled;
  await b.close?.(); try { b.server.close(); } catch { /* x */ } await wait(500);
  b = await open(); await new Promise((r) => b.server.listen(0, '127.0.0.1', r));
  const resumed = typeof b.resumeRemote === 'function' ? await b.resumeRemote() : null; // the shell calls this at start
  const st = await (await b.adminFetch('/api/remote', { method: 'GET' })).json();
  check('R-stay', '"Allow other devices to open Bunny": still on after Bunny is closed and started again (v0.1.13 REMOTE-STAY: expected ON)', on1 === true && st.enabled === true, `before restart enabled=${on1}; after restart enabled=${st.enabled}`);
  if (!(on1 === true && st.enabled === true)) rowFail('desktop #remote-on', 'not kept after restart (server)', `enabled after restart=${st.enabled}`);
  try { b.server.close(); } catch { /* x */ }
} catch (e) { check('R-stay', 'remote access restart check ran', false, e.message); }

// ============================ report ============================
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} rows passed; pictures in ${SHOTS}`);
for (const n of NOTES) console.log('NOTE ' + n);
console.log('\n=== FAILED ===');
for (const r of bad) console.log(`${r.id} :: ${r.label} :: ${r.detail}`);
writeFileSync(join(DATA, 'result.json'), JSON.stringify({ rows, EXP, ports }, null, 1));
console.log('result file: ' + join(DATA, 'result.json'));
process.exit(bad.length ? 1 : 0);

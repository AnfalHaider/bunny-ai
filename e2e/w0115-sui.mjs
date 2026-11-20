/**
 * QA v0.1.15 SETTINGS, the rest: what the first pass could not reach. Real Electron, invented profile, BUNNY_FAKE_UPSTREAM=1.
 * Appearance effects on the main window, the controls found only by their row text, model aliases, engines, permission rules, the display-only sections, the language switch; then a restart.
 *   node e2e/w0115-sui.mjs <outFile.json>
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';
const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115u-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0115u-user-'));
const OUT = process.argv[2] ?? join(process.cwd(), 'sui.json'); const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let app = null; let win = null; let base = ''; const log = [];
const note = (id, text, extra = {}) => { log.push({ id, text, ...extra }); console.log(id + '  ' + text); };
const launch = async () => {
  const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
  app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 90000 });
  await app.evaluate(({ app: a, globalShortcut, shell }) => { globalShortcut.register = () => true; globalShortcut.unregister = () => {}; globalShortcut.isRegistered = () => true; a.setLoginItemSettings = () => {}; shell.openExternal = async () => {}; });
  win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500); base = new URL(win.url()).origin;
};
const quit = async () => { try { await Promise.race([app.close(), wait(15000)]); } catch { /* x */ } };
const getS = () => win.evaluate(async () => { const m = await import('/src/ui/api.js'); return m.getJSON('/api/settings'); });
const putS = (p) => win.evaluate(async (patch) => { const m = await import('/src/ui/api.js'); return m.sendJSON('/api/settings', 'PUT', patch); }, p);
const diff = (a, b) => Object.keys({ ...a, ...b }).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k])} -> ${JSON.stringify(b[k])}`.slice(0, 120));
const section = async (s) => { await win.goto(`${base}/src/ui/settings.html?embed=1&section=${s}`); await wait(1600); };
const byName = (name) => win.locator('.row').filter({ has: win.locator('.name', { hasText: name }) }).locator('input, select, textarea').first();
const flip = async (loc) => loc.evaluate((e) => { const l = e.closest('label'); if (l) l.click(); else e.click(); });
const dialogs = async () => { for (let i = 0; i < 3; i++) { const b = win.locator('dialog[open] button, .engine-confirm button, [role=dialog] button').filter({ hasText: /^(Turn on|Turn it off|OK|Yes|Allow|Enable|Confirm)$/ }); if (await b.count()) { await b.first().click().catch(() => {}); await wait(600); } else break; } };
const step = async (id, label, fn) => { const before = await getS(); const pb = await win.evaluate(() => window.bunnyDesktop.getPrefs()); let err = ''; try { await fn(); } catch (e) { err = String(e.message ?? e).split('\n')[0].slice(0, 140); } await wait(1000); await dialogs(); await wait(500); const after = await getS(); const pa = await win.evaluate(() => window.bunnyDesktop.getPrefs()); note(id, label + ' => settings changed: ' + (diff(before, after).concat(diff(pb, pa).map((d) => 'PREF ' + d)).join('; ') || '(nothing saved)') + (err ? ' ERR ' + err : '')); };

try {
  await launch();
  await win.evaluate(async () => { const m = await import('/src/ui/api.js'); await m.sendJSON('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'sk-qa-0000000000' }); });
  // ---- appearance effects on the main window ----
  const root0 = () => win.evaluate(() => { const r = document.documentElement; const cs = getComputedStyle(r); return { theme: r.dataset.theme ?? '', motion: r.dataset.motion ?? '', fontSans: r.style.getPropertyValue('--font-sans'), reply: r.style.getPropertyValue('--font-reply'), fsT: r.style.getPropertyValue('--fs-transcript'), thread: r.style.getPropertyValue('--thread-max'), mono: r.style.getPropertyValue('--font-mono'), fsCode: r.style.getPropertyValue('--fs-code'), bg: cs.backgroundColor }; });
  await win.goto(base + '/'); await wait(2000); const r0 = await root0();
  await putS({ theme: 'dark', interfaceFont: 'serif', responseFont: 'mono', transcriptSize: 'large', transcriptWidth: 'wide', motion: 'reduced', codeFont: 'Consolas', codeFontSize: '16' });
  await win.goto(base + '/'); await wait(2000); const r1 = await root0();
  note('APPEARANCE-MAIN', 'main window before/after theme=dark, interfaceFont=serif, responseFont=mono, transcriptSize=large, width=wide, motion=reduced, codeFont=Consolas, codeFontSize=16', { r0, r1 });
  await putS({ theme: 'system', interfaceFont: 'system', responseFont: 'match', transcriptSize: 'medium', transcriptWidth: 'narrow', motion: 'system', codeFont: '', codeFontSize: '' });
  // ---- language ----
  const textOf = () => win.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 4000));
  await win.goto(base + '/'); await wait(1500); const mainEn = await textOf(); await section('profile'); const setEn = await textOf();
  await putS({ language: 'fr' }); await win.goto(base + '/'); await wait(1800); const mainFr = await textOf(); await section('profile'); const setFr = await textOf();
  const words = (s) => new Set(s.split(' ')); const changedShare = (a, b) => { const A = [...words(a)]; const wb = words(b); return A.length ? Math.round((A.filter((w) => !wb.has(w)).length / A.length) * 100) : 0; };
  note('LANGUAGE', `after Language=fr: main window words that changed ${changedShare(mainEn, mainFr)}%, Settings page words that changed ${changedShare(setEn, setFr)}%`, { mainEnSample: mainEn.slice(0, 160), mainFrSample: mainFr.slice(0, 160), setEnSample: setEn.slice(0, 160), setFrSample: setFr.slice(0, 160) });
  await putS({ language: 'en' });
  // ---- Appearance: Code font ----
  await section('appearance'); const cf = byName('Code font'); note('CODEFONT-found', 'Code font input found: ' + (await cf.count()));
  await step('CODEFONT', 'Code font = Consolas', async () => { await cf.fill('Consolas'); await cf.blur(); await cf.dispatchEvent('change'); });
  // ---- Capabilities ----
  await section('capabilities');
  await step('COMPUTER-ON', 'Enable computer use (turn off then on)', async () => { await flip(byName('Enable computer use')); await wait(700); await flip(byName('Enable computer use')); });
  await step('COMPUTER-DESKTOP', 'Let the AI control the desktop', async () => { await flip(byName('Let the AI control the desktop')); });
  await step('BUILD-TOOLS', 'Let the AI build its own tools', async () => { await flip(byName('Let the AI build its own tools')); });
  // ---- Models ----
  await section('models');
  await step('FALLBACK', 'Try another model when yours is busy', async () => { await flip(byName('Try another model when yours is busy')); });
  await step('WAIT-CUSTOM', 'Wait for a first reply = Custom 45', async () => { await win.locator('#wait-select').selectOption('custom'); await wait(400); const c = win.locator('#wait-custom-input'); await c.fill('45'); await c.blur(); await c.dispatchEvent('change'); });
  await section('models'); const al = win.locator('#aliases');
  await step('ALIASES-bad', 'Aliases = "qa-aliases" (no equals sign) + Save models', async () => { await al.fill('qa-aliases'); await win.locator('#save-models').click(); });
  note('ALIASES-bad-message', 'text shown near Save: ' + (await win.locator('#save-models').innerText()) + ' | page errors: ' + ((await win.locator('[role=alert]:visible, .error:visible, .msg:visible').allInnerTexts().catch(() => [])).join(' / ').slice(0, 200) || '(none)'));
  await step('ALIASES-ok', 'Aliases = "fast = qa-model" + Save models', async () => { await al.fill('fast = qa-model'); await win.locator('#save-models').click(); });
  // ---- Code ----
  await section('code');
  await step('BRANCH-PREFIX', 'Branch prefix = zebra', async () => { const b = byName('Branch prefix'); await b.fill('zebra'); await b.blur(); await b.dispatchEvent('change'); });
  await step('PERMISSION-RULE', 'Add rule: command, pattern git push*, Ask', async () => { await win.locator('#rules-kind').selectOption('command'); await win.locator('#rules-pattern').fill('git push*'); await win.locator('#rules-effect').selectOption('ask'); await win.locator('#rules-add-btn').click(); });
  const rulesText = await win.locator('#rules-list, .rules-list, [data-section="code"]').first().innerText().catch(() => ''); note('PERMISSION-RULE-list', 'Code section text mentions the new rule: ' + /git push\*/.test(rulesText));
  const rulesApi = await win.evaluate(async () => { const m = await import('/src/ui/api.js'); return m.getJSON('/api/permission-rules').catch((e) => String(e)); }); note('PERMISSION-RULE-api', JSON.stringify(rulesApi).slice(0, 300));
  await win.locator('#rules-try').fill('git push origin main'); await wait(900); note('PERMISSION-RULE-try', 'try box answer: ' + (await win.locator('[data-section="code"]').innerText()).split('\n').filter((l) => /would|Ask|ask before|matches/i.test(l)).slice(0, 3).join(' / '));
  // ---- Engines ----
  await section('engines');
  const ed = win.locator('#engine-default'); note('ENGINE-default-options', await ed.evaluate((s) => [...s.options].map((o) => o.value + '=' + o.textContent.trim() + (o.disabled ? '(disabled)' : '')).join(' / ')));
  await step('ENGINE-bunny-rules', "Use Bunny's engine off (with the confirm)", async () => { await flip(win.locator('#engine-bunny-rules')); await wait(600); await win.locator('.engine-confirm').getByRole('button', { name: 'Turn it off' }).click(); });
  // ---- display-only sections ----
  for (const s of ['privacy', 'connection', 'usage', 'about']) { await section(s); const items = await win.evaluate((sec) => { const r = document.querySelector(`[data-section="${sec}"]`) ?? document.body; return { text: r.innerText.replace(/\s+/g, ' ').slice(0, 1200), buttons: [...r.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim().slice(0, 40)), links: [...r.querySelectorAll('a')].map((a) => a.textContent.trim().slice(0, 40)) }; }, s); note('DISPLAY-' + s, JSON.stringify(items)); }
  const before = await getS(); await quit(); await launch(); const after = await getS();
  note('RESTART-diff', 'settings that differ after restart (should be none): ' + (diff(before, after).join('; ') || 'none'));
  note('RESTART-keys', 'aliases ' + JSON.stringify(after.aliases) + ' branchPrefix ' + after.branchPrefix + ' wait ' + after.firstReplyWaitSeconds + ' codeFont ' + after.codeFont);
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); }
writeFileSync(OUT, JSON.stringify(log, null, 1));
await quit(); process.exit(0);

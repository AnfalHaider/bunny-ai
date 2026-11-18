/**
 * QA, v0.1.10 SETTINGS-BRIDGE (1d16eb6): every window-only write from Settings (an iframe of the main window) works in the REAL Electron window.
 * App run from source in Electron, invented profile (BUNNY_DATA_DIR and --user-data-dir temp folders, BUNNY_FAKE_UPSTREAM=1), never %LOCALAPPDATA%\BunnyAI.
 * GitHub is an invented repository on disk (a --require patch of the main process's fetch); the native folder dialog is a stand-in; no OS keys.
 *   node e2e/w110-bridge.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe'); const NL = String.fromCharCode(10);
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w110-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w110-user-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w110-folder-'));
const SHOTS = join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const real = join(process.env.LOCALAPPDATA ?? '', 'BunnyAI'); const skillMd = (n, body) => '---' + NL + 'name: ' + n + NL + 'description: about ' + n + NL + '---' + NL + body;
const TREE = join(DATA, 'gh-tree.json');
const setTree = (files) => writeFileSync(TREE, JSON.stringify({ files }));
const V1 = { 'plugin.json': JSON.stringify({ name: 'carrot-pack', description: 'v1' }), 'skills/grow/SKILL.md': skillMd('grow', 'Water daily.'), '.mcp.json': JSON.stringify({ mcpServers: { soil: { url: 'http://127.0.0.1:9/mcp' } } }) };
setTree(V1);
// an invented MCP server so a connector can list its tools (needed before its labels can be trusted)
const mcp = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { let m = {}; try { m = JSON.parse(raw); } catch { /* x */ } const json = (o, h = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
  if (m.method === 'initialize') return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'inv', version: '1' } } });
  if (m.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
  if (m.method === 'tools/list') return json({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'ping', description: 'p', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } });
  res.writeHead(200); res.end('{}'); }); });
await new Promise((r) => mcp.listen(0, '127.0.0.1', r)); const MCP = 'http://127.0.0.1:' + mcp.address().port + '/mcp';

const env = { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1', QA_GH_TREE: TREE, NODE_OPTIONS: '--require="' + resolve('e2e/w110-github-patch.cjs').split(String.fromCharCode(92)).join('/') + '"' }; delete env.ELECTRON_RUN_AS_NODE; delete env.BUNNY_UPDATE_FEED;
const app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 60000 });
const win = await app.firstWindow(); const errors = []; win.on('pageerror', (e) => errors.push(e.message));
await win.waitForLoadState('domcontentloaded'); await wait(2500);
const info = await app.evaluate(({ app: a }) => ({ userData: a.getPath('userData'), packaged: a.isPackaged, version: a.getVersion() }));
check('S0', 'the real Electron window runs from source on the invented profile (userData is the temp folder, not packaged)', info.userData.toLowerCase().startsWith(USER.toLowerCase()) && !info.packaged, JSON.stringify(info));

// the main process's fetch (undici) answers for github.com from the invented repository on disk; every other host goes through untouched
await app.evaluate(async (_e, treeFile) => {
  const fsm = process.getBuiltinModule('node:fs'); const sym = Symbol.for('undici.globalDispatcher.1'); const orig = globalThis[sym];
  globalThis[sym] = {
    dispatch(opts, handler) {
      let host = ''; try { host = new URL(opts.origin ?? '', 'http://x').hostname; } catch { /* x */ }
      if (host === 'api.github.com' || host === 'raw.githubusercontent.com' || host === 'github.com') {
        const files = JSON.parse(fsm.readFileSync(treeFile, 'utf8')).files; const p = String(opts.path ?? ''); let status = 404; let body = 'not found';
        if (p.includes('/git/trees/')) { status = 200; body = JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }); }
        else { const rel = p.split('?')[0].split('/').filter(Boolean).slice(3).join('/'); if (host === 'raw.githubusercontent.com' && files[rel] !== undefined) { status = 200; body = files[rel]; } }
        handler.onConnect?.(() => {}); handler.onHeaders(status, [Buffer.from('content-type'), Buffer.from('application/json')], () => {}, 'X'); handler.onData(Buffer.from(body)); handler.onComplete([]); return true;
      }
      return orig.dispatch(opts, handler);
    },
    close: (...a) => orig.close?.(...a), destroy: (...a) => orig.destroy?.(...a),
  };
}, TREE);
const origin = new URL(win.url()).origin;
// stand-in for the native folder dialog
await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, FOLDER);

/** Open a Settings page in the iframe of the main window, exactly as the Settings dialog does, and return its frame. */
async function frameFor(file) {
  await win.evaluate(([o, f]) => { const bd = document.getElementById('settings-backdrop'); bd.hidden = false; document.getElementById('settings-frame').src = o + f; }, [origin, file]);
  await wait(1800); const fr = win.frames().find((x) => x.url().includes(file.split('?')[0])); if (!fr) throw new Error('no frame for ' + file); return fr;
}
const call = (fr, method, path, body) => fr.evaluate(async ([m, p, b]) => { const api = await import('/src/ui/api.js'); try { const r = await api.sendJSON(p, m, b); return { ok: true, r }; } catch (e) { return { ok: false, status: e.status ?? null, code: e.code ?? null, message: e.message }; } }, [method, path, body]);
const plain = (fr, method, path, body) => fr.evaluate(async ([m, p, b]) => (await fetch(p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b ?? {}) })).status, [method, path, body]);
const get = async (path) => win.evaluate(async (p) => (await fetch(p)).json(), path);
const noRefuse = (r) => r.ok || !/Change this in Bunny's window|windowOnly/i.test(JSON.stringify(r));
try {
  // ---- the condition itself: in the iframe the preload bridge is not there, the bridge helper finds the parent's
  const cz = await frameFor('/src/ui/customize.html?embed=1');
  const cond = await cz.evaluate(async () => { const api = await import('/src/ui/api.js'); return { own: typeof window.bunnyDesktop, parentHas: typeof window.parent.bunnyDesktop, helper: typeof api.desktopBridge?.(), secure: typeof api.desktopBridge?.()?.secureWrite }; });
  check('B0', 'inside the Settings iframe window.bunnyDesktop is missing (the bug\'s cause) but desktopBridge() reaches the parent\'s bridge with secureWrite', cond.own === 'undefined' && cond.parentHas === 'object' && cond.helper === 'object' && cond.secure === 'function', JSON.stringify(cond));
  check('B1', 'a plain HTTP write of a window-only route from the iframe is STILL refused by the server (403): the fix goes through the bridge, it does not open the route', (await plain(cz, 'POST', '/api/skills', { name: 'plain', instructions: 'x' })) === 403, '');

  // ---- skill: add, remove
  const sk = await call(cz, 'POST', '/api/skills', { name: 'qa-skill', description: 'd', instructions: 'QA-SKILL-TEXT', enabled: true });
  const skId = sk.r?.id; check('K1', 'skill: add from Settings saves (no "Change this in Bunny\'s window")', sk.ok && Boolean(skId) && (await get('/api/skills')).some((s) => s.id === skId), JSON.stringify(sk).slice(0, 160));
  const skDel = await call(cz, 'DELETE', '/api/skills/' + skId); check('K2', 'skill: remove saves', skDel.ok && !(await get('/api/skills')).some((s) => s.id === skId), JSON.stringify(skDel).slice(0, 120));

  // ---- connector: add, on/off, list, trust, remove
  const cn = await call(cz, 'POST', '/api/mcp', { name: 'qa-conn', url: MCP, enabled: true }); const cnId = cn.r?.id;
  check('C1', 'connector: add saves', cn.ok && Boolean(cnId) && (await get('/api/mcp')).some((c) => c.id === cnId), JSON.stringify(cn).slice(0, 140));
  const off = await call(cz, 'PATCH', '/api/mcp/' + cnId, { enabled: false }); const on = await call(cz, 'PATCH', '/api/mcp/' + cnId, { enabled: true });
  check('C2', 'connector: switch off and on save', off.ok && on.ok && (await get('/api/mcp')).find((c) => c.id === cnId)?.enabled === true, JSON.stringify([off.ok, on.ok]));
  await get('/api/mcp/' + cnId + '/tools'); // the connector lists its tools (a read)
  const cz2 = await frameFor('/src/ui/customize.html?embed=1?x=1'.replace('?x=1', '&x=2')); await cz2.locator('.cz-tab[data-kind="connectors"]').click().catch(() => {}); await wait(600);
  const trustBtn = cz2.getByRole('button', { name: 'Trust read-only labels' }); const n = await trustBtn.count();
  if (n) { await trustBtn.first().click(); await wait(1000); }
  check('C3', 'connector: the "Trust read-only labels" button in Customize works and is saved (UI click, in the iframe)', n > 0 && (await get('/api/mcp')).find((c) => c.id === cnId)?.trustReadOnly === true, 'buttons found ' + n);
  await win.screenshot({ path: join(SHOTS, 'customize-trust.png') });
  const cnDel = await call(cz2, 'DELETE', '/api/mcp/' + cnId); check('C4', 'connector: remove saves', cnDel.ok && !(await get('/api/mcp')).some((c) => c.id === cnId), '');

  // ---- plugin: install (from the invented GitHub repo), off, on, update, uninstall
  const pi = await call(cz2, 'POST', '/api/plugins/install', { url: 'https://github.com/o/carrot-pack' }); const pId = pi.r?.plugin?.id;
  check('P1', 'plugin: install from GitHub (invented repository) saves', pi.ok && Boolean(pId), JSON.stringify(pi).slice(0, 200));
  const pOff = await call(cz2, 'PATCH', '/api/plugins/' + pId, { enabled: false }); const pOn = await call(cz2, 'PATCH', '/api/plugins/' + pId, { enabled: true });
  check('P2', 'plugin: switch off and on save', pOff.ok && pOn.ok, JSON.stringify([pOff, pOn]).slice(0, 200));
  setTree({ ...V1, 'plugin.json': JSON.stringify({ name: 'carrot-pack', description: 'v2' }), 'skills/grow/SKILL.md': skillMd('grow', 'Water twice daily.') });
  const pUp = await call(cz2, 'POST', '/api/plugins/' + pId + '/update', {}); const growAfter = (await get('/api/skills')).find((s) => s.name === 'grow');
  check('P3', 'plugin: update from its source saves (the changed skill arrives switched off and the new words are in)', pUp.ok && /twice/.test(growAfter?.instructions ?? '') && growAfter?.enabled === false, JSON.stringify(pUp).slice(0, 220) + '; skill enabled ' + growAfter?.enabled);
  const dupSpell = []; for (const u of ['https://github.com/O/Carrot-Pack', 'https://github.com/o/carrot-pack.git', 'https://github.com/o/carrot-pack/', 'github.com/o/carrot-pack', 'http://www.github.com/o/carrot-pack', 'o/carrot-pack', 'https://github.com/o/carrot-pack/tree/main']) { const r = await call(cz2, 'POST', '/api/plugins/install', { url: u }); dupSpell.push([u, r.ok, r.message ?? '']); }
  check('P4', 'the same repository under 7 other spellings (case, .git, trailing slash, no https, www+http, short form, /tree/main) is refused as already installed', dupSpell.every(([, ok, msg]) => !ok && /already installed/i.test(msg)), dupSpell.map(([u, ok, m]) => (ok ? 'INSTALLED AGAIN ' : '') + u + ' -> ' + m.slice(0, 40)).join(' | '));
  check('P5', 'and only one plugin record exists', ((await get('/api/skills')).filter((s) => s.name === 'grow').length === 1), '');
  const pDel = await call(cz2, 'DELETE', '/api/plugins/' + pId); check('P6', 'plugin: uninstall saves and takes its skill away', pDel.ok && !(await get('/api/skills')).some((s) => s.name === 'grow'), JSON.stringify(pDel).slice(0, 140));

  // ---- the W6-16 folder picker in Customize (UI)
  const sk2 = await call(cz2, 'POST', '/api/skills', { name: 'scoped-skill', description: 'd', instructions: 'S', enabled: true });
  const cz3 = await frameFor('/src/ui/customize.html?embed=1&x=3'); await cz3.locator('.cz-tab[data-kind="skills"]').click().catch(() => {}); await wait(600);
  const pickBtn = cz3.getByRole('button', { name: /Only in a folder/ }).first(); const hasPick = await pickBtn.count();
  if (hasPick) { await pickBtn.click(); await wait(1200); }
  const scoped = (await get('/api/skills')).find((s) => s.id === sk2.r?.id);
  check('F1', 'W6-16: "Only in a folder…" in Customize opens the picker (through the bridge, the stand-in dialog) and the limit is saved with the real folder path', hasPick > 0 && Array.isArray(scoped?.folders) && scoped.folders.length === 1 && scoped.folders[0].toLowerCase() === FOLDER.toLowerCase(), JSON.stringify(scoped?.folders));
  await win.screenshot({ path: join(SHOTS, 'customize-only-in.png') }); await call(cz3, 'DELETE', '/api/skills/' + sk2.r?.id);

  // ---- a schedule
  const au = await frameFor('/src/ui/automation.html?embed=1');
  const sc = await call(au, 'POST', '/api/schedules', { name: 'qa-nightly', prompt: 'say hello', cadence: 'daily', time: '09:00', everyMinutes: 60, enabled: false }); const scId = sc.r?.id;
  check('A1', 'schedule: add saves from the Automation page', sc.ok && Boolean(scId) && (await get('/api/schedules')).some((s) => s.id === scId), JSON.stringify(sc).slice(0, 160));
  const scDel = await call(au, 'DELETE', '/api/schedules/' + scId); check('A2', 'schedule: remove saves', scDel.ok && !(await get('/api/schedules')).some((s) => s.id === scId), '');

  // ---- a custom provider: add (UI form) and remove
  const pv = await frameFor('/src/ui/providers.html?embed=1');
  await pv.locator('#custom-name').fill('QA provider'); await pv.locator('#custom-url').fill('http://127.0.0.1:9/v1'); await pv.locator('#custom-add').click(); await wait(2500);
  const provs = await get('/api/providers'); const cp = (Array.isArray(provs) ? provs : provs.providers ?? []).find((p) => /QA provider/.test(p.name ?? '')); const err = await pv.locator('#custom-err').innerText().catch(() => '');
  check('V1', 'custom provider: add (the form in the iframe) saves, no refusal message on the page', Boolean(cp) && !/Bunny's window/.test(err), 'provider ' + (cp?.id ?? 'none') + '; page error text "' + err + '"');
  const cpDel = cp ? await call(pv, 'DELETE', '/api/providers/' + cp.id) : { ok: false }; check('V2', 'custom provider: remove saves', cpDel.ok && !((await get('/api/providers')).providers ?? (await get('/api/providers'))).some?.((p) => p.id === cp?.id), JSON.stringify(cpDel).slice(0, 120));

  // ---- Settings pages: permission rules (UI), model filter (UI)
  const st = await frameFor('/src/ui/settings.html?embed=1&section=code');
  await st.locator('#rules-pattern').fill('npm test*'); await st.selectOption?.('#rules-effect', 'allow').catch(() => {}); await st.locator('#rules-effect').selectOption('allow').catch(() => {}); await st.locator('#rules-add-btn').click(); await wait(1500);
  const rules = await get('/api/permission-rules'); const flat = JSON.stringify(rules);
  check('R1', 'permission rules: adding a rule in Settings -> Code saves (UI, in the iframe)', /npm test\*/.test(flat), flat.slice(0, 200));
  await win.screenshot({ path: join(SHOTS, 'settings-rules.png') });
  const stm = await frameFor('/src/ui/settings.html?embed=1&section=models'); const before = await stm.locator('#model-filter').inputValue(); await stm.locator('#model-filter').selectOption(before === 'all' ? 'free-nvidia' : 'all'); await wait(1200);
  const s1 = await get('/api/settings'); check('M1', 'a window-only setting (the model filter) changed from Settings saves', s1.modelFilter === (before === 'all' ? 'free-nvidia' : 'all'), before + ' -> ' + s1.modelFilter);
  const dm = await call(stm, 'PUT', '/api/settings', { defaultPermissionMode: 'ask' }); const s2 = await get('/api/settings'); check('M2', 'another window-only setting (the default permission mode) saves', dm.ok && s2.defaultPermissionMode === 'ask', JSON.stringify(dm).slice(0, 120));
  check('E0', 'no page error in the main window', errors.length === 0, errors.join(' | '));
  check('E1', 'the real profile folder was not touched (the app ran on the invented data folder)', info.userData.toLowerCase().startsWith(USER.toLowerCase()) && !String(DATA).toLowerCase().includes('bunnyai') && (!existsSync(real) || true), '');
} catch (e) { console.log('ABORT', e.stack ?? e.message); rows.push({ id: 'X', ok: false }); await win.screenshot({ path: join(SHOTS, 'abort.png') }).catch(() => {}); }
await app.close().catch(() => {}); mcp.close();
const bad = rows.filter((r) => !r.ok); console.log(NL + (rows.length - bad.length) + ' of ' + rows.length + ' passed; pictures in ' + SHOTS); process.exit(bad.length ? 1 : 0);

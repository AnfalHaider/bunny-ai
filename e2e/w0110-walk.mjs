/**
 * QA, release-0.1.10 walk (candidate 9d4e942), rows 3-9 of the Chief's list that run without the real window; real-Electron rows are run separately
 * (e2e/w110-bridge.mjs for settings-bridge, test/probes/*-smoke.cjs for artifact Open, the Quick Ask bar and the remote page).
 * One in-process Bunny (createApp) on an INVENTED profile: guard on, folderPickerOnly (the desktop build's lock), lanAddress 127.0.0.2 (no firewall prompt),
 * a scripted OpenAI-compatible model on a local port. Chromium plays the browser tab on this PC and the other device, desktop and phone, light and dark.
 *   node e2e/w0110-walk.mjs
 * Never touches %LOCALAPPDATA%\BunnyAI.
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0110-data-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w0110-folder-'));
const OUT = join(DATA, 'shots'); mkdirSync(OUT, { recursive: true });
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SENTENCE = "Change this in Bunny's window.";
const PASS = 'qa passcode for the walk 0110';

// ---- a scripted model ----
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
    const body = JSON.parse(raw);
    const last = [...body.messages].reverse().find((m) => m.role === 'user');
    const said = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content);
    const told = [...body.messages].reverse().find((m) => m.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const call = /WRITE/.test(said) ? { name: 'write_file', arguments: JSON.stringify({ path: 'note.txt', content: 'hello from a device' }) } : null;
    const delta = told || !call ? { content: 'got: ' + String(told?.content ?? 'plain answer').slice(0, 160) } : { tool_calls: [{ index: 0, id: 'c1', function: call }] };
    res.end('data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\ndata: [DONE]\n\n');
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));

const bunny = await createApp({ dataDir: DATA, fake: false, secretStore: memorySecretStore(), probe: async () => ({ ok: true, keyVerified: true }), discover: async () => [{ id: 'gpt-4o', displayName: 'GPT 4o', ownedBy: 'x', contextLength: null }], localGuard: true, folderPickerOnly: true, lanAddress: '127.0.0.2' });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${bunny.server.address().port}`;
const admin = (path, init = {}) => bunny.adminFetch(path, { ...init, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
const adminJson = async (path, method = 'GET', body) => { const r = await admin(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ } return { status: r.status, json: j, text }; };
await adminJson('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
await bunny.chooseFolder(FOLDER);
const real = join(process.env.LOCALAPPDATA ?? '', 'BunnyAI');
let browser;
const finish = async (code) => { try { await browser?.close(); } catch { /* x */ } try { await adminJson('/api/remote', 'PUT', { enabled: false }); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; pictures in ${OUT}`); process.exit(code ?? (bad.length ? 1 : 0)); };

try {
  browser = await chromium.launch();
  const MODELS = [
    { providerId: 'harbor', providerName: 'Harbor', id: 'falcon-flash', displayName: 'Falcon Flash', freeKind: 'free', free: true, contextLength: 128000 },
    { providerId: 'quill', providerName: 'Quill', id: 'otter-3-coder', displayName: 'Otter 3 Coder', freeKind: null, free: false, contextLength: 128000 },
  ];
  const mf = await adminJson('/api/settings', 'PUT', { modelFilter: 'all' }); console.log('INFO  modelFilter all ->', mf.status);

  // ========== 4. the model chip, desktop and phone, light and dark ==========
  for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 780 }]]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: size, colorScheme: scheme }); const page = await ctx.newPage();
      await page.route('**/api/models*', (route) => route.fulfill({ json: MODELS }));
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(local + '/'); await page.waitForTimeout(700);
      const chip = page.locator('#picker-button'); const inRow = await chip.evaluate((el) => !!el.closest('.composer-row'));
      const [c, s] = await Promise.all([chip.boundingBox(), page.locator('#send').boundingBox()]);
      check(`4a ${label}/${scheme}`, 'the model chip is in the button row, left of Send', inRow && c.x + c.width <= s.x + 1, JSON.stringify({ c, s }));
      await chip.click(); await page.waitForTimeout(300);
      const panel = page.locator('.picker-panel'); const p = await panel.boundingBox();
      const up = p.y + p.height <= c.y + 1; const sheet = Math.round(p.x) === 0 && Math.round(p.width) === size.width && await page.locator('.picker-scrim').isVisible();
      check(`4b ${label}/${scheme}`, label === 'desktop' ? 'the selector opens UPWARD above the chip, inside the window' : 'on a phone the selector is a full-width bottom sheet with a scrim', label === 'desktop' ? up && p.x >= 0 && p.x + p.width <= size.width : sheet && p.y + p.height <= size.height + 1, JSON.stringify(p));
      await page.screenshot({ path: join(OUT, `chip-${label}-${scheme}.png`) });
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
      check(`4c ${label}/${scheme}`, 'Esc closes it and the chip has the focus', (await panel.count()) === 0 && await chip.evaluate((el) => document.activeElement === el));
      check(`4d ${label}/${scheme}`, 'no page error', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }

  // ========== 5. Open in your browser (this PC): locked controls and cards ==========
  for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 780 }]]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: size, colorScheme: scheme }); const page = await ctx.newPage();
      const errors = []; page.on('pageerror', (e) => errors.push(e.message));
      const health = await (await fetch(local + '/api/health')).json();
      await page.goto(local + '/src/ui/settings.html?embed=1&section=code'); await page.waitForTimeout(800);
      const mode = page.locator('#default-permission');
      const st = await mode.evaluate((el) => ({ disabled: el.disabled, title: el.title, op: getComputedStyle(el).opacity, note: el.nextElementSibling?.className + ':' + el.nextElementSibling?.textContent }));
      check(`5a ${label}/${scheme}`, 'Settings → Code in a browser: the default-mode control is off, greyed, titled and says the sentence beside it', health.windowOnlyLock && st.disabled && st.title === SENTENCE && st.op === '0.5' && st.note.includes(SENTENCE), JSON.stringify(st));
      const ruleControls = await page.locator('#perm-rules').locator('input, select, textarea, button').evaluateAll((els) => els.map((e) => ({ on: !e.disabled, id: e.id || e.className || e.textContent.slice(0, 20), cur: e.value ?? '' })));
      check(`5b ${label}/${scheme}`, 'every Permission-rules control is natively disabled (a person cannot type or press them)', ruleControls.length > 0 && ruleControls.every((c) => !c.on), JSON.stringify(ruleControls.filter((c) => c.on)));
      if (label === 'desktop' && scheme === 'light') {
        const reqs = []; page.on('request', (r) => { if (r.method() !== 'GET') reqs.push(r.method() + ' ' + new URL(r.url()).pathname); });
        await page.evaluate(() => { const i = document.getElementById('rules-pattern'); i.focus(); }); await page.keyboard.type('npm test*'); const typed = await page.evaluate(() => document.getElementById('rules-pattern').value);
        await page.evaluate(() => document.getElementById('rules-add-btn').click()); await page.waitForTimeout(900);
        const rulesNow = (await adminJson('/api/permission-rules').catch(() => ({ text: '' }))).text; const errLine = await page.locator('#perm-rules').innerText();
        await page.screenshot({ path: join(OUT, 'lock-rules-add-attempt.png') });
        console.log('INFO  5b2 a person types into the (aria-disabled only) pattern box: typed=' + JSON.stringify(typed) + '; writes sent: ' + JSON.stringify(reqs) + '; rules saved: ' + rulesNow.slice(0, 120) + '; line: ' + errLine.slice(-120).replace(/s+/g, ' '));
        check('5b2', 'whatever is typed, no rule is saved from the tab (the server refuses the write)', !/npm test/.test(rulesNow), rulesNow.slice(0, 160));
      }
      await page.screenshot({ path: join(OUT, `lock-settings-${label}-${scheme}.png`) });
      for (const u of ['customize', 'providers', 'automation']) {
        await page.goto(local + `/src/ui/${u}.html?embed=1`); await page.waitForTimeout(700);
        const live = await page.locator('main button:not([role="tab"]):not([data-scope]):not([data-kind]), main input:not([type="search"]):not(#cz-search), main select').evaluateAll((els) => els.filter((e) => !e.disabled).map((e) => (e.id || e.textContent || e.tagName).slice(0, 30)));
        check(`5c ${label}/${scheme} ${u}`, 'everything that changes something is off', live.length === 0, live.join(','));
      }
      await page.goto(local + '/'); await page.waitForTimeout(700);
      const modeBtn = await page.locator('#mode-button').isDisabled(); const note = await page.locator('.window-only-note').first().textContent().catch(() => null);
      check(`5d ${label}/${scheme}`, 'main page: the chat-mode control is off and the note is the short "Window only"', modeBtn && note === 'Window only', String(note));
      // a real write from the page's own code is refused with the sentence
      const refused = await page.evaluate(async () => { const r = await fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-bunny-token': document.querySelector('meta[name="bunny-token"]')?.content ?? '' }, body: JSON.stringify({ permissionRules: {} }) }); return { status: r.status, body: await r.json().catch(() => null) }; });
      check(`5e ${label}/${scheme}`, 'a window-only write from the tab is refused 403 with the sentence', refused.status === 403 && JSON.stringify(refused.body).includes(SENTENCE), JSON.stringify(refused));
      check(`5f ${label}/${scheme}`, 'no page error', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }

  // ========== 6. Other devices ==========
  const on = await adminJson('/api/remote', 'PUT', { enabled: true, passcode: PASS });
  check('6.0', 'turning it on opens a second address on 127.0.0.2 (not the 127.0.0.1 server)', Boolean(on.json?.url) && on.json.url.includes('127.0.0.2') && !on.json.url.startsWith(local), on.text);
  const lanUrl = on.json.url.replace(/\/$/, ''); const lanHost = new URL(lanUrl).host;
  const made = (await adminJson('/api/sessions', 'POST', { title: 'Window chat', workMode: 'code', folder: FOLDER, permissionMode: 'ask', providerId: 'openai', model: 'gpt-4o' })).json;
  const deviceCtx = await browser.newContext({ viewport: { width: 390, height: 780 }, colorScheme: 'light' }); const dev = await deviceCtx.newPage();
  const derr = []; dev.on('pageerror', (e) => derr.push(e.message));
  await dev.goto(lanUrl + '/'); await dev.waitForTimeout(500);
  check('6.1', 'a device sees only the sign-in page, and no API answers before sign-in (401)', (await dev.title()) === 'Sign in to Bunny AI' && (await dev.evaluate(() => fetch('/api/sessions').then((r) => r.status))) === 401);
  await dev.screenshot({ path: join(OUT, 'device-signin-phone.png') });
  await dev.fill('#passcode', 'not the passcode at all'); await dev.locator('#form').evaluate((f) => f.requestSubmit()); await dev.waitForTimeout(900);
  check('6.2', 'a wrong passcode says so on the page and nothing else is shown', /not right/.test(await dev.locator('#msg').textContent()) && (await dev.title()) === 'Sign in to Bunny AI', await dev.locator('#msg').textContent());
  await dev.fill('#passcode', PASS); await Promise.all([dev.waitForURL(/index\.html/, { timeout: 8000 }).catch(() => {}), dev.locator('#form').evaluate((f) => f.requestSubmit())]); await dev.waitForTimeout(1500);
  const pg = await dev.evaluate(() => ({ path: location.pathname, bridge: typeof window.bunnyDesktop, launch: !!document.querySelector('meta[name="bunny-token"]'), csrf: (document.querySelector('meta[name="bunny-csrf"]')?.content ?? '').length, cookie: document.cookie }));
  check('6.3', 'the right passcode signs in: app page, no desktop bridge, no launch token, cookie hidden from the page', pg.path === '/src/ui/index.html' && pg.bridge === 'undefined' && !pg.launch && pg.csrf === 48 && !/bunny_remote/.test(pg.cookie), JSON.stringify(pg));
  // a device chat runs a tool and answers its card, in the real page
  await dev.goto(lanUrl + '/?s=' + made.id); await dev.waitForTimeout(1200);
  await dev.screenshot({ path: join(OUT, 'device-chat-phone.png') });
  const chipText = await dev.locator('#picker-button').textContent();
  console.log('INFO  6.3b the device chip for a chat whose model is set in the window shows: ' + JSON.stringify(chipText));
  // the device sets its chat's permission mode in the real page (menu), and the server has it
  const modeOf = async () => (await adminJson('/api/sessions/' + made.id)).json?.permissionMode;
  await dev.locator('#mode-menu').evaluate((el) => el.hidden).catch(() => {});
  await dev.locator('#mode-button').click(); await dev.waitForTimeout(300);
  const items = await dev.locator('#mode-menu [role="menuitem"], #mode-menu button').allInnerTexts();
  const plan = dev.locator('#mode-menu').getByText(/Plan/).first(); if (await plan.count()) await plan.click(); await dev.waitForTimeout(900);
  const afterPlan = await modeOf(); const errAfter = await dev.locator('#error').innerText().catch(() => '');
  check('6.4d', 'a device sets its chat to Plan mode from the menu in the real page: the server has it and no refusal sentence is shown', afterPlan === 'plan' && !errAfter.includes(SENTENCE), 'server: ' + afterPlan + '; menu: ' + items.join('/').slice(0, 80) + '; error: ' + errAfter.slice(0, 60));
  await dev.locator('#mode-button').click(); await dev.waitForTimeout(300);
  const ask = dev.locator('#mode-menu').getByText(/Manual/).first(); if (await ask.count()) await ask.click(); await dev.waitForTimeout(900);
  check('6.4e', 'and back to Ask each time', (await modeOf()) === 'ask', String(await modeOf()));
  await dev.fill('#input', 'please WRITE a note'); await dev.locator('#send').click();
  const allow = dev.locator('.permission-prompt button', { hasText: /^Allow/ }).first();
  await allow.waitFor({ timeout: 15000 }).catch(() => {});
  const cardShown = await allow.count();
  check('6.4', "the window's chat, opened on the device, shows its permission card on the device", cardShown > 0);
  await dev.screenshot({ path: join(OUT, 'device-card-phone.png') });
  console.log('INFO  6.4 device page state: ' + JSON.stringify(await dev.evaluate(() => ({ url: location.href, csrfMeta: !!document.querySelector('meta[name="bunny-csrf"]'), tokenMeta: !!document.querySelector('meta[name="bunny-token"]'), card: document.querySelector('.permission-prompt')?.outerHTML.slice(0, 700) }))));
  const probeId = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
  const direct = await dev.evaluate(async ([sid, pid]) => { const r = await fetch('/api/sessions/' + sid + '/permission/' + pid, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bunny-csrf': document.querySelector('meta[name="bunny-csrf"]').content }, body: JSON.stringify({ allowed: true }) }); return r.status; }, [made.id, probeId]);
  check('6.4b', 'the SERVER accepts a device answering a permission card (an unknown card id gives 404, not the 403 window sentence)', direct === 404, String(direct));
  const viaPage = await dev.evaluate(async ([sid, pid]) => { const sent = []; const f = window.fetch; window.fetch = (...a) => { sent.push(String(a[0])); return f(...a); }; const api = await import('/src/ui/api.js'); try { await api.sendJSON('/api/sessions/' + sid + '/permission/' + pid, 'POST', { allowed: true }); return { threw: false, sent }; } catch (e) { return { threw: true, code: e.code ?? null, msg: e.message, sent: sent.filter((x) => x.includes('/permission/')) }; } }, [made.id, probeId]);
  check('6.4c', "the PAGE's own sendJSON lets a device answer a permission card (it must send the request, not refuse it itself)", viaPage.threw === false || viaPage.sent.length > 0, JSON.stringify(viaPage));
  const devLog = []; dev.on('response', async (r) => { if (r.request().method() !== 'GET') devLog.push(r.request().method() + ' ' + new URL(r.url()).pathname + ' ' + r.status() + (r.status() >= 400 ? ' ' + (await r.text().catch(() => '')).slice(0, 120) : '')); });
  if (cardShown) await allow.click();
  for (let i = 0; i < 40 && !existsSync(join(FOLDER, 'note.txt')); i += 1) await wait(300);
  await wait(1500); console.log('INFO  6.5 the device writes after pressing Allow: ' + JSON.stringify(devLog));
  check('6.5', 'after the device pressed Allow the file was really written on this computer', existsSync(join(FOLDER, 'note.txt')) && readFileSync(join(FOLDER, 'note.txt'), 'utf8') === 'hello from a device');
  await dev.waitForTimeout(1200);
  check('6.6', 'and the model answered on the device', /got: /.test(await dev.locator('#messages').innerText()), (await dev.locator('#messages').innerText()).slice(-120));
  // a device cannot change settings
  const cookies = await deviceCtx.cookies(); const cookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const csrf = await dev.evaluate(() => document.querySelector('meta[name="bunny-csrf"]').content);
  const dh = { host: lanHost, origin: 'http://' + lanHost, cookie, 'x-bunny-csrf': csrf, 'content-type': 'application/json' };
  const dput = async (path, method, body) => { const r = await fetch(lanUrl + path, { method, headers: dh, body: JSON.stringify(body) }); return { status: r.status, text: await r.text() }; };
  for (const [m, p, b] of [['PUT', '/api/settings', { permissionRules: {} }], ['PUT', '/api/remote', { enabled: false }], ['POST', '/api/skills', { name: 'x', description: 'd', instructions: 'i' }], ['POST', '/api/connectors', { name: 'x', url: 'http://127.0.0.1:1/mcp' }]]) {
    const r = await dput(p, m, b); check(`6.7 ${m} ${p}`, 'a device cannot change it (refused, with the window sentence)', r.status === 403 && r.text.includes(SENTENCE), `${r.status} ${r.text.slice(0, 100)}`);
  }
  // the window's view: device list, status line, Sign out
  const st = (await adminJson('/api/remote')).json;
  check('6.8', 'the window sees one signed-in device with its address and time, and no secret in the list', st.signedIn === 1 && st.devices.length === 1 && st.devices[0].ip && !JSON.stringify(st).includes(PASS), JSON.stringify(st.devices));
  const ctxW = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const wp = await ctxW.newPage();
  // a stand-in for the window's bridge: window-only writes go to the main-process stand-in (adminFetch), exactly what secure:write does
  await wp.exposeFunction('__qaSecureWrite', async (m, p, b) => { const r = await adminJson(p, m, b); return r.json ?? {}; });
  await wp.addInitScript(() => { window.bunnyDesktop = { platform: 'win32', getPrefs: async () => ({}), setPrefs: async () => ({}), secureWrite: (m, p, b) => window.__qaSecureWrite(m, p, b), updates: { get: async () => null, check: async () => null, install: async () => null, onStatus: () => () => {} }, quickAsk: { take: async () => null, onNewChat: () => () => {} }, zoom: { get: () => 1, set: () => {} } }; });
  await wp.goto(local + '/src/ui/settings.html?embed=1&section=desktop'); await wp.waitForTimeout(1500);
  const statusText = await wp.locator('#remote-status').textContent().catch(() => null);
  check('6.9', 'the status line in Settings says "Open to other devices · 1 signed in"', /Open to other devices · 1 signed in/.test(statusText ?? ''), statusText);
  await wp.screenshot({ path: join(OUT, 'remote-status-desktop.png') });
  const listed = await wp.locator('#remote-devices').innerText().catch(() => '');
  check('6.10', 'the device list shows this device (name, address, when) and a Sign out button', /Chrome/.test(listed) && (await wp.locator('#remote-devices').getByRole('button', { name: /Sign out/i }).count()) > 0, listed.slice(0, 160));
  await wp.locator('#remote-devices').getByRole('button', { name: /^Sign out$/i }).first().click().catch(() => {}); await wp.waitForTimeout(900);
  const after = await dev.evaluate(() => fetch('/api/sessions').then((r) => r.status)).catch((e) => String(e));
  check('6.11', 'Sign out ends that device at once (its next request is 401)', after === 401, String(after));
  await ctxW.close(); await deviceCtx.close();
  // lockout: a fresh device, five wrong then the right one must wait
  const lctx = await browser.newContext({ viewport: { width: 390, height: 780 } }); const lp = await lctx.newPage();
  await lp.goto(lanUrl + '/'); const wrongs = [];
  for (let i = 0; i < 6; i += 1) { await lp.fill('#passcode', 'wrong passcode ' + i + ' xxxxxxx'); await lp.locator('#form').evaluate((f) => f.requestSubmit()); await lp.waitForTimeout(700); wrongs.push(await lp.locator('#msg').textContent()); }
  await lp.fill('#passcode', PASS); await lp.locator('#form').evaluate((f) => f.requestSubmit()); await lp.waitForTimeout(900);
  const waitMsg = await lp.locator('#msg').textContent();
  check('6.12', 'five wrong passcodes in a row: the page asks the device to wait (even for the right one) and says for how long', /wait/i.test(waitMsg) && (await lp.title()) === 'Sign in to Bunny AI', `${wrongs.map((w) => w.slice(0, 30)).join(' | ')} || ${waitMsg}`);
  await lp.screenshot({ path: join(OUT, 'device-wait-phone.png') });
  check('6.13', 'no page error on the device pages', derr.length === 0, derr.join(' | '));
  await lctx.close();
  await adminJson('/api/remote', 'PUT', { enabled: false });
  check('6.14', 'turning it off closes the 127.0.0.2 address', await fetch(lanUrl + '/').then(() => false).catch(() => true));

  // ========== 7. W2-9 Working folder card ==========
  const repo = mkdtempSync(join(tmpdir(), 'bunny-w0110-repo-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
  const git = (...a) => execFileSync('git', a, { cwd: repo, env, encoding: 'utf8', windowsHide: true }).trim();
  git('init', '-q', '-b', 'main'); git('config', 'core.autocrlf', 'false'); writeFileSync(join(repo, 'a.txt'), 'a\n'); git('add', '-A'); git('commit', '-q', '-m', 'first');
  await bunny.chooseFolder(repo);
  const wsess = (await adminJson('/api/sessions', 'POST', { title: 'Tidy the greeter', folder: repo })).json;
  // (the own-copy switch itself is walked in the REAL window: e2e/w0110-electron.mjs 7a-7c.) In a browser tab it is a window-only change and must say so, and make nothing.
  for (const [label, size] of [['desktop', { width: 1280, height: 800 }], ['phone', { width: 390, height: 780 }]]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: size, colorScheme: scheme }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
      await page.addInitScript(() => localStorage.setItem('bunny.workMode', 'code'));
      await page.goto(local + '/'); await page.waitForTimeout(800); if (label === 'phone') await page.locator('#sidebar-toggle').click().catch(() => {});
      await page.getByText('Tidy the greeter').first().click(); await page.waitForTimeout(900);
      await page.locator('#folder-chip').click(); await page.waitForTimeout(500);
      const card = page.getByRole('dialog', { name: 'Working folder' }); const box = await card.boundingBox().catch(() => null);
      await card.getByLabel('Give this chat its own copy of the project').click().catch(() => {}); await page.waitForTimeout(1500);
      const text = await card.innerText().catch(() => ''); const made2 = (await adminJson('/api/sessions/' + wsess.id)).json;
      check(`7d ${label}/${scheme}`, 'in a browser tab the Working folder card opens and fits; pressing its switch says the window sentence and makes no copy', Boolean(box) && box.x >= 0 && box.x + box.width <= size.width && text.includes(SENTENCE) && !made2.worktree && text.includes(repo.split(String.fromCharCode(92)).pop()), JSON.stringify(box) + ' ' + text.slice(0, 80));
      await page.screenshot({ path: join(OUT, `w29-card-tab-${label}-${scheme}.png` ) });
      check(`7e ${label}/${scheme}`, 'no page error', errs.length === 0, errs.join(' | '));
      await ctx.close();
    }
  }
  check('Z', 'the real profile folder was not the one used', !DATA.startsWith(real));
} catch (err) { console.log('WALK CRASHED: ' + (err?.stack ?? err)); await finish(2); }
await finish();

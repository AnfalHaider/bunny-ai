/**
 * QA, W3-6b (connector status as a coloured word with a dim line, in Customize and Automation) and W4-7 (right-click menu template).
 * Invented profile only: a spawned server with BUNNY_DATA_DIR temp and BUNNY_FAKE_UPSTREAM=1; the connector list is answered by the walk
 * (page routes) with invented connectors. Electron is never started: W4-7 is the menu template and the main-process wiring text.
 *   node e2e/w36b-w47-walk.mjs      (screenshots go to $SHOTS or the temp folder)
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { connectorStatus, SIGN_IN_EXPIRED, KEY_REFUSED } = await imp('src/ui/connectorStatus.js');
const { buildContextMenuTemplate } = await imp('electron/context-menu.js');
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 230) : ''}`); };

// ---------------- W3-6b: the words, from the pure function
const srv = (extra = {}) => ({ id: 'c1', name: 'Pet Notes', type: 'remote', url: 'https://notes.example.invalid/mcp', enabled: true, status: 'connected', tools: [{}, {}, {}], ...extra });
const cases = [
  ['connected, 3 tools', srv(), null, '✓ 3 tools', 'ok'],
  ['connected, no tools', srv({ tools: [] }), null, '✓ 0 tools', 'ok'],
  ['switched off', srv({ enabled: false }), null, 'Off', ''],
  ['signed in', srv({ oauth: { signedIn: true, account: 'bunny@example.invalid' } }), null, 'Signed in', 'ok'],
  ['signed in, no account name', srv({ oauth: { signedIn: true } }), null, 'Signed in', 'ok'],
  ['needs sign-in', srv({ status: 'needsSignIn', oauth: { signedIn: false } }), null, 'Needs sign-in', 'warn'],
  ['sign-in expired', srv({ status: 'needsSignIn', lastError: SIGN_IN_EXPIRED, oauth: { signedIn: false } }), null, 'Sign-in expired', 'warn'],
  ['waiting for the browser', srv({ status: 'needsSignIn' }), { phase: 'waiting' }, 'Waiting for your browser', 'warn'],
  ['sign-in cancelled', srv({ status: 'needsSignIn' }), { phase: 'error', message: 'Sign-in cancelled.' }, 'Sign-in cancelled', 'warn'],
  ['sign-in failed', srv({ status: 'needsSignIn' }), { phase: 'error', message: 'The service said no.' }, 'Sign-in failed', 'bad'],
  ['needs a client ID', srv({ status: 'needsSignIn' }), { phase: 'needsClientId', message: 'x' }, 'Needs a client ID', 'warn'],
  ['key refused', srv({ status: 'error', lastError: KEY_REFUSED }), null, 'Key refused', 'bad'],
  ['other error', srv({ status: 'error', lastError: 'Could not reach it.' }), null, 'Error', 'bad'],
  ['never checked', srv({ status: undefined }), null, 'Not checked', ''],
];
for (const [label, server, flow, word, tone] of cases) {
  const s = connectorStatus(server, flow);
  check(`W36 ${label}`, `${label}: the word is "${word}" (${tone || 'plain'})`, s.word === word && s.tone === tone, JSON.stringify({ word: s.word, tone: s.tone, detail: s.detail }));
}
check('W36 expired beats needs', 'an expired sign-in says "Sign-in expired" and offers "Sign in again"', connectorStatus(srv({ status: 'needsSignIn', lastError: SIGN_IN_EXPIRED }), null).signInLabel === 'Sign in again');
check('W36 signed in wins', 'a signed-in connector never shows a needs-sign-in word, even when the stored status still says needsSignIn', connectorStatus(srv({ status: 'needsSignIn', oauth: { signedIn: true, account: 'a' } }), null).word === 'Signed in');
check('W36 weird url', 'a connector with a missing or odd address does not crash the status', ['', 'not a url', undefined].every((url) => connectorStatus(srv({ url, status: 'needsSignIn' }), null).word === 'Needs sign-in'));
check('W36 no secret', 'no word or line carries a token, key or query string (the detail shows the host only)', !/token|secret|\?/.test(connectorStatus(srv({ url: 'https://notes.example.invalid/mcp?token=abc123', status: 'needsSignIn' }), null).detail), connectorStatus(srv({ url: 'https://notes.example.invalid/mcp?token=abc123', status: 'needsSignIn' }), null).detail);

// ---------------- W3-6b: on screen (Customize and Automation)
const free = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const PORT = await free(); const TOKEN = randomBytes(16).toString('hex');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w36b-'));
const SHOTS = process.env.SHOTS || join(DATA, 'shots'); mkdirSync(SHOTS, { recursive: true });
const server = spawn(process.execPath, ['src/server/main.js'], { env: { ...process.env, BUNNY_DATA_DIR: DATA, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/api/settings', { headers: { 'x-bunny-token': TOKEN } })).status < 500) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 100)); }
const LIST = [
  srv({ id: '11111111-1111-4111-8111-111111111111', name: 'Pet Notes', status: 'connected', tools: [{}, {}, {}], oauth: undefined }),
  srv({ id: '22222222-2222-4222-8222-222222222222', name: 'Carrot Calendar', url: 'https://calendar.example.invalid/mcp', status: 'needsSignIn' }),
  srv({ id: '33333333-3333-4333-8333-333333333333', name: 'Burrow Mail with a rather long name that has to wrap on a phone', url: 'https://mail.example.invalid/mcp', status: 'needsSignIn', lastError: SIGN_IN_EXPIRED }),
  srv({ id: '44444444-4444-4444-8444-444444444444', name: 'Meadow Files', url: 'https://files.example.invalid/mcp', status: 'error', lastError: KEY_REFUSED }),
  srv({ id: '55555555-5555-4555-8555-555555555555', name: 'Clover Docs', url: 'https://docs.example.invalid/mcp', status: 'connected', tools: [{}] }),
  srv({ id: '66666666-6666-4666-8666-666666666666', name: 'Sleepy Server', url: 'https://sleep.example.invalid/mcp', enabled: false, status: 'connected' }),
];
const OAUTH = { '55555555-5555-4555-8555-555555555555': { signedIn: true, account: 'bunny@example.invalid' } };
const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const browser = await chromium.launch();
for (const [page_, url, host] of [['customize', '/src/ui/customize.html?embed=1', '.cz-status'], ['automation', '/src/ui/automation.html?embed=1', '.cz-status']]) {
  for (const [sz, w, h] of [['desktop', 1280, 900], ['phone', 390, 844]]) for (const theme of ['light', 'dark']) {
    const tag = `${page_}/${sz}/${theme}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme, extraHTTPHeaders: { 'x-bunny-token': TOKEN } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/mcp', (route) => (route.request().method() === 'GET' ? route.fulfill({ json: LIST.map(({ oauth, ...s }) => s) }) : route.continue()));
    await page.route('**/api/connectors/*/oauth', (route) => { const id = route.request().url().match(/connectors\/([^/]+)\/oauth/)[1]; route.fulfill({ json: OAUTH[id] ?? { signedIn: false } }); });
    await page.goto(BASE + url);
    await page.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
    if (page_ === 'customize') { await page.locator('.cz-tab[data-kind="connectors"]').click().catch(() => {}); }
    await page.locator(host).first().waitFor({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(600);
    const words = await page.locator(`${host} .cz-status-word`).allTextContents();
    const expected = ['✓ 3 tools', 'Needs sign-in', 'Sign-in expired', 'Key refused', 'Signed in', 'Off'];
    check(`W36s ${tag}`, 'the six invented connectors show their words: ✓ 3 tools, Needs sign-in, Sign-in expired, Key refused, Signed in, Off (page may omit "Off" rows)', expected.filter((e) => e !== 'Off').every((e) => words.some((x) => x.trim() === e)), JSON.stringify(words));
    const details = await page.locator(`${host} .cz-status-detail`).allTextContents();
    check(`W36d ${tag}`, 'the dim lines are there: the host for needs sign-in, "Sign in again to keep using it" for expired, the account for signed in', details.some((d) => /calendar\.example\.invalid/.test(d)) && details.some((d) => /Sign in again to keep using it/.test(d)) && details.some((d) => /bunny@example\.invalid/.test(d)), JSON.stringify(details));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(`W36o ${tag}`, 'no sideways scroll (the long connector name wraps)', overflow);
    const colours = await page.evaluate(() => {
      const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = getComputedStyle(e).backgroundColor; const m = c.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) return parse(c); } return [255, 255, 255]; };
      const out = {};
      for (const el of document.querySelectorAll('.cz-status')) {
        const word = el.querySelector('.cz-status-word'); if (!word) continue;
        const key = word.textContent.trim();
        out[key] = [parse(getComputedStyle(word).color), bgOf(word)];
        const d = el.querySelector('.cz-status-detail'); if (d) out[`${key} (line)`] = [parse(getComputedStyle(d).color), bgOf(d)];
      }
      return out;
    });
    const cr = Object.fromEntries(Object.entries(colours).map(([k, [fg, bg]]) => [k, +ratio(fg, bg).toFixed(2)]));
    const low = Object.entries(cr).filter(([, v]) => v < 4.5);
    check(`W36c ${tag}`, 'every status word and dim line has contrast of at least 4.5:1', Object.keys(cr).length >= 6 && low.length === 0, JSON.stringify(low.length ? low : cr));
    check(`W36e ${tag}`, 'no page error', errors.length === 0, errors.join(' | '));
    await page.screenshot({ path: join(SHOTS, `status-${page_}-${sz}-${theme}.png`), fullPage: false });
    await ctx.close();
  }
}
await browser.close(); server.kill();

// ---------------- W4-7: right-click menu template and its wiring
const flags = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const labels = (t) => t.map((i) => i.label || i.role || i.type);
const cm = (p) => buildContextMenuTemplate({ editFlags: flags, ...p }, {});
check('M1', 'a misspelled word in the message box: up to 5 suggestions, Add to dictionary, then undo, redo, cut, copy, paste, select all', JSON.stringify(labels(cm({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea', 'ten', 'tech', 'tee', 'tel', 'tex'] }))) === JSON.stringify(['the', 'tea', 'ten', 'tech', 'tee', 'Add to dictionary', 'separator', 'undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'selectAll']), JSON.stringify(labels(cm({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea', 'ten', 'tech', 'tee', 'tel', 'tex'] }))));
check('M2', 'no suggestions: a greyed "No suggestions" and Add to dictionary', (() => { const t = cm({ isEditable: true, misspelledWord: 'zzqx', dictionarySuggestions: [] }); return t[0].label === 'No suggestions' && t[0].enabled === false && t[1].label === 'Add to dictionary'; })());
check('M3', 'a plain click in an empty message box: edit items only, with Cut and Copy greyed when nothing is selected', (() => { const t = cm({ isEditable: true, editFlags: { ...flags, canCut: false, canCopy: false } }); return t.find((i) => i.role === 'cut').enabled === false && t.find((i) => i.role === 'copy').enabled === false && t.find((i) => i.role === 'paste').enabled === true && t[0].role === 'undo'; })());
check('M4', 'a link: "Copy link" only', JSON.stringify(labels(cm({ isEditable: false, linkURL: 'https://example.invalid/x' }))) === JSON.stringify(['Copy link']), JSON.stringify(labels(cm({ isEditable: false, linkURL: 'https://example.invalid/x' }))));
check('M5', 'selected text in the chat (not editable): Copy', JSON.stringify(labels(cm({ isEditable: false, selectionText: 'carrots' }))) === JSON.stringify(['copy']));
check('M6', 'a link with selected text: Copy link, a separator, Copy', JSON.stringify(labels(cm({ isEditable: false, linkURL: 'https://example.invalid/x', selectionText: 'x' }))) === JSON.stringify(['Copy link', 'separator', 'copy']), JSON.stringify(labels(cm({ isEditable: false, linkURL: 'https://example.invalid/x', selectionText: 'x' }))));
check('M7', 'blank area of the chat: no menu at all (an empty template is not shown)', cm({ isEditable: false }).length === 0 && cm({ isEditable: false, selectionText: '   ' }).length === 0);
check('M8', 'a misspelled word outside an editable box still offers suggestions then no edit items', (() => { const t = cm({ isEditable: false, misspelledWord: 'teh', dictionarySuggestions: ['the'] }); return labels(t).join() === 'the,Add to dictionary'; })(), JSON.stringify(labels(cm({ isEditable: false, misspelledWord: 'teh', dictionarySuggestions: ['the'] }))));
check('M9', 'missing params do not crash (undefined, empty, null editFlags)', (() => { try { buildContextMenuTemplate(); buildContextMenuTemplate({}); buildContextMenuTemplate({ isEditable: true, editFlags: null }); return true; } catch { return false; } })());
check('M10', 'the actions run: choosing a suggestion replaces the word, Add to dictionary adds that word, Copy link copies the address', (() => { const log = []; const t = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the'], editFlags: flags }, { replaceMisspelling: (w) => log.push(['replace', w]), addToDictionary: (w) => log.push(['add', w]) }); t[0].click(); t[1].click(); const l = buildContextMenuTemplate({ linkURL: 'https://example.invalid/x' }, { copyLink: (u) => log.push(['copy', u]) }); l[0].click(); return JSON.stringify(log) === JSON.stringify([['replace', 'the'], ['add', 'teh'], ['copy', 'https://example.invalid/x']]); })());
check('M11', 'a script or HTML in a misspelled word or link is only text in a label (a label is never HTML in a native menu)', (() => { const t = cm({ isEditable: true, misspelledWord: '<img onerror=x>', dictionarySuggestions: ['<b>x</b>'] }); return t[0].label === '<b>x</b>' && !('html' in t[0]); })());
const main = readFileSync(join(process.cwd(), 'electron', 'main.js'), 'utf8');
check('M12', 'wiring (text only): the menu is attached to every window by guard(), spell check is on in webPreferences, and the dictionary language is set', /function guard\(contents\)\s*\{\s*contextMenu\(contents\)/.test(main) && /spellcheck: true/.test(main) && /setSpellCheckerLanguages\(\['en-US'\]\)/.test(main));
const setting = readFileSync(join(process.cwd(), 'src', 'ui', 'settings.html'), 'utf8');
console.log(`INFO  spell check language is fixed to en-US in electron/main.js; Settings has a Language row for the interface (${/id="language"/.test(setting)}) but no spell check language choice`);
console.log('INFO  the plan row says English with the Windows dictionary, so en-US for every window is as planned; another language is a later wish, not a defect');

const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed; screenshots in ${SHOTS}`);
process.exit(bad.length ? 1 : 0);

/**
 * Q-2 control-by-control audit of the chat shell, on an invented profile.
 *
 *   BASE=http://127.0.0.1:5392 OUT=<temp> node e2e/q2-controls.mjs
 *
 * One row per control: id, what it should do, PASS / FAIL / UNKNOWN with the evidence (console and
 * network errors seen during that check, timing when slow). Writes OUT/controls.json.
 * A scripted model stands in for a provider ("slow" in a message makes it wait 8 s).
 */
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json' };
const rows = [];
let errs = [], bad = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const unknown = (m) => { const e = new Error(m); e.unknown = true; throw e; };
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const row = async (id, name, should, fn) => {
  if (ONLY && !ONLY.test(id)) return;
  errs = []; bad = []; const t = Date.now();
  await page.keyboard.press('Escape').catch(() => {}); await page.locator('#import-cancel:visible').click({ timeout: 500 }).catch(() => {});
  let verdict = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { verdict = e.unknown ? 'UNKNOWN' : 'FAIL'; note = String(e.message).split('\n')[0]; }
  const ms = Date.now() - t;
  if (verdict === 'PASS' && (errs.length || bad.length)) { verdict = 'FAIL'; note = `${note} | errors: ${[...errs, ...bad].join(' ; ')}`.slice(0, 400); }
  else if (errs.length || bad.length) note += ` | errors: ${[...errs, ...bad].join(' ; ')}`.slice(0, 300);
  rows.push({ id, name, should, verdict, note, ms });
  console.log(verdict.padEnd(7), id.padEnd(7), name, '::', String(note).slice(0, 230), ms > 2500 ? `[${ms}ms]` : '');
};

// ---- scripted model ----
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const model = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"data":[{"id":"scripted"}]}'); }
    const asked = String([...JSON.parse(raw).messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const finish = () => res.end(frame({ content: `Reply to: ${asked.slice(0, 40)}` }) + 'data: [DONE]\n\n');
    if (/slow/.test(asked)) { res.write(frame({ content: 'Starting… ' })); setTimeout(finish, 8000); } else finish();
  });
});
await new Promise((r) => model.listen(0, '127.0.0.1', r));
await fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify({ modelFilter: 'all', theme: 'light' }) });
await fetch(BASE + '/api/providers/custom-scripted', { method: 'DELETE' }); await fetch(BASE + '/api/providers/custom', { method: 'POST', headers: J, body: JSON.stringify({ name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1` }) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL: BASE, acceptDownloads: true });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE }).catch(() => {});
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 120)); });
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
let dialogReply = '';
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(`${d.type()}: ${d.message().slice(0, 60)}`); d.type() === 'prompt' ? d.accept(dialogReply) : d.accept(); });
const shot = (n) => page.screenshot({ path: `${OUT}/q2c-${n}.png` });
const home = async () => { await page.goto('/'); await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'chat'); }); await page.goto('/'); await page.waitForSelector('#greeting'); };
const pick = async () => { await page.locator('#picker-button').click(); await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); };
const say = async (t, wait = 20000) => { await page.locator('#input').fill(t); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {}); await page.locator('#stop').waitFor({ state: 'hidden', timeout: wait }); await page.waitForTimeout(300); };
const apiSessions = async () => (await fetch(BASE + '/api/sessions')).json();
const visible = (sel) => page.locator(sel).isVisible();

await home(); await pick();

// ===================== sidebar =====================
await row('N1', 'Chat / Code toggle', 'switches the mode, shows the right composer, remembers it', async () => {
  await page.locator('#mode-code').click(); eq(await page.locator('#mode-code').getAttribute('aria-pressed'), 'true', 'code pressed');
  ok(await visible('#folder-chip'), 'folder chip not shown in Code');
  await page.locator('#mode-chat').click(); eq(await page.locator('#mode-chat').getAttribute('aria-pressed'), 'true', 'chat pressed');
  ok(!(await visible('#folder-chip')), 'folder chip still shown in Chat');
});
await row('N2', 'Send a message (Enter), Shift+Enter newline', 'Enter sends; Shift+Enter adds a line', async () => {
  await page.locator('#input').fill('first line'); await page.locator('#input').press('Shift+Enter'); await page.keyboard.type('second line');
  eq(await page.locator('#input').inputValue(), 'first line\nsecond line', 'shift+enter');
  await page.locator('#input').press('Enter'); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }); await page.waitForTimeout(500);
  ok((await page.locator('.msg.user .body').last().innerText()).includes('second line'), 'message not sent');
});
await row('N3', 'Send button disabled when empty / while streaming', 'no empty sends', async () => {
  await page.locator('#input').fill(''); await page.locator('#send').click({ force: true }); await page.waitForTimeout(300);
  eq(await page.locator('.msg.user').count(), 1, 'an empty message was sent');
});
await row('N4', 'New chat', 'clears the thread, shows the greeting, drops ?s=', async () => {
  await page.locator('#new-chat').click(); await page.waitForTimeout(400);
  ok(await visible('#greeting'), 'greeting missing'); ok(!page.url().includes('?s='), 'still on a session url'); eq(await page.locator('.msg').count(), 0, 'messages left');
});
await row('N5', 'Chat title appears in sidebar after first reply', 'new row, selected', async () => {
  await page.locator('#input').fill('Plan the carrot garden'); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }); await page.waitForTimeout(600);
  ok((await page.locator('.session-row').allInnerTexts()).some((t) => /carrot garden/i.test(t)), 'row not found: ' + (await page.locator('.session-row').allInnerTexts()).join('|'));
  ok(page.url().includes('?s='), 'url has no session');
});
await row('N6', 'Search chats', 'filters the list as you type; clears', async () => {
  await page.locator('#search').fill('zzzz-nothing'); await page.waitForTimeout(700); eq(await page.locator('.session-row').count(), 0, 'rows for a nonsense search');
  await page.locator('#search').fill('carrot'); await page.waitForTimeout(700); ok((await page.locator('.session-row').count()) >= 1, 'no match for carrot');
  await page.locator('#search').fill(''); await page.waitForTimeout(500);
});
await row('N7', 'Session row menu (⋯)', 'rename / archive / delete / pin etc. all work', async () => {
  await page.locator('.session-row').first().hover(); await page.locator('.session-row .row-menu').first().click(); await page.waitForTimeout(300);
  const items = (await page.locator('.row-menu-popup button, .menu:not([hidden]) button, [role="menu"]:not([hidden]) button').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  await shot('row-menu'); return 'items: ' + JSON.stringify(items);
});
await row('N8', 'Rename a chat', 'new title shows in sidebar and top bar', async () => {
  const rename = page.locator('button:visible', { hasText: /^Rename/ }).first();
  if (!(await rename.count())) unknown('no Rename item found in the row menu');
  dialogReply = 'Garden plan renamed'; await rename.click(); await page.waitForTimeout(800);
  ok((await page.locator('.session-row').allInnerTexts()).some((t) => /renamed/.test(t)), 'title not updated'); eq((await page.locator('#chat-title').innerText()).trim(), 'Garden plan renamed', 'top bar title');
});
await row('N9', 'Archive then Archived list then restore', 'archived chat leaves the list, appears under Archived, can be restored', async () => {
  const rowsBefore = await page.locator('.session-row').count();
  await page.locator('.session-row').first().hover(); await page.locator('.session-row .row-menu').first().click();
  const arch = page.locator('button:visible', { hasText: /^Archive/ }).first(); if (!(await arch.count())) unknown('no Archive item'); await arch.click(); await page.waitForTimeout(600);
  eq(await page.locator('.session-row').count(), rowsBefore - 1, 'row still listed after archive');
  await page.locator('#archived-toggle').click(); await page.waitForTimeout(600); ok((await page.locator('.session-row').count()) >= 1, 'archived list empty'); await shot('archived');
  await page.locator('.session-row').first().hover(); await page.locator('.session-row .row-menu').first().click();
  const un = page.locator('button:visible', { hasText: /^(Restore|Unarchive)/ }).first(); if (!(await un.count())) unknown('no Restore item'); await un.click(); await page.waitForTimeout(600);
  await page.locator('#archived-toggle').click(); await page.waitForTimeout(600); eq(await page.locator('.session-row').count(), rowsBefore, 'restored chat not back');
});
await row('N10', 'Incognito chat', 'badge shown; nothing saved on disk/list', async () => {
  const before = (await apiSessions()).length;
  await page.locator('#incognito').click(); await page.waitForTimeout(400); ok(await visible('#mode'), 'Incognito badge hidden');
  await page.locator('#input').fill('secret words'); await page.locator('#send').click(); await page.locator('.msg.assistant .body', { hasText: 'Reply to' }).waitFor({ timeout: 15000 }).catch(() => {}); await page.waitForTimeout(600);
  eq((await apiSessions()).length, before, 'incognito chat was saved'); ok((await page.locator('.msg.assistant .body').last().innerText()).trim().length > 5, 'no reply');
  await page.locator('#new-chat').click();
});
await row('N11', 'New project', 'asks for a name, creates the project, shows in filter', async () => {
  await page.locator('#new-project').click(); await page.waitForTimeout(400); await shot('new-project');
  const input = page.locator('.modal input, dialog input, input[aria-label*="roject" i]:visible').first(); if (!(await input.count())) unknown('no name field appeared');
  await input.fill('Garden'); await input.press('Enter'); await page.waitForTimeout(600);
  ok((await page.locator('#project-filter option').allInnerTexts()).some((t) => /Garden/.test(t)), 'project not in the filter');
});
await row('N12', 'Project filter', 'filters chats by project', async () => {
  const opts = await page.locator('#project-filter option').evaluateAll((o) => o.map((x) => x.value)); ok(opts.length >= 2, 'no project option'); await page.locator('#project-filter').selectOption(opts.at(-1)); await page.waitForTimeout(500);
  const n = await page.locator('.session-row').count(); await page.locator('#project-filter').selectOption(opts[0]); return `filtered rows: ${n}`;
});
await row('N13', 'Import chat', 'modal; empty import refused; pasted transcript becomes a chat', async () => {
  await page.locator('#import').click(); await page.locator('#import-text').waitFor({ state: 'visible' });
  await page.locator('#import-run').click(); await page.waitForTimeout(400); const empty = (await page.locator('#import-run').evaluate((e) => e.closest('.modal')?.innerText.replace(/\s+/g, ' ').slice(0, 160))); errs = []; bad = [];
  await page.locator('#import-text').fill('## You\nhi there\n\n## Assistant\nhello back'); const before = (await apiSessions()).length; await page.locator('#import-run').click(); await page.locator('#import-text').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500);
  const created = (await apiSessions()).length === before + 1; if (await visible('#import-text')) await page.locator('#import-cancel').click(); ok(created, 'no chat created'); return `empty message: "${empty}"`;
});
await row('N13b', 'Import: "User: ... / Assistant: ..." one-line labels', 'common copy-paste transcript shape is understood', async () => {
  await page.locator('#import').click(); await page.locator('#import-text').fill('User: hi there\nAssistant: hello back'); const before = (await apiSessions()).length; await page.locator('#import-run').click(); await page.waitForTimeout(1200);
  const created = (await apiSessions()).length === before + 1; const msg = (await page.locator('#import-run').evaluate((e) => e.closest('.modal')?.innerText.replace(/\s+/g, ' ').slice(0, 200))).replace(/Import a chat.*?tool\.\s*/, ''); if (await visible('#import-text')) await page.locator('#import-cancel').click();
  ok(created, 'not recognised; the dialog says: ' + msg);
});
await row('N14', 'Sidebar collapse (button and Ctrl+B)', 'hides / shows the sidebar', async () => {
  const w = async () => (await page.locator('.sidebar').boundingBox())?.width ?? 0; const open = await w(); ok(open > 100, 'sidebar not open at start');
  await page.locator('#sidebar-collapse').click(); await page.waitForTimeout(400); ok((await w()) < 10 || !(await visible('.sidebar')), 'did not collapse'); await page.keyboard.press('Control+b'); await page.waitForTimeout(400); ok((await w()) > 100, 'Ctrl+B did not reopen');
});
await row('N15', 'Artifacts toggle and panel', 'opens/closes the Artifacts panel; ✕ closes', async () => {
  await page.locator('#artifacts-toggle').click(); await page.waitForTimeout(300); ok(await visible('#artifacts'), 'panel not shown'); await page.locator('#artifacts-close').click(); await page.waitForTimeout(300); ok(!(await visible('#artifacts')), 'not closed');
});

// ===================== account menu & settings window =====================
await row('M1', 'Account menu items', 'each item does what it says', async () => {
  const out = [];
  for (const [sel, expect] of [['[data-settings="profile"]', 'profile'], ['[data-settings="usage"]', 'usage'], ['[data-settings="language"]', 'language'], ['[data-settings="providers"]', 'providers'], ['[data-settings="about"] >> nth=1', 'about']]) {
    await page.locator('#account-button').click(); await page.locator(`#account-menu ${sel}`).first().click(); await page.waitForTimeout(700);
    const src = await page.locator('#settings-frame').getAttribute('src'); out.push(`${expect}→${src}`); ok(String(src).includes(expect) || expect === 'about', `frame did not go to ${expect}: ${src}`);
    await page.locator('#settings-close').click(); await page.waitForTimeout(250);
  }
  return out.join(' ; ');
});
await row('M2', 'Account menu: Quit Bunny AI', 'only offered in the desktop app', async () => {
  await page.locator('#account-button').click(); const v = await page.locator('#account-menu', { has: page.locator('text=Quit Bunny AI') }).locator('text=Quit Bunny AI').isVisible(); await page.keyboard.press('Escape'); await page.mouse.click(700, 500);
  if (v) throw new Error('Quit is shown in the browser build; clicking it would do nothing useful'); return 'hidden in browser build';
});
await row('M3', 'Account menu: Check for updates', 'asks the update source and shows a result', async () => {
  await page.locator('#account-button').click(); await page.locator('#account-menu button', { hasText: 'Check for updates' }).click(); await page.waitForTimeout(2500);
  return 'frame: ' + (await page.locator('#settings-frame').getAttribute('src')); });
await page.locator('#settings-close').click().catch(() => {});
await row('M4', 'Settings window: all 16 sections open', 'each nav row loads its section', async () => {
  await page.locator('#settings-open').click(); await page.waitForTimeout(500);
  const keys = await page.locator('.settings-nav [data-section], #settings-nav-list button.nav-row[data-section]').evaluateAll((e) => e.map((x) => x.dataset.section)).catch(() => []);
  const rowsAll = await page.locator('#settings-nav-list button.nav-row[data-section]:visible').evaluateAll((e) => e.map((x) => x.dataset.section)); const sections = [...new Set(rowsAll)];
  const fails = [];
  for (const s of sections) { await page.locator(`button.nav-row[data-section="${s}"]`).click(); await page.waitForTimeout(500); const src = await page.locator('#settings-frame').getAttribute('src'); const body = await page.frameLocator('#settings-frame').locator('body').innerText().catch(() => ''); if (!src || body.trim().length < 20) fails.push(s); }
  if (fails.length) throw new Error('empty or no frame: ' + fails.join(',')); return `${sections.length} sections: ${sections.join(',')} (${keys.length})`;
});
await row('M5', 'Settings search', 'filters the left list', async () => {
  if (!(await visible('#settings-frame'))) { await page.locator('#settings-open').click(); await page.waitForTimeout(500); }
  await page.locator('#settings-search').fill('theme'); await page.waitForTimeout(400); const shown = await page.locator('#settings-nav-list button.nav-row[data-section]:visible').allInnerTexts();
  await page.locator('#settings-search').fill('zzzz'); await page.waitForTimeout(400); const none = await page.locator('#settings-nav-list button.nav-row[data-section]:visible').count(); await page.locator('#settings-search').fill('');
  ok(shown.some((s) => /Appearance/.test(s)), 'Appearance not found for "theme": ' + shown.join('|')); return `theme→${shown.join('|')}; zzzz→${none}`;
});
await row('M6', 'Settings window close (✕, Esc)', 'closes the window', async () => {
  if (!(await visible('#settings-frame'))) { await page.locator('#settings-open').click(); await page.waitForTimeout(500); }
  await page.locator('#settings-close').click(); await page.waitForTimeout(300); ok(!(await visible('#settings-frame')), '✕ did not close');
  await page.keyboard.press('Control+,'); await page.waitForTimeout(400); ok(await visible('#settings-frame'), 'Ctrl+, did not open'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); ok(!(await visible('#settings-frame')), 'Esc did not close');
});

// ===================== command palette =====================
await row('K1', 'Command palette: open, filter, click a command, Esc', 'Ctrl+K opens; typing filters; clicking runs; Esc closes', async () => {
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').waitFor({ state: 'visible' });
  const all = await page.locator('.palette-item').count(); await page.locator('#palette-input').fill('incog'); await page.waitForTimeout(300);
  await page.locator('.palette-item').first().click(); await page.waitForTimeout(500); ok(await visible('#mode'), 'Incognito command did not run'); await page.locator('#new-chat').click();
  await page.keyboard.press('Control+k'); await page.keyboard.press('Escape'); await page.waitForTimeout(200); ok(!(await visible('#palette-input')), 'Esc did not close'); return `commands listed: ${all}`;
});
await row('K1b', 'Command palette: keyboard (Arrow keys, Enter)', 'a palette can be driven without the mouse', async () => {
  ok(!(await visible('#artifacts')), 'artifacts panel open before the test');
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').waitFor({ state: 'visible' }); await page.locator('#palette-input').fill('toggle artifacts'); await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(500); const ran = await visible('#artifacts'); const stillOpen = await visible('#palette-input'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  if (await visible('#artifacts')) await page.locator('#artifacts-close').click();
  ok(ran, `Enter ran nothing (palette still open: ${stillOpen}); no item is highlighted and #palette-input has no key handler (src/ui/chat.js:3198 only listens for input)`);
});
await row('K1c', 'Command palette: Settings / Providers commands', 'open the Settings window like the gear and Ctrl+, do', async () => {
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('settings'); await page.locator('.palette-item').first().click(); await page.waitForTimeout(1200);
  const opensWindow = await visible('#settings-frame'); const url = page.url(); await page.goto('/'); await page.waitForSelector('#greeting');
  ok(opensWindow, 'navigated the whole page to ' + url.replace(BASE, '') + ' instead of opening the Settings window (src/ui/chat.js:2957)');
});
await row('K2', 'Palette finds a chat by name', 'typing a chat title lists it', async () => {
  await page.keyboard.press('Control+k'); await page.locator('#palette-input').fill('renamed'); await page.waitForTimeout(500); const t = (await page.locator('.palette-item').allInnerTexts()).join('|'); await page.keyboard.press('Escape'); ok(/renamed/i.test(t), 'chat not found: ' + t);
});

// ===================== topbar: export, popout, panes =====================
if (await page.locator('.session-row').count()) { await page.locator('.session-row').first().click(); await page.waitForTimeout(800); }
await row('T1', 'Export', 'downloads the chat as Markdown', async () => {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.locator('#export').click()]); const name = d.suggestedFilename(); ok(/\.md$/i.test(name), 'file name ' + name); return name;
});
await row('T2', 'Popout', 'opens this chat in its own window', async () => {
  const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 5000 }), page.locator('#popout').click()]); await pop.waitForLoadState().catch(() => {}); const u = pop.url(); await pop.close(); ok(/s=|index\.html/.test(u), 'url ' + u);
});
for (const [view, label] of [['overview', 'Session overview'], ['terminal', 'Terminal'], ['diff', 'Changes'], ['browser', 'Browser'], ['file', 'Files'], ['tasks', 'Tasks and plan']]) {
  await row(`T3-${view}`, `Toolbar: ${label}`, 'opens its pane; second click closes it', async () => {
    const btn = page.locator(`.toolbar [data-view="${view}"], #rail-toggle[data-view="${view}"]`).first(); await btn.click(); await page.waitForTimeout(350);
    const pane = view === 'overview' ? '#rail' : '#side-pane'; ok(await visible(pane), 'pane not visible'); eq(await btn.getAttribute('aria-pressed'), 'true', 'aria-pressed');
    await shot(`pane-${view}`); await btn.click(); await page.waitForTimeout(300); ok(!(await visible(pane)), 'second click did not close');
  });
}
await row('T4', 'Pane layout menu', 'dock left/right/bottom, fill, side by side, new window', async () => {
  await page.locator('.toolbar [data-view="tasks"]').click(); await page.waitForTimeout(300);
  const lay = page.locator('#side-pane button[aria-label="Panel layout"]:visible').first(); await lay.click(); await page.waitForTimeout(200);
  const out = [];
  for (const [label, cls] of [['Dock left', 'pane-left'], ['Dock bottom', 'pane-bottom'], ['Dock right', null], ['Fill the chat area', 'pane-fill']]) {
    await page.locator(`#pane-layout-menu [aria-label="${label}"]`).click(); await page.waitForTimeout(250);
    const has = await page.evaluate((c) => c ? document.querySelector('.app, #app')?.classList.contains(c) : !document.querySelector('.app, #app')?.classList.contains('pane-left') && !document.querySelector('.app, #app')?.classList.contains('pane-bottom'), cls); out.push(`${label}:${has}`);
    if (cls && !has) throw new Error(`${label} did not apply (${cls})`);
    if (!(await visible('#pane-layout-menu'))) { await lay.click(); await page.waitForTimeout(150); }
  }
  return out.join(' ');
});
await page.keyboard.press('Escape');
await page.locator('#side-pane [data-close]').click().catch(() => {});

// ===================== composer =====================
await row('C1', 'Attach (file chooser)', 'picked file shows as a chip; × removes it; sent with the message', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'bunny-q2-att-')), 'notes.txt'); writeFileSync(f, 'carrot notes');
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 4000 }), page.locator('#attach').click()]); await fc.setFiles(f); await page.waitForTimeout(500);
  ok((await page.locator('#pending-files').innerText()).includes('notes.txt'), 'no chip'); await page.locator('.file-remove').click(); await page.waitForTimeout(200); ok(!(await visible('#pending-files')), 'chip not removed');
  await fc.page().locator('#attach').click().catch(() => {});
});
await row('C2', 'Voice button (hold to talk)', 'starts speech input or says why it cannot', async () => {
  await page.locator('#voice').dispatchEvent('pointerdown'); await page.waitForTimeout(600); await page.locator('#voice').dispatchEvent('pointerup'); await page.waitForTimeout(600);
  return 'status: ' + (await page.locator('#status').innerText()).trim() + ' | error: ' + (await page.locator('#error').innerText()).trim();
});
await row('C3', 'Permission mode menu', 'Auto / Manual / Accept edits / Plan, also keys 1-4; saved to the chat', async () => {
  const sid = new URL(page.url()).searchParams.get('s'); const out = [];
  for (const [label, key] of [['Plan', 'plan'], ['Accept edits', 'accept'], ['Manual', 'ask'], ['Auto', 'auto']]) {
    await page.locator('#mode-button').click(); await page.locator('#mode-menu button', { hasText: label }).first().click(); await page.waitForTimeout(400);
    const saved = (await (await fetch(`${BASE}/api/sessions/${sid}`)).json()); out.push(`${label}->${saved.permissionMode}`); eq(saved.permissionMode, key, `saved mode for ${label}`);
  }
  await page.locator('#mode-button').click(); await page.keyboard.press('3'); await page.waitForTimeout(300); eq((await (await fetch(`${BASE}/api/sessions/${sid}`)).json()).permissionMode, 'accept', 'key 3'); return out.join(' ');
});
await row('C4', 'Effort select', 'Low / Medium / High / Max saved to the chat', async () => {
  const sid = new URL(page.url()).searchParams.get('s'); for (const v of ['low', 'high', 'max', 'medium']) { await page.locator('#effort-level').selectOption(v); await page.waitForTimeout(300); eq((await (await fetch(`${BASE}/api/sessions/${sid}`)).json()).effort, v, 'effort ' + v); }
});
await row('C5', 'Job menu', 'Auto / Chat / Code / Image / Video / See / Research / Speech; unavailable ones are marked', async () => {
  await page.locator('#job-button').click(); const items = await page.locator('#job-menu button').allInnerTexts(); await page.locator('#job-menu button', { hasText: /^Research/ }).click(); await page.waitForTimeout(300);
  const label = (await page.locator('#job-button').innerText()).trim(); await page.locator('#job-button').click(); await page.locator('#job-menu button', { hasText: /^Auto/ }).click(); return `${items.length} items; after Research the button reads "${label}"`;
});
await row('C6', 'Model picker', 'lists models, Auto toggle, picking one shows it on the button', async () => {
  await page.locator('#picker-button').click(); const grp = await page.locator('.picker-panel .picker-group').allInnerTexts(); await page.locator('.picker-panel .picker-item.picker-auto').click(); await page.waitForTimeout(300);
  const a = (await page.locator('#picker-button').innerText()).replace(/\s+/g, ' '); await pick(); const b = (await page.locator('#picker-button').innerText()).replace(/\s+/g, ' '); return `groups ${JSON.stringify(grp)}; Auto→"${a}"; model→"${b}"`;
});
await row('C7', 'Stop while streaming', 'Stop ends the reply, keeps what arrived, no error', async () => {
  await page.locator('#input').fill('slow please'); await page.locator('#send').click(); await page.locator('#stop').waitFor({ state: 'visible', timeout: 4000 }); await page.waitForTimeout(1500);
  const t0 = Date.now(); await page.locator('#stop').click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 5000 }); const ms = Date.now() - t0; await page.waitForTimeout(500);
  const all = (await page.locator('#messages').innerText()).replace(/\s+/g, ' ').slice(-200); const err = (await page.locator('#error').innerText()).trim(); const sid = new URL(page.url()).searchParams.get('s'); const saved = (await (await fetch(`${BASE}/api/sessions/${sid}`)).json()).messages.slice(-2).map((m) => `${m.role}: ${String(m.content).slice(0, 30)}`); await page.reload(); await page.waitForTimeout(900); const afterReload = (await page.locator('#messages').innerText()).replace(/\s+/g, ' ').slice(-120); ok(/Starting/.test(all), `the partial reply is not on the screen: "${all.slice(-70)}"; saved: ${JSON.stringify(saved)}; error line: "${err}"; model picker: "${(await page.locator("#picker-button").innerText()).replace(/\s+/g, " ")}"`); ok(saved.some((x) => /Starting/.test(x)), 'the partial reply was not saved: ' + JSON.stringify(saved)); return `stopped in ${ms}ms; screen ends: "${all.slice(-60)}"; saved: ${JSON.stringify(saved)}; after reload: "${afterReload.slice(-60)}"; error line: "${err}"`;
});
await row('C8', 'Message actions: Copy / Edit / Retry / Save as artifact / Read aloud', 'each acts on its message', async () => {
  await say('hello actions'); const out = [];
  const last = page.locator('.msg.assistant').last(); await last.hover();
  await last.locator('button', { hasText: 'Copy' }).first().click().catch(() => {}); await page.waitForTimeout(300);
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => 'ERR')); out.push('copy→' + clip.slice(0, 25));
  await last.locator('button', { hasText: 'Retry' }).click(); await page.locator('#stop').waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500); out.push('retry→' + (await page.locator('.msg.assistant .body').last().innerText()).slice(0, 25));
  await page.locator('.msg.assistant').last().locator('button', { hasText: 'Save as artifact' }).click(); await page.waitForTimeout(800); out.push('artifacts=' + (await page.locator('#artifacts-toggle').innerText()).replace(/\s+/g, ' '));
  const user = page.locator('.msg.user').last(); await user.hover(); await user.locator('button', { hasText: 'Edit' }).click(); await page.waitForTimeout(300); out.push('edit box: ' + (await visible('.msg.user textarea, .msg.user [contenteditable]')));
  await page.keyboard.press('Escape'); return out.join(' | ');
});

writeFileSync(`${OUT}/controls.json`, JSON.stringify(rows, null, 1));
const n = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\n${n('PASS')} PASS / ${n('FAIL')} FAIL / ${n('UNKNOWN')} UNKNOWN of ${rows.length}`);
await browser.close(); model.close();

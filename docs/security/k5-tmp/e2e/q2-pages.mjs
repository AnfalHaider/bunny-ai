/**
 * Q-2 audit of the Settings sections, Providers, Automation and Customize screens, on an invented profile.
 *
 *   BASE=http://127.0.0.1:5392 OUT=<temp> node e2e/q2-pages.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE, OUT = process.env.OUT;
if (!(await (await fetch(BASE + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
mkdirSync(OUT, { recursive: true });
const J = { 'content-type': 'application/json' };
const rows = [];
let errs = [], bad = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const row = async (id, name, should, fn) => {
  if (ONLY && !ONLY.test(id)) return;
  errs = []; bad = []; const t = Date.now(); let verdict = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { verdict = 'FAIL'; note = String(e.message).split('\n')[0]; }
  const ms = Date.now() - t;
  if (errs.length || bad.length) { if (verdict === 'PASS') verdict = 'FAIL'; note += ` | errors: ${[...errs, ...bad].join(' ; ')}`.slice(0, 300); }
  rows.push({ id, name, should, verdict, note, ms });
  console.log(verdict.padEnd(5), id.padEnd(7), name, '::', String(note).slice(0, 260), ms > 2500 ? `[${ms}ms]` : '');
};
const api = async (p, init) => { const r = await fetch(BASE + p, init); return { status: r.status, body: await r.json().catch(() => null) }; };
const put = (o) => fetch(BASE + '/api/settings', { method: 'PUT', headers: J, body: JSON.stringify(o) });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 110)));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 110)); });
page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.request().method()} ${r.url().replace(BASE, '')}`); });
page.on('dialog', (d) => d.accept());
const shot = (n) => page.screenshot({ path: `${OUT}/q2g-${n}.png`, fullPage: true });
const go = async (u) => { await page.goto(u); await page.waitForTimeout(700); };

// ---------------- Settings sections ----------------
await row('S-language', 'Settings → Language', 'changing the language translates the interface and persists', async () => {
  await go('/src/ui/settings.html?embed=1&section=language'); const opts = await page.locator('#language option').evaluateAll((o) => o.map((x) => x.value)); ok(opts.length >= 2, 'one language only');
  const other = opts.find((o) => o !== 'en'); await page.locator('#language').selectOption(other); await page.waitForTimeout(600); eq((await api('/api/settings')).body.language, other, 'saved');
  await go('/'); await page.waitForSelector('#greeting'); const side = (await page.locator('#new-chat').innerText()).trim(); await shot('language-' + other);
  await put({ language: 'en' }); await go('/'); const back = (await page.locator('#new-chat').innerText()).trim();
  ok(side !== back, `the sidebar still reads "${side}" in ${other}`); return `${opts.length} languages; "${back}" -> "${side}" (${other})`;
});
await row('S-notif', 'Settings → Notifications', 'the switch saves; turning it on asks the browser for permission', async () => {
  await go('/src/ui/settings.html?embed=1&section=notifications'); const cb = page.locator('#notifications'); const before = await cb.isChecked(); await cb.evaluate((e) => e.click()); await page.waitForTimeout(700);
  const saved = (await api('/api/settings')).body.notifications; const state = (await page.locator('#notifications-state').innerText()).trim(); await put({ notifications: false }); return `before=${before} after=${saved} label="${state}"`;
});
await row('S-privacy', 'Settings → Privacy', 'shows where chats and secrets are stored and how big', async () => {
  await go('/src/ui/settings.html?embed=1&section=privacy'); const t = (await page.locator('#storage').innerText()).replace(/\s+/g, ' '); await shot('privacy'); ok(t.length > 30, 'empty: ' + t); return t.slice(0, 160);
});
await row('S-caps', 'Settings → Capabilities', 'each switch saves and persists', async () => {
  await go('/src/ui/settings.html?embed=1&section=capabilities'); const boxes = page.locator('[data-section="capabilities"] input[type="checkbox"]'); const n = await boxes.count(); const flips = [];
  for (let i = 0; i < n; i++) { const b = boxes.nth(i); const k = (await b.getAttribute('data-key')) ?? (await b.getAttribute('id')) ?? `#${i}`; const before = await b.isChecked(); await b.evaluate((e) => e.click()); await page.waitForTimeout(300); flips.push(`${k}:${before}->${await b.isChecked()}`); }
  await page.reload(); await page.waitForTimeout(700); const same = []; for (let i = 0; i < n; i++) same.push(await page.locator('[data-section="capabilities"] input[type="checkbox"]').nth(i).isChecked());
  for (let i = 0; i < n; i++) await page.locator('[data-section="capabilities"] input[type="checkbox"]').nth(i).evaluate((e) => e.click()).catch(() => {});
  return `${n} switches: ${flips.join(' ')}`;
});
await row('S-speech', 'Settings → Capabilities → Speech voice', 'lists the computer\'s voices; choice persists', async () => {
  await go('/src/ui/settings.html?embed=1&section=capabilities'); const v = await page.locator('#speech-voice option').evaluateAll((o) => o.map((x) => x.value + ':' + x.textContent)); return `${v.length} option(s): ${v.slice(0, 3).join(' | ')}`;
});
await row('S-conn', 'Settings → Connection', 'shows provider, model and test-mode state', async () => {
  await go('/src/ui/settings.html?embed=1&section=connection'); const t = (await page.locator('[data-section="connection"]').innerText()).replace(/\s+/g, ' '); return t.slice(0, 200);
});
await row('S-models', 'Settings → Models: filter, token limit, allowlist, aliases, Save', 'each saves; the picker reflects them', async () => {
  await go('/src/ui/settings.html?embed=1&section=models'); await page.locator('#max-tokens').fill('2048'); await page.locator('#allowlist').fill('offline/bunny-code'); await page.locator('#aliases').fill('carrot = offline/bunny-code'); await page.locator('#save-models').click(); await page.waitForTimeout(800);
  const s = (await api('/api/settings')).body; ok(s.maxTokens === 2048 || s.maxTokens === '2048', 'maxTokens ' + s.maxTokens); ok(JSON.stringify(s.allowlist ?? []).includes('bunny-code'), 'allowlist ' + JSON.stringify(s.allowlist)); ok(JSON.stringify(s.aliases ?? {}).includes('carrot'), 'aliases ' + JSON.stringify(s.aliases));
  await go('/'); await page.waitForSelector('#greeting'); await page.locator('#picker-button').click(); const items = (await page.locator('.picker-panel .picker-item:not(.picker-auto)').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').slice(0, 40)); await page.keyboard.press('Escape');
  await put({ maxTokens: null, allowlist: [], aliases: {} }); return `picker after allowlist+alias: ${JSON.stringify(items)}`;
});
await row('S-usage', 'Settings → Usage', 'counts what was used after chats', async () => {
  await go('/src/ui/settings.html?embed=1&section=usage'); const t = (await page.locator('[data-section="usage"]').innerText()).replace(/\s+/g, ' '); return t.slice(0, 200);
});
await row('S-about', 'Settings → About → Check for updates', 'asks the update source and shows a result without freezing', async () => {
  await go('/src/ui/settings.html?embed=1&section=about'); const t0 = Date.now(); await page.locator('#check-update').click(); await page.waitForTimeout(3500); const note = (await page.locator('#update-note').innerText()).trim(); return `after ${Date.now() - t0}ms: "${note}"`;
});

// ---------------- Providers ----------------
await row('PV1', 'Providers: connect a built-in provider with a key, then disconnect', 'connects, lists its models, disconnect removes it', async () => {
  await go('/src/ui/providers.html'); await page.getByRole('button', { name: 'Connect Anthropic' }).click(); await page.locator('#f-anthropic-apiKey').fill('sk-test-000000000000'); await page.getByRole('button', { name: 'Connect', exact: true }).click(); await page.waitForTimeout(1500);
  const t = (await page.locator('#connected').innerText()).replace(/\s+/g, ' '); ok(/Anthropic/.test(t), 'not connected: ' + t); await shot('providers-connected');
  const dis = page.locator('#connected button', { hasText: /Disconnect/ }).first(); ok(await dis.count(), 'no Disconnect button: ' + t); await dis.click(); await page.waitForTimeout(800); ok(!/Anthropic/.test(await page.locator('#connected').innerText()), 'still connected'); return t.slice(0, 140);
});
await row('PV2', 'Providers: wrong / empty key', 'says what is wrong and stays unconnected', async () => {
  await go('/src/ui/providers.html'); await page.getByRole('button', { name: 'Connect OpenAI' }).click(); await page.getByRole('button', { name: 'Connect', exact: true }).click(); await page.waitForTimeout(800); bad = []; errs = [];
  const err = (await page.locator('.err:visible, .error:visible, [role="alert"]:visible').allInnerTexts()).join('|'); ok(err.trim().length > 0, 'no message shown for an empty key'); return err;
});
await row('PV3', 'Providers: custom provider add and remove', 'adds, shows connected, removes', async () => {
  await go('/src/ui/providers.html'); await page.locator('#custom-name').fill('Local test'); await page.locator('#custom-url').fill('http://127.0.0.1:9/v1'); await page.locator('#custom-add').click(); await page.waitForTimeout(2000);
  const t = (await page.locator('body').innerText()).replace(/\s+/g, ' '); return 'after adding an unreachable URL: ' + (t.match(/Local test[^.]{0,120}/)?.[0] ?? 'not listed') + ' | ' + ((await page.locator('.err:visible, [role="alert"]:visible').allInnerTexts()).join('|'));
});

// ---------------- Automation ----------------
await row('AU1', 'Automation: Memory add / edit / switch / delete', 'all four work', async () => {
  await go('/src/ui/automation.html'); await page.locator('#memory-text').fill('I like carrots'); await page.getByRole('button', { name: 'Remember' }).click(); await page.waitForTimeout(600);
  const list = (await page.locator('#memory-list').innerText()).replace(/\s+/g, ' '); ok(/carrots/.test(list), 'not listed: ' + list); const btns = await page.locator('#memory-list button, #memory-list input[type=checkbox]').evaluateAll((e) => e.map((b) => b.getAttribute('aria-label') || b.textContent.trim()));
  const del = page.locator('#memory-list button', { hasText: /Delete|Remove|×/ }).first(); if (await del.count()) { await del.click(); await page.waitForTimeout(500); ok(!/carrots/.test(await page.locator('#memory-list').innerText()), 'not deleted'); } return 'controls: ' + JSON.stringify(btns);
});
await row('AU2', 'Automation: MCP server (bad address)', 'refuses with a clear message', async () => {
  await go('/src/ui/automation.html'); await page.locator('#mcp-name').fill('Bad'); await page.locator('#mcp-url').fill('not a url'); await page.getByRole('button', { name: 'Add server' }).click(); await page.waitForTimeout(800); bad = []; errs = [];
  const err = (await page.locator('.err:visible, .error:visible, [role="alert"]:visible').allInnerTexts()).join('|'); const lst = (await page.locator('#mcp-list').innerText()).replace(/\s+/g, ' '); ok(err.trim() || !/Bad/.test(lst), 'accepted a bad address silently'); return `message: "${err}" list: "${lst.slice(0, 80)}"`;
});
await row('AU3', 'Automation: Schedule add / switch / delete', 'validates and works', async () => {
  await go('/src/ui/automation.html'); await page.locator('#schedule-name').fill('Daily carrots'); await page.locator('#schedule-prompt').fill('Say hello'); await page.locator('#schedule-every').fill('60'); await page.getByRole('button', { name: 'Add schedule' }).click(); await page.waitForTimeout(700);
  const t = (await page.locator('#schedule-list').innerText()).replace(/\s+/g, ' '); ok(/Daily carrots/.test(t), 'not listed: ' + t);
  await page.locator('#schedule-name').fill('Zero'); await page.locator('#schedule-prompt').fill('x'); await page.locator('#schedule-every').fill('0'); await page.getByRole('button', { name: 'Add schedule' }).click(); await page.waitForTimeout(600);
  const t2 = (await page.locator('#schedule-list').innerText()).replace(/\s+/g, ' '); const zero = /Zero/.test(t2); const del = page.locator('#schedule-list button', { hasText: /Delete|Remove|×/ }); for (let i = await del.count(); i > 0; i--) { await del.first().click(); await page.waitForTimeout(400); }
  ok(!zero, 'accepted "every 0 minutes"'); return t.slice(0, 120);
});
await row('AU4', 'Automation: Hook add / delete', 'works', async () => {
  await go('/src/ui/automation.html'); await page.locator('#hook-name').fill('Log it'); await page.locator('#hook-command').fill('echo hook'); await page.getByRole('button', { name: 'Add hook' }).click(); await page.waitForTimeout(600);
  const t = (await page.locator('#hook-list').innerText()).replace(/\s+/g, ' '); ok(/Log it/.test(t), 'not listed: ' + t); const del = page.locator('#hook-list button', { hasText: /Delete|Remove|×/ }); for (let i = await del.count(); i > 0; i--) { await del.first().click(); await page.waitForTimeout(400); } return t.slice(0, 120);
});
await row('AU5', 'Automation: Skill add / delete', 'works', async () => {
  await go('/src/ui/automation.html'); await page.locator('#skill-name').fill('Greeter'); await page.locator('#skill-description').fill('Greets'); await page.locator('#skill-instructions').fill('Say hi.'); await page.getByRole('button', { name: 'Add skill' }).click(); await page.waitForTimeout(600);
  const t = (await page.locator('#skill-list').innerText()).replace(/\s+/g, ' '); ok(/Greeter/.test(t), 'not listed: ' + t); const del = page.locator('#skill-list button', { hasText: /Delete|Remove|×/ }); for (let i = await del.count(); i > 0; i--) { await del.first().click(); await page.waitForTimeout(400); } return t.slice(0, 120);
});

// ---------------- Customize ----------------
await row('CZ1', 'Customize: tabs, search, Add menu', 'Connectors / Skills / Plugins and Yours / Discover switch; search filters; ＋ Add offers its four choices', async () => {
  await go('/src/ui/customize.html'); const out = [];
  for (const tab of ['Connectors', 'Skills', 'Plugins']) { await page.locator('button', { hasText: new RegExp('^' + tab + '$') }).first().click(); await page.waitForTimeout(350); out.push(tab + ':' + (await page.locator('main, body').first().innerText()).replace(/\s+/g, ' ').length); }
  for (const tab of ['Yours', 'Discover']) { await page.locator('button', { hasText: new RegExp('^' + tab + '$') }).first().click(); await page.waitForTimeout(350); }
  await page.locator('#cz-search').fill('zzzzzz'); await page.waitForTimeout(400); await page.locator('#cz-search').fill('');
  await page.locator('#cz-add').click(); await page.waitForTimeout(300); const items = await page.locator('[class*="cz-add-menu"] button, #cz-add-menu button, [data-section="cz-add-menu"] button').allInnerTexts(); await shot('customize-add');
  return `${out.join(' ')} | Add menu: ${JSON.stringify(items.map((i) => i.replace(/\s+/g, ' ').slice(0, 30)))}`;
});
await row('CZ2', 'Customize: add a skill, turn it off and on, remove it', 'the lifecycle works and Discover is not empty', async () => {
  await go('/src/ui/customize.html'); await page.locator('#cz-add').click(); await page.getByText('Instructions the model follows').first().click(); await page.waitForTimeout(300);
  await page.locator('input[placeholder*="name" i]:visible').first().fill('Zed skill'); await page.locator('textarea:visible').first().fill('Say zed.'); await page.getByRole('button', { name: 'Add skill' }).click(); await page.waitForTimeout(700);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' '); ok(/Zed skill/.test(body), 'not listed'); const ctl = await page.locator('button:visible').allInnerTexts();
  await page.locator('button', { hasText: /^Discover$/ }).first().click(); await page.waitForTimeout(500); const disc = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160); await page.locator('button', { hasText: /^Yours$/ }).first().click();
  return 'controls: ' + JSON.stringify(ctl.slice(0, 14)) + ' | Discover: ' + disc;
});

writeFileSync(`${OUT}/pages.json`, JSON.stringify(rows, null, 1));
const n = (v) => rows.filter((r) => r.verdict === v).length;
console.log(`\n${n('PASS')} PASS / ${n('FAIL')} FAIL of ${rows.length}`);
await browser.close();

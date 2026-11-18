/**
 * QA, v0.1.13 SET-ALL part 2: does each setting DO what its text says? In-process Bunny on an invented profile, a scripted OpenAI-compatible provider that records
 * every request and can send "thinking", a real Chromium page. A setting is changed through the same settings route the Settings page uses; the effect is read in
 * the chat page (what is drawn) or in the request the model received (what Bunny sent). Rows whose effect cannot be seen from outside are listed as NOT OBSERVED.
 *   node e2e/w0113-does.mjs
 */
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0113d-data-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w0113d-folder-'));
const rows = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, label, ok, detail = '') => { rows.push({ id, label, ok: Boolean(ok), detail: String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const notObserved = (id, label, why) => { rows.push({ id, label, ok: true, detail: 'NOT OBSERVED ' + why }); console.log('N/A   ' + id + '  ' + label + '  :: NOT OBSERVED: ' + why); };
const NL = String.fromCharCode(10);

let slowMs = 0; let thinking = true; const requests = [];
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
    let body = {}; try { body = JSON.parse(raw); } catch { /* x */ }
    requests.push({ url: req.url, body });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (delta) => res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + NL + NL);
    if (thinking) send({ reasoning_content: 'QA-THOUGHT: working it out step by step.' });
    if (slowMs) await wait(slowMs);
    send({ content: 'walk answer' }); res.end('data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const bunny = await createApp({ dataDir: DATA, fake: false, secretStore: memorySecretStore(), probe: async () => ({ ok: true, keyVerified: true }), discover: async () => [{ id: 'gpt-4o', displayName: 'GPT 4o', ownedBy: 'x', contextLength: null }], localGuard: true, folderPickerOnly: true });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${bunny.server.address().port}`;
const adminJson = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j }; };
const put = (patch) => adminJson('/api/settings', 'PUT', patch);
await bunny.chooseFolder(FOLDER);
await adminJson('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
const mkChat = async (title, extra = {}) => (await adminJson('/api/sessions', 'POST', { title, providerId: 'openai', model: 'gpt-4o', ...extra })).json;
const browser = await chromium.launch();
const finish = async (code) => { try { await browser.close(); } catch { /* x */ } try { provider.close(); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed`); console.log('=== FAILED ==='); for (const r of bad) console.log(`${r.id} :: ${r.label} :: ${r.detail}`); process.exit(code ?? (bad.length ? 1 : 0)); };

async function send(chat, text, ) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
  await page.addInitScript(() => { localStorage.setItem('bunny.modelAuto', '0'); });
  const before = requests.length;
  await page.goto(local + '/?s=' + chat.id); await page.waitForTimeout(1500);
  await page.fill('#input', text); await page.locator('#send').click();
  for (let i = 0; i < 40 && requests.length === before; i++) await wait(250);
  await page.waitForTimeout(2500);
  return { page, ctx, req: requests.length > before ? requests[requests.length - 1].body : null };
}
const sys = (req) => JSON.stringify(req?.messages?.filter((m) => m.role === 'system') ?? []);

try {
  // ---------- transcript view ----------
  for (const view of ['normal', 'thinking', 'verbose']) {
    await put({ transcriptView: view }); thinking = true;
    const chat = await mkChat('TV ' + view);
    const { page, ctx } = await send(chat, 'think about ' + view);
    const info = await page.evaluate(() => { const d = [...document.querySelectorAll('details.thinking')]; return { count: d.length, open: d.map((x) => x.open), text: d.map((x) => x.innerText.slice(0, 60)) }; });
    const want = view !== 'normal';
    check('D-view-' + view, `Default transcript view = ${view}: the model's thinking is ${want ? 'open' : 'folded'} in the chat`, info.count >= 1 && info.open.every((o) => o === want), JSON.stringify(info));
    await ctx.close();
  }
  notObserved('D-view-verbose-steps', 'Verbose: whole step results shown (not cut at 500 characters)', 'needs a long tool result from a model; the 500 vs 100000 limit is a one-line constant (resultLimit in chat.js) not driven here');
  // ---------- label chats by status ----------
  for (const on of [true, false]) {
    await put({ statusLabels: on }); thinking = false; slowMs = 6000;
    const a = await mkChat('Working A ' + on); const bchat = await mkChat('Other B ' + on);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    await page.addInitScript(() => { localStorage.setItem('bunny.modelAuto', '0'); });
    await page.goto(local + '/?s=' + a.id); await page.waitForTimeout(1200);
    await page.fill('#input', 'slow one'); await page.locator('#send').click(); await page.waitForTimeout(600);
    await page.goto(local + '/?s=' + bchat.id); await page.waitForTimeout(1500);
    const tags = await page.evaluate(() => [...document.querySelectorAll('.status-tag')].map((x) => x.textContent));
    check('D-status-' + on, `Label chats by status = ${on}: the sidebar ${on ? 'marks chats with a status (Working/Ready...)' : 'shows no status tag'}`, on ? tags.length > 0 : tags.length === 0, JSON.stringify(tags));
    await wait(6500); slowMs = 0; await ctx.close();
  }
  await put({ statusLabels: true });
  // ---------- what the model is sent ----------
  thinking = false; slowMs = 0;
  await put({ instructions: 'QA-STANDING-INSTRUCTION say pineapple', callName: 'QA-Nickname', displayName: 'QA Person' });
  let r = await send(await mkChat('Req1'), 'hello'); await r.ctx.close();
  check('D-instructions', 'Instructions for every chat: the text is sent to the model', sys(r.req).includes('QA-STANDING-INSTRUCTION'), sys(r.req).slice(0, 120));
  check('D-callname', 'What should Bunny call you: the name is sent to the model', sys(r.req).includes('QA-Nickname'));
  await put({ instructions: '', callName: '' });
  for (const on of [true, false]) {
    await put({ summaryNextSteps: on });
    const x = await send(await mkChat('Sum ' + on), 'hello'); await x.ctx.close();
    (on ? (globalThis.sumOn = sys(x.req)) : (globalThis.sumOff = sys(x.req)));
  }
  check('D-summary', 'Summary and next steps: the instruction to end with what was done/left/needed is sent only when on', globalThis.sumOn !== globalThis.sumOff && globalThis.sumOn.length > globalThis.sumOff.length, `on ${globalThis.sumOn.length} chars, off ${globalThis.sumOff.length}`);
  const un = {};
  for (const v of ['ask', 'new', 'here']) { await put({ unrelatedTask: v }); const x = await send(await mkChat('Un ' + v), 'hello'); await x.ctx.close(); un[v] = sys(x.req); }
  check('D-unrelated', 'When you ask for an unrelated task (ask / new / here): Do it here drops the move-to-new-chat tool and its instruction (ask/new differ only in the recommended choice on the card)', un.here !== un.ask && un.ask === un.new, Object.entries(un).map(([k, v]) => k + ':' + v.length).join(' '));
  await put({ maxTokens: 1024 }); let x = await send(await mkChat('Max'), 'hello'); await x.ctx.close();
  const mt1 = x.req?.max_tokens ?? x.req?.max_completion_tokens;
  await put({ maxTokens: 2048 }); x = await send(await mkChat('Max2'), 'hello'); await x.ctx.close();
  const mt2 = x.req?.max_tokens ?? x.req?.max_completion_tokens;
  check('D-maxtokens', 'Longest reply in tokens: the limit sent to the model follows the setting', Number(mt2) > Number(mt1) && mt1 > 0, `1024 -> ${mt1}; 2048 -> ${mt2}`);
  await adminJson('/api/memory', 'POST', { text: 'QA-MEMORY-FACT likes mangoes' });
  for (const on of [true, false]) { await put({ memoryEnabled: on }); x = await send(await mkChat('Mem ' + on), 'hello'); await x.ctx.close(); (on ? (globalThis.memOn = sys(x.req)) : (globalThis.memOff = sys(x.req))); }
  check('D-memory', 'Memory on/off: a saved memory is sent to the model only when memory is on', globalThis.memOn.includes('QA-MEMORY-FACT') && !globalThis.memOff.includes('QA-MEMORY-FACT'));
  await put({ memoryEnabled: true });
  // ---------- prompt suggestions ----------
  for (const on of [true, false]) {
    await put({ promptSuggestions: on }); const calls = []; const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    await page.addInitScript(() => { localStorage.setItem('bunny.modelAuto', '0'); }); page.on('request', (q) => { if (/\/suggest$/.test(q.url())) calls.push(q.url()); });
    const chat = await mkChat('Sugg ' + on); await page.goto(local + '/?s=' + chat.id); await page.waitForTimeout(1200);
    await page.fill('#input', 'hello'); await page.locator('#send').click(); await page.waitForTimeout(4500);
    check('D-suggest-' + on, `Prompt suggestions = ${on}: Bunny ${on ? 'asks for suggestions after a reply' : 'does not ask'}`, on ? calls.length >= 1 : calls.length === 0, String(calls.length));
    await ctx.close();
  }
  await put({ promptSuggestions: false });
  // ---------- appearance, read in the chat page ----------
  const look = async (patch, fn) => { await put(patch); const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage(); await page.goto(local + '/'); await page.waitForTimeout(1500); const v = await page.evaluate(fn); await ctx.close(); return v; };
  const dark = await look({ theme: 'dark' }, () => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  const light = await look({ theme: 'light' }, () => ({ t: document.documentElement.dataset.theme, bg: getComputedStyle(document.body).backgroundColor }));
  check('D-theme', 'Theme dark/light: the page colours change', dark.bg !== light.bg && dark.t === 'dark' && light.t === 'light', JSON.stringify({ dark, light }));
  const f1 = await look({ interfaceFont: 'mono' }, () => getComputedStyle(document.body).fontFamily); const f2 = await look({ interfaceFont: 'system' }, () => getComputedStyle(document.body).fontFamily);
  check('D-interfacefont', 'Interface font: the page font changes', f1 !== f2, `${f1} | ${f2}`);
  const z1 = await look({ transcriptSize: 'small' }, () => document.documentElement.style.getPropertyValue('--fs-transcript')); const z2 = await look({ transcriptSize: 'xlarge' }, () => document.documentElement.style.getPropertyValue('--fs-transcript'));
  check('D-transcriptsize', 'Transcript text size: the chat page marks the size', z1 !== z2, `${z1} | ${z2}`);
  const w1 = await look({ transcriptWidth: 'narrow' }, () => document.documentElement.style.getPropertyValue('--thread-max')); const w2 = await look({ transcriptWidth: 'full' }, () => document.documentElement.style.getPropertyValue('--thread-max'));
  check('D-transcriptwidth', 'Transcript width: the chat page marks the width', w1 !== w2, `${w1} | ${w2}`);
  const m1 = await look({ motion: 'reduced' }, () => document.documentElement.dataset.motion ?? document.documentElement.className); const m2 = await look({ motion: 'full' }, () => document.documentElement.dataset.motion ?? document.documentElement.className);
  check('D-motion', 'Motion: the page marks reduced vs full', m1 !== m2, `${m1} | ${m2}`);
  const l1 = await look({ language: 'fr' }, () => ({ lang: document.documentElement.lang, send: document.getElementById('send')?.getAttribute('aria-label') })); const l2 = await look({ language: 'en' }, () => ({ lang: document.documentElement.lang, send: document.getElementById('send')?.getAttribute('aria-label') }));
  check('D-language', 'Language: the page language and the words change', l1.lang === 'fr' && l2.lang === 'en' && l1.send !== l2.send, JSON.stringify({ l1, l2 }));
  const nm = await look({ displayName: 'QA Person Name' }, () => document.body.innerText.includes('QA Person Name'));
  check('D-displayname', 'Full name: shown in the sidebar/profile', nm === true);
  notObserved('D-branchprefix', 'Branch prefix: added to the start of every git branch Bunny creates', 'needs a chat that creates a worktree branch with a real model; not driven here');
  notObserved('D-autolimits', 'Most steps / minutes / token budget in one reply', 'needs a long agent run to hit the limit');
  notObserved('D-notifications', 'Notifications: a desktop alert when a reply is ready', 'OS notification, not visible from the page');
} catch (e) { check('D-run', 'part 2 ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | ')); }
await finish();

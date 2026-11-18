/**
 * QA, v0.1.13 SET-ALL part 3: the settings that need a run of tool steps. In-process Bunny, invented profile, a scripted OpenAI-compatible model that asks for tool steps
 * on demand, a temp git repo as the project. Rows: Branch prefix (the branch of "its own copy"), steps limit, minutes limit, token limit (the "Keep going?" question),
 * Verbose (whole step results), and the Notification a finished reply raises when the window is hidden (page code, a stand-in Notification: the OS toast itself is UNKNOWN).
 *   node e2e/w0113-extra.mjs
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = process.cwd();
const { createApp } = await import(pathToFileURL(join(root, 'src', 'server', 'app.js')).href);
const { memorySecretStore } = await import(pathToFileURL(join(root, 'src', 'providers', 'connections.js')).href);
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0113x-data-')); const REPO = mkdtempSync(join(tmpdir(), 'bunny-w0113x-repo-'));
const rows = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, label, ok, detail = '') => { rows.push({ id, label, ok: Boolean(ok), detail: String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const NL = String.fromCharCode(10);
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (...a) => execFileSync('git', a, { cwd: REPO, env: gitEnv, encoding: 'utf8', windowsHide: true }).trim();
git('init', '-q', '-b', 'main'); git('config', 'core.autocrlf', 'false');
writeFileSync(join(REPO, 'a.txt'), 'a\n');
writeFileSync(join(REPO, 'big.txt'), Array.from({ length: 1500 }, (_, i) => `LINE-${String(i).padStart(4, '0')} some filler text to make the line longer than short`).join(NL) + NL);
git('add', '-A'); git('commit', '-q', '-m', 'first');

// the scripted model: when `plan.calls` is set it asks for that many read_file steps (each with a different range, so it is never "the same step three times"), then answers.
const plan = { calls: 0, delay: 0, file: 'big.txt', span: 3 }; let requests = 0;
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
    let body = {}; try { body = JSON.parse(raw); } catch { /* x */ }
    if ((body.messages ?? []).some((m) => m.role === 'user' && /title/i.test(String(m.content).slice(0, 80)) && !body.tools)) { /* a side request */ }
    requests++;
    const done = (body.messages ?? []).filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = (o) => res.write('data: ' + JSON.stringify(o) + NL + NL);
    if (plan.delay) await wait(plan.delay);
    if (body.tools && done < plan.calls) {
      const start = 1 + done * plan.span;
      data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + done, type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: plan.file, start_line: start, end_line: start + plan.span - 1 }) } }] } }] });
      data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else { data({ choices: [{ delta: { content: 'walk answer ' + done } }] }); data({ choices: [{ delta: {}, finish_reason: 'stop' }] }); }
    res.end('data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const bunny = await createApp({ dataDir: DATA, fake: false, secretStore: memorySecretStore(), probe: async () => ({ ok: true, keyVerified: true }), discover: async () => [{ id: 'gpt-4o', displayName: 'GPT 4o', ownedBy: 'x', contextLength: null }], localGuard: true, folderPickerOnly: true });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const local = `http://127.0.0.1:${bunny.server.address().port}`;
const adminJson = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j }; };
const put = (patch) => adminJson('/api/settings', 'PUT', patch);
await bunny.chooseFolder(REPO);
await adminJson('/api/providers/openai/connect', 'POST', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${provider.address().port}/v1` });
await put({ defaultPermissionMode: 'ask' }).catch(() => {});
const mkChat = async (title) => (await adminJson('/api/sessions', 'POST', { title, providerId: 'openai', model: 'gpt-4o', workMode: 'code', folder: REPO })).json;

// run one reply over the API, read the stream as text; stop reading after `capMs` or when the stream ends
async function run(chat, text, capMs = 90000, until = null) {
  requests = 0; const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), capMs); let out = '';
  try {
    const res = await bunny.adminFetch(`/api/sessions/${chat.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac.signal, body: JSON.stringify({ content: text, providerId: 'openai', model: 'gpt-4o', workMode: 'code' }) });
    const reader = res.body.getReader(); const dec = new TextDecoder();
    for (;;) { const { value, done } = await reader.read(); if (done) break; out += dec.decode(value); if (until && until.test(out)) { ac.abort(); break; } }
  } catch { /* aborted */ }
  clearTimeout(timer);
  return { out, requests };
}
const browser = await chromium.launch();
const finish = async (code) => { try { await browser.close(); } catch { /* x */ } try { provider.close(); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed`); console.log('=== FAILED ==='); for (const r of bad) console.log(`${r.id} :: ${r.label} :: ${r.detail}`); process.exit(code ?? (bad.length ? 1 : 0)); };

try {
  // ---------- branch prefix ----------
  for (const prefix of ['qa-prefix', 'other']) {
    await put({ branchPrefix: prefix });
    const chat = await mkChat('Branch ' + prefix);
    const made = await adminJson(`/api/sessions/${chat.id}/worktree`, 'POST');
    check('X-prefix-' + prefix, `Branch prefix "${prefix}": the chat's own copy is on a branch that starts with it`, made.status === 200 && String(made.json?.branch ?? '').startsWith(prefix + '/'), JSON.stringify(made.json)?.slice(0, 160));
  }
  // ---------- steps limit ----------
  await put({ autoContinueSteps: 1, autoContinueMinutes: 120, autoContinueTokens: 50000000 }); plan.calls = 70; plan.delay = 0; plan.span = 3;
  const few = await run(await mkChat('Steps 1'), 'read it all', 120000);
  await put({ autoContinueSteps: 200 });
  const many = await run(await mkChat('Steps 200'), 'read it all', 120000);
  check('X-steps', 'Most steps in one reply: a small limit stops a long job where a large one carries on (requests to the model)', few.requests > 0 && few.requests < many.requests && many.requests >= 60, `limit 1 -> ${few.requests} requests; limit 200 -> ${many.requests}`);
  // ---------- minutes limit ----------
  await put({ autoContinueSteps: 500, autoContinueMinutes: 1 }); plan.delay = 2600; plan.calls = 45;
  const slow = await run(await mkChat('Minutes 1'), 'read it slowly', 170000);
  check('X-minutes', 'Most minutes in one reply: a 1-minute limit stops a slow job at the first extension (about 30 steps) instead of going on to 45', slow.requests > 0 && slow.requests <= 33, `1 minute -> ${slow.requests} requests (without the limit it would be 46)`);
  plan.delay = 0;
  // ---------- token limit ----------
  await put({ autoContinueSteps: 500, autoContinueMinutes: 120, autoContinueTokens: 100000 }); plan.calls = 40; plan.span = 900;
  const tok = await run(await mkChat('Tokens'), 'read big pieces', 90000, /Keep going\?/);
  check('X-tokens', 'Token budget for one reply: past the budget Bunny asks "Keep going?" (the question card)', /Keep going\?|used about/.test(tok.out), tok.out.slice(-200).replace(/\s+/g, ' '));
  await put({ autoContinueTokens: 5000000 });
  // ---------- verbose: whole step results ----------
  const seen = {};
  for (const view of ['normal', 'verbose']) {
    await put({ transcriptView: view }); plan.calls = 1; plan.span = 120; // 120 lines of ~60 characters: about 7,000 characters
    const chat = await mkChat('Verbose ' + view); await run(chat, 'show lines', 60000); plan.calls = 0;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    await page.addInitScript(() => { localStorage.setItem('bunny.modelAuto', '0'); });
    await page.goto(local + '/?s=' + chat.id); await page.waitForTimeout(2500);
    for (const sel of ['.tool-group-line[aria-expanded="false"]', '.tool-call-header[aria-expanded="false"]']) { for (const el of await page.locator(sel).all()) await el.click().catch(() => {}); await page.waitForTimeout(300); }
    await page.waitForTimeout(500);
    seen[view] = await page.evaluate(() => [...document.querySelectorAll('.tool-call-result')].map((e) => (e.textContent.match(/LINE-[0-9]{4}/g) ?? []).length).reduce((a, b) => a + b, 0));
    await ctx.close();
  }
  check('X-verbose', 'Verbose: the whole step result is shown (Normal cuts a long result)', seen.verbose > seen.normal && seen.verbose >= 100, JSON.stringify(seen));
  // ---------- notification ----------
  for (const on of [true, false]) {
    await put({ notifications: on }); plan.calls = 0;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const page = await ctx.newPage();
    await page.addInitScript(() => {
      localStorage.setItem('bunny.modelAuto', '0');
      window.__notes = []; Object.defineProperty(document, 'hidden', { get: () => true });
      window.Notification = class { constructor(t, o) { window.__notes.push({ t, body: o?.body }); } static get permission() { return 'granted'; } static requestPermission() { return Promise.resolve('granted'); } close() {} };
    });
    const chat = await mkChat('Notify ' + on); await page.goto(local + '/?s=' + chat.id); await page.waitForTimeout(1500);
    await page.fill('#input', 'hello'); await page.locator('#send').click(); await page.waitForTimeout(4000);
    const notes = await page.evaluate(() => window.__notes);
    check('X-notify-' + on, `Notifications = ${on}: a finished reply ${on ? 'raises a notification when the window is hidden' : 'raises none'} (stand-in Notification; the OS toast itself is UNKNOWN)`, on ? notes.length >= 1 && /walk answer/.test(notes[0].body ?? '') : notes.length === 0, JSON.stringify(notes).slice(0, 160));
    await ctx.close();
  }
} catch (e) { check('X-run', 'part 3 ran to the end', false, e.stack?.split('\n').slice(0, 3).join(' | ')); }
await finish();

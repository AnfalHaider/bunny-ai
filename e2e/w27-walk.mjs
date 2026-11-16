/**
 * QA walk for W2-7 (permission rules). Invented profile and invented folders only.
 *
 *   SRC=<worktree at the commit under test> OUT=<temp> node e2e/w27-walk.mjs
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const SRC = process.env.SRC, OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f94'; const PORT = +(process.env.PORT0 ?? 5531);
const NL = String.fromCharCode(10);
const rows = [];
const ok = (c, m) => { if (!c) throw new Error(m); };
const row = async (id, name, fn) => {
  let v = 'PASS', note = '';
  try { note = (await fn()) ?? ''; } catch (e) { v = 'FAIL'; note = String(e.message).split(NL)[0]; }
  rows.push({ id, name, verdict: v, note }); console.log(v.padEnd(5), id.padEnd(9), name, '::', String(note).slice(0, 260));
};

// ---- scripted model: the message names a plan ----
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const call = (name, args) => frame({ tool_calls: [{ index: 0, id: `c_${Math.random()}`, function: { name, arguments: JSON.stringify(args) } }] });
const PLAN = {
  'p-rm': ['run_command', { command: 'Remove-Item victim.txt' }],
  'p-rm-lower': ['run_command', { command: 'remove-item victim.txt' }],
  'p-rm-space': ['run_command', { command: '   Remove-Item   victim.txt' }],
  'p-rm-chain': ['run_command', { command: 'echo hi; Remove-Item victim.txt' }],
  'p-rm-sub': ['run_command', { command: 'echo $(Remove-Item victim.txt)' }],
  'p-rm-wrap': ['run_command', { command: 'powershell -NoProfile -Command "Remove-Item victim.txt"' }],
  'p-rm-alias': ['run_command', { command: 'rm victim.txt' }],
  'p-del': ['run_command', { command: 'del victim.txt' }],
  'p-cmd-del': ['run_command', { command: 'cmd /c del victim.txt' }],
  'p-rm-fr': ['run_command', { command: 'rm -Force -Recurse victim.txt' }],
  'p-push-quoted': ['run_command', { command: 'git "push" origin main' }],
  'p-rm-quoted': ['run_command', { command: 'Remove"-Item" victim.txt' }],
  'p-push': ['run_command', { command: 'git push origin main' }],
  'p-npm': ['run_command', { command: 'npm test' }],
  'p-npm-chain': ['run_command', { command: 'npm test; echo hi' }],
  'p-edit': ['edit_file', { path: 'secrets/key.txt', old_text: 'KEY-CONTENT', new_text: 'CHANGED' }],
  'p-write': ['write_file', { path: 'secrets/new.txt', content: 'x\n' }],
  'p-multi': ['multi_edit', { path: 'secrets/key.txt', edits: [{ old_text: 'KEY-CONTENT', new_text: 'CHANGED' }] }],
  'p-edit-dots': ['edit_file', { path: 'src/../secrets/key.txt', old_text: 'KEY-CONTENT', new_text: 'CHANGED' }],
  'p-list': ['list_files', { path: '.' }],
  'p-read': ['read_file', { path: 'secrets/key.txt' }],
  'p-search': ['search_files', { query: 'KEY-CONTENT' }],
  'p-find': ['find_files', { pattern: '**/*.txt' }],
  'p-plan-write': ['write_file', { path: 'src/planned.txt', content: 'x\n' }],
  'p-plan-run': ['run_command', { command: 'echo hi' }],
};
const fake = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
    if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
    const body = JSON.parse(raw); const asked = String([...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    const key = Object.keys(PLAN).sort((a, b) => b.length - a.length).find((k) => asked.includes(k));
    const lastUser = body.messages.map((m) => m.role).lastIndexOf('user'); const done = body.messages.slice(lastUser).filter((m) => m.role === 'tool').length;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end((key && !done ? call(...PLAN[key]) : frame({ content: 'Finished.' })) + 'data: [DONE]\n\n');
  });
});
await new Promise((r) => fake.listen(0, '127.0.0.1', r)); const fport = fake.address().port;

const dataDir = mkdtempSync(join(tmpdir(), 'bunny-w27-data-'));
const proc = spawn('node', ['src/server/main.js'], { cwd: SRC, env: { ...process.env, BUNNY_DATA_DIR: dataDir, BUNNY_FAKE_UPSTREAM: '1', BUNNY_API_TOKEN: TOKEN, PORT: String(PORT) }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}`; const H = { 'content-type': 'application/json', 'x-bunny-token': TOKEN };
for (let i = 0; i < 40; i++) { try { if ((await (await fetch(BASE + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const api = (p, m = 'GET', b) => fetch(BASE + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
ok((await (await api('/api/health')).json()).fake, 'not an invented profile');
const prov = await (await api('/api/providers/custom', 'POST', { name: 'Scripted', baseUrl: `http://127.0.0.1:${fport}/v1` })).json(); const PID = prov.id ?? prov.provider?.id;
await api('/api/settings', 'PUT', { modelFilter: 'all' }); ok(PID, 'no provider id: ' + JSON.stringify(prov));

const setRules = (global = [], folders = {}) => api('/api/permission-rules', 'PUT', { global, folders }).then(async (r) => { ok(r.ok, 'rules refused: ' + (await r.text())); });
const R = (kind, effect, pattern, ops) => ({ kind, effect, pattern, ...(ops ? { ops } : {}) });

function project() {
  const d = mkdtempSync(join(tmpdir(), 'bunny-w27-')); mkdirSync(join(d, 'secrets')); mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'victim.txt'), 'victim' + NL); writeFileSync(join(d, 'secrets', 'key.txt'), 'KEY-CONTENT' + NL); writeFileSync(join(d, 'src', 'ok.txt'), 'fine' + NL);
  writeFileSync(join(d, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { test: 'node -e "console.log(\'TESTED-OK\')"' } }));
  return d;
}
/** One reply in `mode` for `message`; every permission card is answered with `allowCards`. */
async function reply(dir, mode, message, allowCards = false) {
  const s = await (await api('/api/sessions', 'POST', { title: 'w27', providerId: PID, model: 'scripted' })).json();
  const set = (n, v) => api(`/api/sessions/${s.id}/setting/${n}`, 'PATCH', { value: v });
  await set('folder', dir); await set('workMode', 'code'); await set('permissionMode', mode);
  const res = await fetch(`${BASE}/api/sessions/${s.id}/messages`, { method: 'POST', headers: H, body: JSON.stringify({ content: message, providerId: PID, model: 'scripted', workMode: 'code' }) });
  const events = []; const cards = []; let buf = ''; const reader = res.body.getReader(); const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true }); let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2); const name = /^event: (\w+)/m.exec(block)?.[1]; const data = /^data: (.*)$/m.exec(block)?.[1]; if (!name) continue;
      let p = null; try { p = JSON.parse(data); } catch { /* not json */ } events.push(name);
      if (name === 'permission') { cards.push(p); await api(`/api/sessions/${s.id}/permission/${p.id}`, 'POST', { allowed: allowCards }); }
    }
  }
  const saved = await (await api(`/api/sessions/${s.id}`)).json(); const step = saved.messages.filter((m) => m.kind === 'tool_call').at(-1);
  return { id: s.id, events, cards, step, status: step?.status ?? 'none', result: String(step?.result ?? '') };
}
const MODES = [['ask', 'Manual'], ['accept', 'Accept edits'], ['auto', 'Auto']];
const txt = (p) => readFileSync(p, 'utf8');

// ---- Deny a command: Blocked, with the rule name ----
for (const [m, label] of MODES) await row(`D1-${m}`, `${label}: Deny Remove-Item* blocks the delete, shows Blocked with the rule name, no card, file stays`, async () => {
  const d = project(); await setRules([R('command', 'deny', 'Remove-Item*')]);
  const r = await reply(d, m, 'p-rm');
  ok(!r.events.includes('permission'), 'a permission card appeared'); ok(r.status === 'denied', 'status ' + r.status + ': ' + r.result.slice(0, 100)); ok(/Blocked by your permission rule/.test(r.result) && r.result.includes('"Remove-Item*"'), 'no rule name: ' + r.result); ok(existsSync(join(d, 'victim.txt')), 'file was deleted');
  return r.result.slice(0, 90);
});
await row('D1-variants', 'Deny Remove-Item* also blocks: lower case, leading spaces, after ;, inside $( )', async () => {
  const out = []; await setRules([R('command', 'deny', 'Remove-Item*')]);
  for (const k of ['p-rm-lower', 'p-rm-space', 'p-rm-chain', 'p-rm-sub']) { const d = project(); const r = await reply(d, 'auto', k); if (r.status !== 'denied' || !existsSync(join(d, 'victim.txt'))) out.push(`${k}: ${r.status} file=${existsSync(join(d, 'victim.txt'))}`); }
  ok(!out.length, out.join(' ; '));
});
await row('D1-aliases', 'NEW: Deny Remove-Item* also stops rm, del, cmd /c del and rm -Force -Recurse (the file stays, no card), in Manual and Auto', async () => {
  const out = []; await setRules([R('command', 'deny', 'Remove-Item*')]);
  for (const m of ['ask', 'auto']) for (const k of ['p-rm-alias', 'p-del', 'p-cmd-del', 'p-rm-fr']) { const d = project(); const r = await reply(d, m, k); if (r.status !== 'denied' || r.cards.length || !existsSync(join(d, 'victim.txt'))) out.push(`${m}/${k}: ${r.status} cards=${r.cards.length} file=${existsSync(join(d, 'victim.txt'))}`); }
  ok(!out.length, out.join(' ; '));
});
await row('D1-quoted', 'NEW (8e42b6a): Remove"-Item" victim.txt (quotes inside the word) is denied like Remove-Item, in Manual and Auto; file stays, no card', async () => {
  const out = []; await setRules([R('command', 'deny', 'Remove-Item*')]);
  for (const m of ['ask', 'auto']) { const d = project(); const r = await reply(d, m, 'p-rm-quoted'); if (r.status !== 'denied' || r.cards.length || !existsSync(join(d, 'victim.txt'))) out.push(m + ': ' + r.status + ' cards=' + r.cards.length + ' file=' + existsSync(join(d, 'victim.txt'))); }
  ok(!out.length, out.join(' ; '));
});
await row('A1-quoted', 'NEW (8e42b6a): git "push" origin main (quotes inside the word) still raises the Ask card for git push*, in Manual, Accept edits and Auto', async () => {
  const out = []; await setRules([R('command', 'ask', 'git push*')]);
  for (const m of ['ask', 'accept', 'auto']) { const d = project(); const r = await reply(d, m, 'p-push-quoted', false); if (r.cards.length !== 1 || r.status === 'done') out.push(m + ': cards=' + r.cards.length + ' status=' + r.status); }
  ok(!out.length, out.join(' ; '));
});
await row('D1-wrap', 'INFO: Remove-Item inside a powershell -Command wrapper (prefix rules do not look inside another program)', async () => {
  await setRules([R('command', 'deny', 'Remove-Item*')]); const d = project(); const r = await reply(d, 'auto', 'p-rm-wrap'); return `status ${r.status}; file still there: ${existsSync(join(d, 'victim.txt'))} (W2-7b says wrappers are judged: now ${r.status === 'denied' ? 'BLOCKED' : 'not blocked'})`;
});

// ---- Ask: Auto still asks ----
for (const [m, label] of MODES) await row(`A1-${m}`, `${label}: Ask git push* raises a card (answered No: nothing runs)`, async () => {
  const d = project(); await setRules([R('command', 'ask', 'git push*')]); const r = await reply(d, m, 'p-push', false);
  ok(r.cards.length === 1, `cards ${r.cards.length}`); ok(r.status !== 'done', 'ran anyway: ' + r.status); return `card: ${JSON.stringify(r.cards[0]).slice(0, 160)}`;
});
await row('A1-text', 'the Ask card names the rule that asked', async () => {
  const d = project(); await setRules([R('command', 'ask', 'git push*')]); const r = await reply(d, 'auto', 'p-push', false); const t = JSON.stringify(r.cards[0] ?? {}); ok(/git push\*/.test(t) && /rule/i.test(t), 'card: ' + t.slice(0, 200)); return t.slice(0, 160);
});

// ---- Allow: Manual runs npm test without asking, a chained command still asks ----
for (const [m, label] of MODES.slice(0, 2)) {
  await row(`W1-${m}`, `${label}: Allow npm test* runs "npm test" without a card`, async () => {
    const d = project(); await setRules([R('command', 'allow', 'npm test*')]); const r = await reply(d, m, 'p-npm', false);
    ok(r.cards.length === 0, 'asked anyway: ' + JSON.stringify(r.cards[0] ?? {}).slice(0, 100)); ok(r.status === 'done' && /TESTED-OK/.test(r.result), `status ${r.status}: ${r.result.slice(0, 100)}`);
  });
  await row(`W2-${m}`, `${label}: "npm test; echo hi" still asks`, async () => {
    const d = project(); await setRules([R('command', 'allow', 'npm test*')]); const r = await reply(d, m, 'p-npm-chain', false); ok(r.cards.length === 1, `cards ${r.cards.length}`); ok(r.status !== 'done', 'ran: ' + r.status);
  });
}
await row('W0-control', 'without the Allow rule Manual asks for "npm test" (so the Allow is what removed the card)', async () => {
  const d = project(); await setRules([]); const r = await reply(d, 'ask', 'p-npm', false); ok(r.cards.length === 1, `cards ${r.cards.length}`);
});

// ---- path rules ----
for (const [m, label] of MODES) await row(`P1-${m}`, `${label}: Deny edits on secrets/** refuses edit_file, write_file, multi_edit and a ..-spelled path; nothing changes`, async () => {
  const d = project(); await setRules([R('path', 'deny', 'secrets/**', 'edits')]); const out = [];
  for (const k of ['p-edit', 'p-write', 'p-multi', 'p-edit-dots']) { const r = await reply(d, m, k, true); if (r.status !== 'denied' || !/Blocked by your permission rule/.test(r.result)) out.push(`${k}: ${r.status} ${r.result.slice(0, 60)}`); if (r.cards.length) out.push(`${k}: card`); }
  ok(txt(join(d, 'secrets', 'key.txt')).includes('KEY-CONTENT'), 'key.txt changed'); ok(!existsSync(join(d, 'secrets', 'new.txt')), 'new.txt created'); ok(!out.length, out.join(' ; '));
});
for (const [m, label] of MODES.slice(0, 1)) await row(`P2-${m}`, `${label}: Deny reads on secrets/** hides the folder from list_files, find_files and search_files, and read_file is refused`, async () => {
  const d = project(); await setRules([R('path', 'deny', 'secrets/**', 'reads'), R('path', 'deny', 'secrets', 'reads')]); const out = [];
  const l = await reply(d, m, 'p-list', true); if (/secrets/.test(l.result)) out.push('list shows secrets: ' + l.result.replace(/\s+/g, ' ').slice(0, 80));
  const f = await reply(d, m, 'p-find', true); if (/secrets/.test(f.result)) out.push('find shows secrets');
  const s = await reply(d, m, 'p-search', true); if (/KEY-CONTENT/.test(s.result)) out.push('search found the secret text');
  const rd = await reply(d, m, 'p-read', true); if (/KEY-CONTENT/.test(rd.result) || rd.status === 'done') out.push(`read: ${rd.status} ${rd.result.slice(0, 60)}`);
  ok(!out.length, out.join(' ; ')); return `list: ${l.result.replace(/\s+/g, ' ').slice(0, 60)}; read: ${rd.status} ${rd.result.slice(0, 60)}`;
});
await row('P3', 'Files pane route also hides a read-denied folder (INFO if shown)', async () => {
  const d = project(); await setRules([R('path', 'deny', 'secrets/**', 'reads')]); const r = await reply(d, 'ask', 'p-list', true);
  const t = await (await api(`/api/sessions/${r.id}/files?path=`)).text(); const shown = /"secrets"/.test(t); const inside = await api(`/api/sessions/${r.id}/file?path=secrets/key.txt`); const it = await inside.text();
  return `folder listed in the Files pane: ${shown}; file route ${inside.status} leaks content: ${/KEY-CONTENT/.test(it)} (the rule is documented for Bunny's own tools; recorded, not graded)`;
});

// ---- Plan mode wins ----
await row('PL1', 'Plan mode: an Allow rule for edits and for commands does not let them through', async () => {
  const d = project(); await setRules([R('path', 'allow', 'src/**', 'edits'), R('command', 'allow', 'echo*')]);
  const w = await reply(d, 'plan', 'p-plan-write', true); const c = await reply(d, 'plan', 'p-plan-run', true);
  ok(!existsSync(join(d, 'src', 'planned.txt')), 'file written in Plan mode'); ok(w.status !== 'done' && c.status !== 'done', `write ${w.status}; run ${c.status}`); ok(!w.events.includes('permission') && !c.events.includes('permission'), 'a card appeared'); return `write: ${w.status} ${w.result.slice(0, 60)}; run: ${c.status} ${c.result.slice(0, 60)}`;
});

// ---- the screen ----
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: BASE }); const page = await ctx.newPage(); page.on('dialog', (d) => d.accept());
await setRules();
const openRules = async () => { await page.goto('/src/ui/settings.html'); await page.locator('#perm-rules').waitFor({ timeout: 10000 }); };
const add = async (kind, pattern, effect) => { await page.locator('#rules-kind').selectOption(kind); await page.locator('#rules-pattern').fill(pattern); await page.locator('#rules-effect').selectOption(effect); await page.locator('#rules-add-btn').click(); await page.waitForTimeout(400); };
await row('U1', 'screen: add a Deny for Remove-Item* through the screen, then a Manual chat is Blocked with that rule name', async () => {
  await openRules(); await add('command', 'Remove-Item*', 'deny'); await page.screenshot({ path: `${OUT}/w27-rules.png` });
  ok((await page.locator('#rules-lists .rl.deny .pat').innerText()).trim() === 'Remove-Item*', 'rule not listed');
  const d = project(); const r = await reply(d, 'ask', 'p-rm'); ok(r.status === 'denied' && r.result.includes('"Remove-Item*"') && existsSync(join(d, 'victim.txt')), `${r.status}: ${r.result.slice(0, 90)}`);
});
await row('U2', 'screen: add an Allow npm test* and an Ask git push* and a path Deny secrets/**; all three land in the right lists and survive reload', async () => {
  await add('command', 'npm test*', 'allow'); await add('command', 'git push*', 'ask'); await add('path:edits', 'secrets/**', 'deny'); await page.reload(); await page.locator('#perm-rules').waitFor(); await page.waitForTimeout(900);
  const t = await page.evaluate(() => ({ deny: [...document.querySelectorAll('#rules-lists .rl.deny .pat')].map((e) => e.textContent), ask: [...document.querySelectorAll('#rules-lists .rl.ask .pat')].map((e) => e.textContent), allow: [...document.querySelectorAll('#rules-lists .rl.allow .pat')].map((e) => e.textContent) }));
  ok(t.deny.includes('secrets/**') && t.deny.includes('Remove-Item*') && t.ask.includes('git push*') && t.allow.includes('npm test*'), JSON.stringify(t)); return JSON.stringify(t);
});
await row('U3', 'Try a command: shows the outcome and rule, and runs nothing (no file made, no file deleted)', async () => {
  const d = project(); await api('/api/permission-rules', 'PUT', { global: [R('command', 'allow', 'New-Item*'), R('command', 'deny', 'Remove-Item*')], folders: {} }); await openRules();
  const out = page.locator('#rules-try-out'); const made = [join(SRC, 'made-by-try.txt'), join(d, 'made-by-try.txt'), join(process.cwd(), 'made-by-try.txt')];
  await page.locator('#rules-try').fill('New-Item made-by-try.txt'); await page.waitForTimeout(500); const a = (await out.innerText()).replace(/\s+/g, ' ');
  await page.locator('#rules-try').fill('Remove-Item victim.txt'); await page.waitForTimeout(500); const b = (await out.innerText()).replace(/\s+/g, ' ');
  await page.screenshot({ path: `${OUT}/w27-try.png` });
  ok(/Allowed/.test(a), 'allow outcome: ' + a); ok(/Denied/.test(b) && /Remove-Item\*/.test(b), 'deny outcome: ' + b); ok(!made.some(existsSync), 'Try created a file'); ok(existsSync(join(d, 'victim.txt')), 'victim deleted');
  const res = await (await api('/api/permission-rules/try', 'POST', { command: 'New-Item made-by-try.txt' })).json(); ok(res.outcome === 'allow', 'api outcome ' + JSON.stringify(res)); ok(!made.some(existsSync), 'API try created a file'); return `${a} | ${b}`;
});
await row('U4', 'conflict warning: an Allow already covered by a Deny shows which Deny covers it', async () => {
  await api('/api/permission-rules', 'PUT', { global: [], folders: {} }); await openRules(); await add('command', 'Remove-Item -Recurse*', 'deny'); await add('command', 'Remove-Item -Recurse build', 'allow');
  const line = (await page.locator('#rules-line').innerText()).trim(); await page.screenshot({ path: `${OUT}/w27-warning.png` }); ok(/Deny rule already covers this/.test(line) && /Remove-Item -Recurse\*/.test(line), 'line: ' + line); return line;
});
await row('U5', 'bad patterns are refused on the line and nothing is saved: leaves the folder, absolute, drive, ~, empty, too long', async () => {
  await api('/api/permission-rules', 'PUT', { global: [], folders: {} }); await openRules(); const out = []; const seen = [];
  for (const [pat, want] of [['..\\secrets\\**', /cannot leave the folder/], ['/etc/**', /relative to the folder/], ['C:\\x\\**', /relative to the folder/], ['~/x', /relative to the folder/], ['', /Type a pattern/], ['a/' + '*'.repeat(13), /too many/]]) {
    await add('path:edits', pat, 'deny'); const line = (await page.locator('#rules-line').innerText()).trim(); seen.push(line.slice(0, 50)); if (!want.test(line)) out.push(`"${pat.slice(0, 12)}": ${line}`);
  }
  const saved = await (await api('/api/permission-rules')).json(); if (saved.global.length) out.push('something was saved: ' + JSON.stringify(saved.global));
  await page.screenshot({ path: `${OUT}/w27-badpattern.png` }); ok(!out.length, out.join(' ; ')); return seen.join(' | ');
});
await row('U6', 'DEFECT CHECK: the server refuses a bad rule list with 400 AND keeps the saved rules (direct API call)', async () => {
  await api('/api/permission-rules', 'PUT', { global: [R('command', 'ask', 'git push*')], folders: {} }); const r = await api('/api/permission-rules', 'PUT', { global: [R('path', 'deny', '../x', 'edits')], folders: {} }); ok(r.status === 400, 'status ' + r.status);
  const now = await (await api('/api/permission-rules')).json(); ok(now.global.length === 1 && now.global[0].pattern === 'git push*', 'old rules lost: ' + JSON.stringify(now.global)); return (await r.text()).slice(0, 100);
});
await row('U7', 'phone: no sideways scroll, add button reachable', async () => {
  await page.setViewportSize({ width: 390, height: 800 }); await openRules(); const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth); await page.screenshot({ path: `${OUT}/w27-phone.png` });
  ok(!wide, 'sideways scroll'); ok(await page.locator('#rules-add-btn').isVisible(), 'add button hidden');
});
await row('U8', 'NEW: a rule-Blocked step is labelled Blocked in amber (not red Failed), group and step, and the Ask prompt wraps long lines on a phone', async () => {
  await setRules([R('command', 'deny', 'Remove-Item*'), R('command', 'ask', 'git push*')]); const d = project(); const r = await reply(d, 'ask', 'p-rm');
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto(`/src/ui/index.html?s=${r.id}`); await page.waitForSelector('#messages .tool-group-line, #messages .tool-call'); await page.waitForTimeout(600);
  const hue = (c) => { const [r1, g, b] = c.match(/[0-9.]+/g).map(Number).slice(0, 3); const mx = Math.max(r1, g, b), mn = Math.min(r1, g, b); if (mx === mn) return -1; const dlt = mx - mn; let h = mx === r1 ? ((g - b) / dlt) % 6 : mx === g ? (b - r1) / dlt + 2 : (r1 - g) / dlt + 4; h *= 60; return h < 0 ? h + 360 : h; };
  const grp = page.locator('.tool-group-meta.is-blocked').first(); const gtext = (await grp.innerText()).trim(); const gcol = await grp.evaluate((e) => getComputedStyle(e).color); await page.locator('.tool-group-line').first().click().catch(() => {});
  const tag = page.locator('.tag.is-blocked').first(); const ttext = await tag.count() ? (await tag.innerText()).trim() : '(none)'; const tcol = await tag.count() ? await tag.evaluate((e) => getComputedStyle(e).color) : 'none';
  await page.screenshot({ path: `${OUT}/w27-blocked-amber.png` });
  ok(/Blocked/.test(gtext), 'group label: ' + gtext); ok(hue(gcol) >= 25 && hue(gcol) <= 55, `group colour ${gcol} hue ${Math.round(hue(gcol))}`); if (ttext !== '(none)') { ok(/Blocked/.test(ttext) && hue(tcol) >= 25 && hue(tcol) <= 55, `step tag ${ttext} ${tcol}`); }
  const failed = await page.locator('.tool-group-meta.is-failed, .tag.is-failed').count(); ok(failed === 0, 'a red Failed label is also shown for the blocked step');
  await page.setViewportSize({ width: 390, height: 844 }); const d2 = project(); const r2 = await reply(d2, 'auto', 'p-push', false);
  return `group "${gtext}" ${gcol} (hue ${Math.round(hue(gcol))}); step tag "${ttext}" ${tcol}; ask card detail: ${String(r2.cards[0]?.detail).slice(0, 70)}`;
});
// ---- the desktop build: the same server started the way Electron starts it (folderPickerOnly) ----
const DPORT = PORT + 50; const DTOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f99'; const DH = { 'content-type': 'application/json', 'x-bunny-token': DTOKEN };
const desk = spawn('node', ['e2e/w27-desktop-server.mjs'], { env: { ...process.env, SRC: process.env.SRC, DATA: mkdtempSync(join(tmpdir(), 'bunny-w27d-data-')), PORT: String(DPORT), TOKEN: DTOKEN, BUNNY_FAKE_UPSTREAM: '1' }, stdio: 'ignore' });
const DB = 'http://127.0.0.1:' + DPORT; for (let i = 0; i < 60; i++) { try { if ((await (await fetch(DB + '/api/health')).json()).fake) break; } catch { /* wait */ } await new Promise((r) => setTimeout(r, 250)); }
const dget = (p) => fetch(DB + p, { headers: DH }); const dsend = (p, m, b) => fetch(DB + p, { method: m, headers: DH, body: JSON.stringify(b) });
const viaMain = async (path, method, body) => { const r = await fetch('http://127.0.0.1:' + (DPORT + 1000), { method: 'POST', body: JSON.stringify({ path, method, body }) }); return r.json(); };
const deskSess = await (await dsend('/api/sessions', 'POST', { title: 'desk', providerId: 'x', model: 'm' })).json();
await row('DK1', 'NEW desktop build: PUT /api/permission-rules over HTTP with the page token is 403 (Change this in the window) and nothing is saved', async () => {
  const r = await dsend('/api/permission-rules', 'PUT', { global: [R('command', 'deny', 'rm *')], folders: {} }); const b = await r.json(); ok(r.status === 403, 'status ' + r.status); ok(b.code === 'request.windowOnly' && b.message === "Change this in Bunny's window.", JSON.stringify(b));
  const now = await (await dget('/api/permission-rules')).json(); ok(!now.global.length, 'rule was saved: ' + JSON.stringify(now)); return JSON.stringify(b);
});
await row('DK2', 'NEW desktop build: the default permission mode and the rules key in /api/settings are 403; other settings still save', async () => {
  const out = []; for (const body of [{ defaultPermissionMode: 'auto' }, { permissionRules: { global: [] } }, { theme: 'dark', defaultPermissionMode: 'ask' }]) { const r = await dsend('/api/settings', 'PUT', body); if (r.status !== 403) out.push(JSON.stringify(body) + ' -> ' + r.status); }
  const okSet = await dsend('/api/settings', 'PUT', { displayName: 'Someone' }); if (okSet.status !== 200) out.push('displayName -> ' + okSet.status); const cur = await (await dget('/api/settings')).json(); if (cur.defaultPermissionMode === 'auto') out.push('mode changed anyway');
  ok(!out.length, out.join(' ; '));
});
await row('DK3', 'NEW desktop build: the permission mode of a chat is 403 over HTTP (stays as it was); effort still changes', async () => {
  const before = (await (await dget('/api/sessions/' + deskSess.id)).json()).permissionMode; const r = await fetch(DB + '/api/sessions/' + deskSess.id + '/setting/permissionMode', { method: 'PATCH', headers: DH, body: JSON.stringify({ value: 'auto' }) }); ok(r.status === 403, 'status ' + r.status);
  const after = (await (await dget('/api/sessions/' + deskSess.id)).json()).permissionMode; ok(after === before, 'mode changed ' + before + ' -> ' + after);
  const e = await fetch(DB + '/api/sessions/' + deskSess.id + '/setting/effort', { method: 'PATCH', headers: DH, body: JSON.stringify({ value: 'high' }) }); ok(e.status === 200, 'effort ' + e.status);
});
await row('DK4', 'NEW desktop build: the same changes made as the main process (admin secret) succeed; Try a command and reading rules work over plain HTTP', async () => {
  const a = await viaMain('/api/permission-rules', 'PUT', { global: [R('command', 'deny', 'rm *')], folders: {} }); ok(a.status === 200, 'rules via main ' + a.status + ' ' + a.body.slice(0, 80));
  const b = await viaMain('/api/sessions/' + deskSess.id + '/setting/permissionMode', 'PATCH', { value: 'ask' }); ok(b.status === 200, 'mode via main ' + b.status + ' ' + b.body.slice(0, 80));
  const got = await (await dget('/api/permission-rules')).json(); ok(got.global.length === 1, 'not saved'); const t = await (await dsend('/api/permission-rules/try', 'POST', { command: 'rm x' })).json(); ok(t.outcome === 'deny', 'try: ' + JSON.stringify(t)); return 'saved via main; try says ' + t.outcome;
});
await row('DK5', 'desktop build: the window own Settings screen can still save rules (needs the Electron preload)', async () => { throw new Error('UNKNOWN: not rehearsable without the Electron shell; the page routes through window.bunnyDesktop (src/ui/api.js)'); });
try { execFileSync('taskkill', ['/PID', String(desk.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* gone */ }
await row('U9', 'NEW (8e42b6a): on a phone the Ask prompt detail wraps (no cut-off, no sideways scroll), light and dark', async () => {
  await setRules([R('command', 'ask', 'git push*')]); const out = []; const seen = [];
  for (const scheme of ['light', 'dark']) {
    const d = project(); const s = await (await api('/api/sessions', 'POST', { title: 'wrap', providerId: PID, model: 'offline/bunny-code' })).json();
    for (const [n, v] of [['folder', d], ['workMode', 'code'], ['permissionMode', 'auto']]) await api('/api/sessions/' + s.id + '/setting/' + n, 'PATCH', { value: v });
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, baseURL: BASE }); const p2 = await ctx2.newPage();
    await p2.goto('/'); await p2.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); }); await p2.goto('/src/ui/index.html?s=' + s.id); await p2.waitForSelector('#input'); await p2.waitForTimeout(600);
    if (!(await p2.locator('#picker-button').innerText()).includes('bunny-code')) { await p2.locator('#picker-button').click(); await p2.locator('.picker-panel .picker-item:not(.picker-auto)').first().click(); }
    await p2.locator('#input').fill('p-push'); await p2.locator('#send').click(); await p2.waitForSelector('.permission-prompt', { timeout: 15000 }); await p2.waitForTimeout(400);
    const m = await p2.evaluate(() => { const card = document.querySelector('.permission-prompt'); const pre = card.querySelector('pre'); const code = card.querySelector('code'); const cr = card.getBoundingClientRect(); const lines = (code?.innerText ?? '').split(String.fromCharCode(10)); return { cardRight: Math.round(cr.right), vw: innerWidth, preScroll: pre ? pre.scrollWidth - pre.clientWidth : 0, codeScroll: code ? code.scrollWidth - code.clientWidth : 0, wide: document.documentElement.scrollWidth > document.documentElement.clientWidth, ws: code ? getComputedStyle(code).whiteSpace : '', text: lines.join(' | ').slice(0, 120), preH: pre ? Math.round(pre.getBoundingClientRect().height) : 0 }; });
    await p2.screenshot({ path: OUT + '/w27-ask-phone-' + scheme + '.png' }); seen.push(scheme + ' ' + JSON.stringify(m));
    if (m.wide || m.preScroll > 1 || m.codeScroll > 1 || m.cardRight > m.vw + 1) out.push(scheme + ': ' + JSON.stringify(m));
    await p2.getByRole('button', { name: 'Deny' }).click().catch(() => {}); await p2.waitForTimeout(500); await ctx2.close();
  }
  ok(!out.length, out.join(' ; ')); return seen.join(' || ');
});
await browser.close(); proc.kill(); fake.close(); await setRules().catch(() => {});
writeFileSync(`${OUT}/w27.json`, JSON.stringify(rows, null, 1));
console.log(`${NL}${rows.filter((r) => r.verdict === 'PASS').length} PASS / ${rows.filter((r) => r.verdict === 'FAIL').length} FAIL of ${rows.length}`);
process.exit(0);

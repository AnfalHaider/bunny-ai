/**
 * QA, v0.1.9 W6-16 on the candidate head: skills, connectors and plugins limited to folders ("Only in: ..." in Customize).
 * Desktop-style app (folderPickerOnly: only chosen folders and window-only writes), invented folders, a scripted OpenAI-style model, an invented local MCP
 * connector, and the real Customize page in Chromium. No network.
 *   node e2e/w019-w616.mjs
 */
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp } = await imp('test/helpers.js'); const { startHttpMcp } = await imp('e2e/w411b-http.mjs');
const NL = String.fromCharCode(10); const j = { 'content-type': 'application/json' };
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : ''}`); };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const work = mkdtempSync(join(tmpdir(), 'bunny-w019-w616-')); const A = join(work, 'projA'); const A2 = join(work, 'projA2'); const SUB = join(A, 'src'); const B = join(work, 'projB'); const C = join(work, 'notchosen');
for (const d of [A, A2, SUB, B, C]) mkdirSync(d, { recursive: true });

// ---- scripted model
const seen = []; let next = () => ({ kind: 'text', text: 'ok' });
const up = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
  if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
  const b = JSON.parse(raw); seen.push(b); const r = next(b, seen.length); res.writeHead(200, { 'content-type': 'text/event-stream' }); const fr = (d) => 'data: ' + JSON.stringify({ choices: [{ delta: d }] }) + NL + NL;
  if (r.kind === 'tool') res.write(fr({ tool_calls: [{ index: 0, id: 'c' + seen.length, function: { name: r.name, arguments: JSON.stringify(r.args ?? {}) } }] })); else res.write(fr({ content: r.text ?? 'ok' }));
  res.end('data: [DONE]' + NL + NL); }); });
await new Promise((r) => up.listen(0, '127.0.0.1', r)); cleanups.push(() => new Promise((r) => { up.closeAllConnections?.(); up.close(r); }));
const mcpServer = await startHttpMcp({ tools: ['ping'] }); cleanups.push(async () => mcpServer.close());

const { app, base } = await startApp(t, { fake: false, folderPickerOnly: true });
const admin = (path, init = {}) => app.adminFetch(path, { ...init, headers: { ...(init.headers ?? {}), ...j } });
for (const f of [A, A2, SUB, B]) await app.chooseFolder(f); // as if the person picked them in the native dialog (C is never chosen)
await fetch(`${base}/api/providers/openai/connect`, { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${up.address().port}/v1` }) }).then(async (r) => { if (r.status === 403) await admin('/api/providers/openai/connect', { method: 'POST', body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${up.address().port}/v1` }) }); });
const chat = async (folder, text, answer = true) => {
  const s = await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: j, body: JSON.stringify({ title: 'w616' }) })).json();
  if (folder) { const r = await admin(`/api/sessions/${s.id}/setting/folder`, { method: 'PATCH', body: JSON.stringify({ value: folder }) }); if (!r.ok) throw new Error('folder setting refused ' + r.status); }
  await admin(`/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', body: JSON.stringify({ value: 'auto' }) });
  seen.length = 0; const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: text, providerId: 'openai', model: 'gpt-4o', workMode: folder ? 'code' : 'chat' }) });
  let out = ''; const dec = new TextDecoder(); for await (const c of res.body) { const part = dec.decode(c, { stream: true }); out += part; for (const m of part.matchAll(new RegExp('event: permission' + NL + 'data: (.*)', 'g'))) { const d = JSON.parse(m[1]); await fetch(`${base}/api/sessions/${s.id}/permission/${d.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: answer }) }); } }
  return { out, bodies: [...seen] };
};
const sysText = (bodies) => bodies.flatMap((b) => b.messages.filter((m) => m.role === 'system' || (m.role === 'user' && /^Each block below/.test(String(m.content)))).map((m) => String(m.content))).join(NL);

// ---- a skill and a connector, then limit them to folder A (window-only writes)
const skill = await (await admin('/api/skills', { method: 'POST', body: JSON.stringify({ name: 'carrot-lore', description: 'about carrots', instructions: 'CARROTLORE-SECRET-INSTRUCTION: carrots are orange.', enabled: true }) })).json();
const conn = await (await admin('/api/mcp', { method: 'POST', body: JSON.stringify({ name: 'scoped', url: mcpServer.url, enabled: true }) })).json();
await fetch(`${base}/api/mcp/${conn.id}/tools`).then((r) => r.json()).catch(() => {});
const plain = await fetch(`${base}/api/skills/${skill.id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ folders: [A] }) });
check('F0', 'limiting a skill to a folder needs the window: a plain request with only the token is refused (403)', plain.status === 403, `HTTP ${plain.status}`);
const notChosen = await admin(`/api/skills/${skill.id}`, { method: 'PATCH', body: JSON.stringify({ folders: [C] }) });
check('F1', 'a folder the person never chose in the picker cannot be used (refused with a plain message)', notChosen.status >= 400 && /folder picker/i.test(JSON.stringify(await notChosen.json().catch(() => ({})))), `HTTP ${notChosen.status}`);
const okSkill = await admin(`/api/skills/${skill.id}`, { method: 'PATCH', body: JSON.stringify({ folders: [A] }) });
const okConn = await admin(`/api/mcp/${conn.id}`, { method: 'PATCH', body: JSON.stringify({ folders: [A] }) });
check('F2', 'a chosen folder is accepted for a skill and for a connector (200)', okSkill.status === 200 && okConn.status === 200, `skill ${okSkill.status}, connector ${okConn.status}`);
const skills = await (await fetch(`${base}/api/skills`)).json(); const stored = skills.find((s) => s.id === skill.id);
check('F3', 'the saved limit is the real folder path', Array.isArray(stored.folders) && stored.folders.length === 1 && stored.folders[0].toLowerCase().endsWith('proja'), JSON.stringify(stored.folders));

// ---- the skill reaches only chats in folder A (and inside it)
for (const [label, folder, expect] of [['in folder A', A, true], ['in a subfolder of A', SUB, true], ['in folder B', B, false], ['in A2 (a name that only STARTS like A)', A2, false], ['with no folder at all', null, false]]) {
  const r = await chat(folder, 'hello there');
  const has = /CARROTLORE-SECRET-INSTRUCTION|carrot-lore/.test(sysText(r.bodies)) || /CARROTLORE-SECRET-INSTRUCTION/.test(JSON.stringify(r.bodies[0]?.messages ?? []));
  check(`S-${label}`, `the skill's words ${expect ? 'ARE' : 'are NOT'} in a chat ${label}`, has === expect, `skill text present: ${has}`);
}
// ---- read_skill by name in the wrong folder is refused with the plain answer; in the right folder it works
next = (b, n) => (n === 1 ? { kind: 'tool', name: 'read_skill', args: { name: 'carrot-lore' } } : { kind: 'text', text: 'saw: ' + String(b.messages.at(-1).content).slice(0, 120) });
const rsB = await chat(B, 'use the carrot-lore skill'); const rsA = await chat(A, 'use the carrot-lore skill');
const toolB = String(rsB.bodies.at(-1)?.messages.at(-1)?.content ?? ''); const toolA = String(rsA.bodies.at(-1)?.messages.at(-1)?.content ?? '');
check('S-read-B', 'read_skill for the skill in folder B is refused with the same plain answer as a skill that does not exist (it does not reveal the skill)', /no skill called/i.test(toolB) && !/CARROTLORE-SECRET/.test(toolB), toolB.slice(0, 160));
check('S-read-A', 'read_skill in folder A returns the instructions', /CARROTLORE-SECRET-INSTRUCTION/.test(toolA), toolA.slice(0, 120));
// ---- the connector: offered only in A; a call by name from B is refused
next = () => ({ kind: 'text', text: 'ok' });
const cA = await chat(A, 'hello'); const cB = await chat(B, 'hello');
const names = (bodies) => [...new Set(bodies.flatMap((b) => (b.tools ?? []).map((d) => d.function.name)))];
check('K-offer', 'the connector\'s tool is offered in a chat in folder A and NOT offered in folder B', names(cA.bodies).some((n) => /scoped__ping/.test(n)) && !names(cB.bodies).some((n) => /scoped__ping/.test(n)), `A: ${names(cA.bodies).filter((n) => /ping/.test(n))}; B: ${names(cB.bodies).filter((n) => /ping/.test(n)) || 'none'}`);
next = (b, n) => (n === 1 ? { kind: 'tool', name: 'scoped__ping', args: {} } : { kind: 'text', text: 'result: ' + String(b.messages.at(-1).content).slice(0, 140) });
const callB = await chat(B, 'call the connector ping'); const toolRes = String(callB.bodies.at(-1)?.messages.at(-1)?.content ?? '');
check('K-call-B', 'a model that calls scoped__ping by name from folder B is refused and the connector is not reached', /not available|no tool called|There is no tool/i.test(toolRes) && !mcpServer.log.some((l) => l.method === 'tools/call'), toolRes.slice(0, 160));
const callA = await chat(A, 'call the connector ping'); const toolResA = String(callA.bodies.at(-1)?.messages.at(-1)?.content ?? '');
check('K-call-A', 'the same call from folder A reaches the connector', mcpServer.log.some((l) => l.method === 'tools/call'), toolResA.slice(0, 140));
// call_connector_tool path (the two small tools used when there are too many tools)
next = (b, n) => (n === 1 ? { kind: 'tool', name: 'call_connector_tool', args: { connector: 'scoped', tool: 'ping', arguments: {} } } : { kind: 'text', text: 'r: ' + String(b.messages.at(-1).content).slice(0, 140) });
const before = mcpServer.log.filter((l) => l.method === 'tools/call').length; const viaB = await chat(B, 'use call_connector_tool'); const after = mcpServer.log.filter((l) => l.method === 'tools/call').length;
check('K-via-B', 'call_connector_tool from folder B does not reach the connector either', after === before, `calls ${before} -> ${after}; ${String(viaB.bodies.at(-1)?.messages.at(-1)?.content ?? '').slice(0, 120)}`);

// ---- the Customize page shows "Only in: ..." and "Everywhere"
const browser = await chromium.launch();
for (const [scheme, width] of [['light', 1100], ['dark', 1100], ['light', 390]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, baseURL: base }); const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('/src/ui/customize.html?embed=1'); await page.waitForTimeout(1200);
  const skillsTab = page.locator('.cz-tab[data-kind="skills"]'); if (await skillsTab.count()) await skillsTab.click().catch(() => {}); await page.waitForTimeout(500);
  const label = (await page.locator('.cz-scope-label').allInnerTexts()).join(' | ');
  const geo = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, col: (() => { const e = document.querySelector('.cz-scope-label'); if (!e) return null; const c = getComputedStyle(e); const bgOf = (x) => { for (; x; x = x.parentElement) { const b = getComputedStyle(x).backgroundColor; const m = b.match(/[\d.]+/g); if (m && (m.length < 4 || Number(m[3]) > 0.5)) return b; } return 'rgb(255,255,255)'; }; return [c.color, bgOf(e)]; })() }));
  const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number); let ratio = null; if (geo.col) { const [x, y] = [lum(parse(geo.col[0])), lum(parse(geo.col[1]))].sort((p, q) => q - p); ratio = (x + 0.05) / (y + 0.05); }
  await page.screenshot({ path: join(work, `customize-${scheme}-${width}.png`), fullPage: true });
  check(`U-${scheme}-${width}`, `Customize ${scheme} ${width}px: the skill row says "Only in: projA", no page overflow, label readable (4.5:1), no page error`, /Only in: projA/.test(label) && !geo.over && (ratio === null || ratio >= 4.5) && errs.length === 0, `labels: ${label}; ratio ${ratio?.toFixed(2)}; overflow ${geo.over}; ${errs.join('|')}`);
  if (scheme === 'light' && width === 1100) {
    const connTab = page.locator('.cz-tab[data-kind="connectors"]'); if (await connTab.count()) await connTab.click().catch(() => {}); await page.waitForTimeout(600);
    const l2 = (await page.locator('.cz-scope-label').allInnerTexts()).join(' | '); check('U-conn', 'the connector row says "Only in: projA" too', /Only in: projA/.test(l2), l2);
  }
  await ctx.close();
}
await browser.close();
// take the limit off: everywhere again, in every folder
const clear = await admin(`/api/skills/${skill.id}`, { method: 'PATCH', body: JSON.stringify({ folders: [] }) }); next = () => ({ kind: 'text', text: 'ok' });
const rB = await chat(B, 'hello again'); check('E1', 'taking the limit off (an empty list) needs no folder check and makes the skill available everywhere again', clear.status === 200 && /CARROTLORE-SECRET-INSTRUCTION|carrot-lore/.test(sysText(rB.bodies) + JSON.stringify(rB.bodies[0]?.messages ?? [])), `HTTP ${clear.status}`);
for (const f of cleanups.reverse()) { try { await f(); } catch { /* x */ } }
const bad = rows.filter((x) => !x.ok); console.log(NL + (rows.length - bad.length) + ' of ' + rows.length + ' passed; pictures in ' + work); process.exit(bad.length ? 1 : 0);

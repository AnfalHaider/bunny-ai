/**
 * QA, v0.1.9 on the candidate head: ROLES (b57b606: consecutive same-role messages are merged in the outgoing request only) and P4-1 (a plugin update switches
 * off a changed or new skill and says so; unchanged skills keep their state). Real server on an invented data folder with a scripted OpenAI-style upstream
 * for ROLES; the real plugin update code with an in-memory "GitHub" for P4-1. No network.
 *   node e2e/w019-roles-p41.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp } = await imp('test/helpers.js'); const { createAppTools } = await imp('src/server/appTools.js'); const { createSkillStore } = await imp('src/server/skills.js'); const { createMcpStore } = await imp('src/server/mcpStore.js');
const NL = String.fromCharCode(10); const j = { 'content-type': 'application/json' };
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 320) : ''}`); };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };

// ================= ROLES =================
const seen = []; let mode = 'ok';
const up = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
  if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
  const b = JSON.parse(raw); seen.push(b);
  if (mode === 'fail') { res.writeHead(500, j); res.end('{"error":{"message":"down"}}'); return; }
  res.writeHead(200, { 'content-type': 'text/event-stream' }); const fr = (d) => 'data: ' + JSON.stringify({ choices: [{ delta: d }] }) + NL + NL;
  if (mode === 'tool' && !b.messages.some((m) => m.role === 'tool')) { res.end(fr({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'remember', arguments: JSON.stringify({ text: 'qa likes carrots' }) } }] }) + 'data: [DONE]' + NL + NL); return; }
  res.end(fr({ content: 'ok answer' }) + 'data: [DONE]' + NL + NL); }); });
await new Promise((r) => up.listen(0, '127.0.0.1', r)); cleanups.push(() => new Promise((r) => { up.closeAllConnections?.(); up.close(r); }));
const { base } = await startApp(t, { fake: false });
await fetch(`${base}/api/providers/openai/connect`, { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${up.address().port}/v1` }) });
const newSession = async () => (await (await fetch(`${base}/api/sessions`, { method: 'POST', headers: j, body: JSON.stringify({ title: 'roles' }) })).json()).id;
const say = async (id, content) => { const r = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) }); let out = ''; const dec = new TextDecoder(); for await (const c of r.body) { const part = dec.decode(c, { stream: true }); out += part; for (const m of part.matchAll(new RegExp('event: permission' + NL + 'data: (.*)', 'g'))) { const d = JSON.parse(m[1]); await fetch(`${base}/api/sessions/${id}/permission/${d.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: true }) }); } } return out; };
const roles = (b) => b.messages.map((m) => m.role); const consecutive = (b) => b.messages.some((m, i) => i > 0 && m.role === b.messages[i - 1].role && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && typeof b.messages[i - 1].content === 'string' && !m.tool_calls && !b.messages[i - 1].tool_calls);

mode = 'fail'; const sid = await newSession(); await say(sid, 'first question'); await say(sid, 'second question'); mode = 'ok'; seen.length = 0;
await say(sid, 'third question'); const last = seen.at(-1);
const userTexts = last.messages.filter((m) => m.role === 'user').map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)));
check('R1', 'three user messages in a row (two earlier ones were never answered) are one user message in the outgoing request, joined with a blank line, in order', !consecutive(last) && userTexts.some((x) => /first question/.test(x) && /second question/.test(x) && /third question/.test(x) && x.indexOf('first') < x.indexOf('second') && x.indexOf('second') < x.indexOf('third')) && /first question\n\nsecond question\n\nthird question/.test(userTexts.join('')), `roles ${roles(last).join(',')}; user text ${JSON.stringify(userTexts.at(-1)).slice(0, 160)}`);
const saved = await (await fetch(`${base}/api/sessions/${sid}`)).json(); const savedUsers = saved.messages.filter((m) => m.role === 'user').map((m) => m.content);
check('R2', 'the SAVED chat is not rewritten: the three user messages are still three separate messages in the chat', savedUsers.length === 3 && savedUsers.join('|') === 'first question|second question|third question', JSON.stringify(savedUsers));
// a tool turn is never merged
mode = 'tool'; seen.length = 0; const sid2 = await newSession(); await say(sid2, 'remember that I like carrots'); mode = 'ok';
const toolReq = seen.find((b) => b.messages.some((m) => m.role === 'tool')); const asst = toolReq?.messages.filter((m) => m.role === 'assistant') ?? [];
check('R3', 'a turn with a tool call keeps its shape (assistant with tool_calls, then tool): nothing merged into it, the tool_call_id still matches', Boolean(toolReq) && asst.some((m) => m.tool_calls?.length === 1) && toolReq.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'c1'), toolReq ? roles(toolReq).join(',') : 'tool tool was not called in this run (no request had a tool message)');
// an image part is kept with its picture
mode = 'fail'; const sid3 = await newSession(); const PIX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await fetch(`${base}/api/sessions/${sid3}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content: 'look at this', providerId: 'openai', model: 'gpt-4o', workMode: 'chat', attachments: [{ name: 'p.png', mime: 'image/png', kind: 'image', data: PIX }] }) }).then((r) => r.text()); mode = 'ok'; seen.length = 0;
await say(sid3, 'and say what colour it is'); const imgReq = seen.at(-1); const userMsgs = imgReq.messages.filter((m) => m.role === 'user');
const imgParts = userMsgs.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url').length;
check('R4', 'an earlier message with a picture and the next plain message become one user message that keeps the picture (one image part) and both texts', userMsgs.length === 1 && imgParts === 1 && /look at this/.test(JSON.stringify(userMsgs)) && /what colour/.test(JSON.stringify(userMsgs)), `${userMsgs.length} user message(s); ${imgParts} image part(s)`);
// system messages untouched
check('R5', 'system messages are not merged with anything: the outgoing request has no user/user or assistant/assistant pair of plain text', seen.every((b) => !consecutive(b)), seen.map((b) => roles(b).join('')).join(' / '));

// ================= P4-1 =================
const skillMd = (name, body, description = `about ${name}`) => `---${NL}name: ${name}${NL}description: ${description}${NL}---${NL}${body}`;
const files = { current: {} };
const github = async (url) => {
  if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files.current).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
  const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url); if (m && files.current[m[1]] !== undefined) return new Response(files.current[m[1]], { status: 200 }); return new Response('nf', { status: 404 });
};
const V1 = { 'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'v1' }), 'skills/grow/SKILL.md': skillMd('grow', 'Do NOT overwater.'), 'skills/pick/SKILL.md': skillMd('pick', 'Pick when thick.'), 'skills/wash/SKILL.md': skillMd('wash', 'Wash gently.', 'how to wash'), 'skills/peel/SKILL.md': skillMd('peel', 'Peel thin.') };
const dir = await mkdtemp(join(tmpdir(), 'bunny-w019-p41-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
const skills = createSkillStore({ file: join(dir, 'skills.json') }); const mcp = createMcpStore({ file: join(dir, 'mcp.json') }); let settings = {};
const tools = createAppTools({ skills, mcp, getSettings: () => settings, saveSettings: async (p) => { settings = { ...settings, ...p }; }, fetchImpl: github });
files.current = V1; const { record } = await tools.installFromGithub('https://github.com/bunny/carrot-helper');
const byName = async (n) => (await skills.list()).find((s) => s.name === n);
// the person switches grow, pick, wash on and leaves peel off
for (const n of ['grow', 'pick', 'wash']) await skills.update((await byName(n)).id, { enabled: true });
await skills.update((await byName('peel')).id, { enabled: false }); const peelBefore = (await byName('peel')).enabled;
files.current = { ...V1, 'skills/grow/SKILL.md': skillMd('grow', 'Do not overwater.'), // case-only change
  'skills/pick/SKILL.md': skillMd('pick', 'Pick when thick.').replace(/\n/g, '\r\n'), // line endings only
  'skills/wash/SKILL.md': skillMd('wash', 'Wash gently.', 'how to wash carrots'), // description change
  'skills/store/SKILL.md': skillMd('store', 'Keep cool.') }; // a new skill
const r = await tools.updatePlugin(record.id);
const after = { grow: await byName('grow'), pick: await byName('pick'), wash: await byName('wash'), peel: await byName('peel'), store: await byName('store') };
check('P1', 'a skill whose words changed only in CASE ("NOT" to "not") is switched OFF by the update', after.grow.enabled === false, `enabled ${after.grow.enabled}`);
check('P2', 'a skill whose only change is line endings stays ON', after.pick.enabled === true, `enabled ${after.pick.enabled}`);
check('P3', 'a skill whose description changed is switched OFF (the description also reaches the model)', after.wash.enabled === false, `enabled ${after.wash.enabled}`);
check('P4', 'a skill that was OFF and unchanged stays OFF; the new skill arrives OFF', after.peel.enabled === peelBefore && after.store.enabled === false && peelBefore === false, `peel ${after.peel.enabled}, store ${after.store?.enabled}`);
check('P5', 'the update says which skills are off and tells the person where to switch them on', /3 new or changed skills are off/.test(r.message ?? '') && /grow/.test(r.message) && /wash/.test(r.message) && /store/.test(r.message) && /Customize/.test(r.message), r.message);
check('P6', 'an update with nothing changed switches nothing off and says nothing about off skills', await (async () => { const before = (await skills.list()).map((s) => `${s.name}:${s.enabled}`).join(); const rr = await tools.updatePlugin(record.id); const afterList = (await skills.list()).map((s) => `${s.name}:${s.enabled}`).join(); return before === afterList && !/are off|is off/.test(rr.message ?? ''); })(), '');
check('P7', 'the updated instructions are saved (the new words are there, so the person can read them in Customize before switching on)', /Do not overwater/.test(after.grow.instructions) && /carrots/.test(after.wash.description), after.grow.instructions);

for (const f of cleanups.reverse()) { try { await f(); } catch { /* x */ } }
const bad = rows.filter((x) => !x.ok); console.log(NL + (rows.length - bad.length) + ' of ' + rows.length + ' passed'); process.exit(bad.length ? 1 : 0);

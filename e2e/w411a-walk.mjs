/**
 * QA, W4-11 slice A at 71f2f96, part 2: the real server (desktop-style: the window answers through app.adminFetch; invented data folder).
 * (a) invented local MCP servers whose tool names clash or are too long, a scripted model that records the tools it is offered and then
 *     calls them: every call must land on the right connector with the REAL tool name; (b) the same connector address twice;
 * (c) a plugin whose connector already exists reuses it without owning it (install, reuse, uninstall, two plugins).
 *   node e2e/w411a-walk.mjs      (from a checkout that has test/helpers.js and e2e/w411a-mcp-server.mjs)
 */
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { startApp, post } = await import(pathToFileURL(join(process.cwd(), 'test', 'helpers.js')).href);
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 250) : ''}`); };
const VALID = /^[A-Za-z0-9_-]{1,64}$/;

const { app, base } = await startApp(t, { fake: false, folderPickerOnly: true });
const admin = (path, init) => app.adminFetch(path, init);
let seen = []; let steps = [];
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }] })); return; }
    const body = JSON.parse(raw); seen.push(body);
    const step = steps[seen.length - 1];
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const frame = step ? { choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${seen.length}`, function: { name: step.name, arguments: JSON.stringify(step.args ?? {}) } }] } }] } : { choices: [{ delta: { content: 'done' } }] };
    res.end(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
await admin('/api/providers/openai/connect', { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` }) });
const FIXTURE = resolve('e2e/w411a-mcp-server.mjs');
const LONG = 'a_very_long_tool_name_that_goes_on_and_on_for_much_longer_than_a_provider_allows_';
const addLocal = async (name, tools) => (await admin('/api/mcp', { method: 'POST', headers: j, body: JSON.stringify({ name, command: 'node', args: [FIXTURE, name, JSON.stringify(tools)], confirmLocal: true }) })).json();
const addUrl = (name, url, extra = {}) => admin('/api/mcp', { method: 'POST', headers: j, body: JSON.stringify({ name, url, enabled: false, ...extra }) });
const connectorsNow = async () => (await (await fetch(`${base}/api/mcp`)).json());
const pluginsNow = async () => ((await (await fetch(`${base}/api/settings`)).json()).plugins ?? []);
const installPlugin = (bundle) => admin('/api/plugins', { method: 'POST', headers: j, body: JSON.stringify(bundle) });
async function reply(content, { mode = 'auto' } = {}) {
  const { body: s } = await post(base, '/api/sessions', { title: 'w411a', providerId: 'openai', model: 'gpt-4o' });
  await admin(`/api/sessions/${s.id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: mode }) });
  const res = await fetch(`${base}/api/sessions/${s.id}/messages`, { method: 'POST', headers: j, body: JSON.stringify({ content, providerId: 'openai', model: 'gpt-4o' }), signal: AbortSignal.timeout(60000) });
  const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break; buf += dec.decode(value, { stream: true });
    let cut; while ((cut = buf.indexOf('\n\n')) !== -1) {
      const frame = buf.slice(0, cut); buf = buf.slice(cut + 2);
      if (/^event: permission/m.test(frame)) { const d = JSON.parse(/^data: (.*)$/m.exec(frame)[1]); await admin(`/api/sessions/${s.id}/permission/${d.id}`, { method: 'POST', headers: j, body: JSON.stringify({ allowed: true }) }); }
    }
  }
  return s.id;
}
const toolResult = () => (seen[1]?.messages ?? []).filter((m) => m.role === 'tool').map((m) => String(m.content)).join(' ');

// ================= (a) tools offered and calls that land in the right place =================
const A = await addLocal('Notes', ['search.web', 'search_web', 'read', LONG + 'one', LONG + 'two']);
const B = await addLocal('notes', ['read', 'write', 'other/tool']);
seen = []; steps = [];
await reply('what tools do you have');
const offered = (seen[0]?.tools ?? []).map((d) => d.function.name);
const mine = offered.filter((n) => /^notes(_2)?__/.test(n));
check('S1', 'the model is offered the tools of both connectors: 8 tools, every name valid for a provider, and no name twice in the whole list', mine.length === 8 && mine.every((n) => VALID.test(n)) && new Set(offered).size === offered.length, `${mine.length} connector tools: ${mine.join(' ')}`);
// which prefix went to which connector depends on the order the server lists them, so find out by calling read on each prefix
const whoIs = async (prefix) => { seen = []; steps = [{ name: `${prefix}__read`, args: {} }, undefined]; await reply('who'); return /server=(\S+)/.exec(toolResult())?.[1]; };
const pA = (await whoIs('notes')) === 'Notes' ? 'notes' : 'notes_2'; const pB = pA === 'notes' ? 'notes_2' : 'notes';
check('S2', 'the connectors Notes and notes get the two prefixes notes and notes_2 (one each); search.web and search_web of Notes both exist, as _search_web and _search_web_2', (await whoIs(pB)) === 'notes' && mine.includes(`${pA}__search_web`) && mine.includes(`${pA}__search_web_2`) && mine.includes('notes__read') && mine.includes('notes_2__read'), `Notes=${pA}, notes=${pB}; ${mine.join(' ')}`);
const longOnes = mine.filter((n) => n.length === 64);
check('S3', 'the two 80-character-plus tool names that start alike are both offered, cut to 64 characters with different hashes', longOnes.length === 2 && new Set(longOnes).size === 2, longOnes.join(' '));
const calls = [
  [`${pA}__search_web`, 'Notes', 'search.web'], [`${pA}__search_web_2`, 'Notes', 'search_web'], [`${pA}__read`, 'Notes', 'read'], [`${pB}__read`, 'notes', 'read'], [`${pB}__write`, 'notes', 'write'], [`${pB}__other_tool`, 'notes', 'other/tool'],
  [longOnes[0], 'Notes', null], [longOnes[1], 'Notes', null],
];
const seenReal = [];
for (const [name, server, real] of calls) {
  seen = []; steps = [{ name, args: { q: 'hello' } }, undefined];
  await reply('use the tool');
  const result = toolResult();
  const mt = /server=(\S+) tool=(\S+)/.exec(result);
  if (real === null) seenReal.push(mt?.[2]);
  check(`C ${String(name).slice(0, 36)}`, `calling ${String(name).slice(0, 36)}${String(name).length > 36 ? '…' : ''} lands on connector "${server}"${real ? ` with the REAL tool name "${real}"` : ' with its own real long name'}`, Boolean(mt) && mt[1] === server && (real ? mt[2] === real : /^a_very_long_tool_name/.test(mt[2])), result.slice(0, 110));
}
check('C long pair', 'the two long tool names reach two DIFFERENT real tools (…one and …two), not the same one', seenReal.length === 2 && seenReal[0] !== seenReal[1] && seenReal.some((x) => x?.endsWith('one')) && seenReal.some((x) => x?.endsWith('two')), seenReal.map((x) => x?.slice(-12)).join(' | '));
seen = []; steps = [{ name: 'notes__no_such_tool', args: {} }, undefined];
await reply('use a tool that is not there');
check('C0', 'a made-up tool name gets a plain answer and the reply still finishes', seen.length === 2 && toolResult().length > 0, toolResult().slice(0, 120));
seen = []; steps = [];
await reply('plan mode check', { mode: 'plan' });
const planNames = (seen[0]?.tools ?? []).map((d) => d.function.name).filter((n) => /^notes/.test(n));
check('S4', 'in Plan mode only the read-only tools are offered (no write), with the same names', planNames.length === 7 && !planNames.some((n) => /write/.test(n)) && planNames.includes('notes_2__read'), planNames.join(' '));
await admin(`/api/mcp/${A.id}`, { method: 'DELETE' }); await admin(`/api/mcp/${B.id}`, { method: 'DELETE' });
const only = await addLocal('notes', ['read']);
seen = []; steps = [];
await reply('names after removal');
const after = (seen[0]?.tools ?? []).map((d) => d.function.name).filter((x) => /^notes/.test(x));
check('S5', 'after the other two are removed, a single connector called notes is offered as plain notes__read again', JSON.stringify(after) === JSON.stringify(['notes__read']), after.join());
await admin(`/api/mcp/${only.id}`, { method: 'DELETE' });

// ================= (b) the same address twice =================
const first = await (await addUrl('Pet Notes', 'https://notes.example.invalid/mcp')).json();
check('D0', 'a first remote connector is added', Boolean(first.id));
for (const [label, url] of [['the same address', 'https://notes.example.invalid/mcp'], ['upper case', 'HTTPS://NOTES.EXAMPLE.INVALID/MCP'], ['a trailing slash', 'https://notes.example.invalid/mcp/'], ['several trailing slashes', 'https://notes.example.invalid/mcp///'], ['spaces around it', '  https://notes.example.invalid/mcp  ']]) {
  const r = await addUrl(`Second (${label})`, url); const b = await r.json().catch(() => ({}));
  check(`D1 ${label}`, `adding ${label} again is refused (400) with "That address is already a connector (Pet Notes)."`, r.status === 400 && /already a connector \(Pet Notes\)/.test(b.message ?? ''), `${r.status} ${b.code} ${b.message}`);
}
for (const [label, url] of [['another path', 'https://notes.example.invalid/mcp2'], ['a query string', 'https://notes.example.invalid/mcp?team=a'], ['http instead of https', 'http://notes.example.invalid/mcp'], ['another host', 'https://other.example.invalid/mcp'], ['a port', 'https://notes.example.invalid:8443/mcp']]) {
  const r = await addUrl(`Other (${label})`, url); const b = await r.json().catch(() => ({}));
  check(`D2 ${label}`, `${label} is a different address and is allowed`, r.status === 200 && Boolean(b.id), `${r.status} ${b.message ?? ''}`);
  if (b.id) await admin(`/api/mcp/${b.id}`, { method: 'DELETE' });
}
check('D3', 'after the refusals exactly one connector exists (nothing half-added)', (await connectorsNow()).length === 1);
const zed = await (await addUrl('Zed', 'https://zed.example.invalid/mcp')).json();
const b3 = await (await addUrl('Zed again', 'https://zed.example.invalid/mcp')).json();
check('D5', 'with two connectors present the error names the one that owns the address (Zed)', /\(Zed\)/.test(b3.message ?? ''), b3.message);
const edit = await admin(`/api/mcp/${zed.id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ url: 'https://notes.example.invalid/mcp' }) });
console.log(`INFO  editing Zed's address to Pet Notes's address: ${edit.status} ${edit.status === 200 ? '(allowed: the duplicate check is only on adding, so the same address can still end up twice)' : '(refused)'}`);
await admin(`/api/mcp/${first.id}`, { method: 'DELETE' });
check('D6', 'after the first connector is removed the address can be used again by a new add', (await addUrl('Pet Notes again', 'https://notes.example.invalid/mcp')).status === (edit.status === 200 ? 400 : 200), 'status checked against what the edit did');
const l1 = await addLocal('Local one', ['read']); const l2 = await addLocal('Local two', ['read']);
check('D7', 'two local connectors (no address) are both allowed', Boolean(l1.id) && Boolean(l2.id));
for (const c of await connectorsNow()) await admin(`/api/mcp/${c.id}`, { method: 'DELETE' });

// ================= (c) a plugin whose connector already exists =================
const SKILL = { name: 'Helper skill', description: 'x', instructions: 'Be helpful.' };
const mineCal = await (await addUrl('My own Calendar', 'https://calendar.example.invalid/mcp', { enabled: true })).json();
const r1 = await installPlugin({ name: 'Calendar Pack', description: 'invented', connectors: [{ name: 'Pack Calendar', url: 'https://calendar.example.invalid/mcp' }, { name: 'Pack Mail', url: 'https://mail.example.invalid/mcp' }], skills: [SKILL] });
check('G1', 'a plugin with one connector the person already has installs (200); it does not fail on the existing address', r1.status === 200, `${r1.status} ${(await r1.text()).slice(0, 120)}`);
const conns = await connectorsNow(); const rec = (await pluginsNow()).find((p) => p.name === 'Calendar Pack');
check('G2', 'there is still ONE connector for the calendar address (the person\'s own, My own Calendar) and one new one for the mail address', conns.filter((c) => /calendar\.example/.test(c.url)).length === 1 && conns.find((c) => /calendar\.example/.test(c.url))?.name === 'My own Calendar' && conns.filter((c) => /mail\.example/.test(c.url)).length === 1, conns.map((c) => c.name).join(', '));
check('G3', 'the plugin record owns only what it added: the mail connector and the skill, NOT the existing calendar connector', rec && rec.connectors.length === 1 && !rec.connectors.includes(mineCal.id) && rec.skills.length === 1, JSON.stringify({ connectors: rec?.connectors?.length, skills: rec?.skills?.length }));
check('G4', 'installing the same plugin again is still refused (already installed)', (await installPlugin({ name: 'Calendar Pack', connectors: [], skills: [] })).status === 400);
const un = await admin(`/api/plugins/${rec.id}`, { method: 'DELETE' });
const left = await connectorsNow();
check('G5', 'uninstalling the plugin removes its own mail connector and skill and KEEPS the person\'s own calendar connector', un.status === 200 && left.some((c) => c.id === mineCal.id) && !left.some((c) => /mail\.example/.test(c.url)), `${un.status}; left: ${left.map((c) => c.name).join(', ')}`);
check('G6', 'the kept connector is untouched: still enabled and under its own name', left.find((c) => c.id === mineCal.id)?.enabled === true && left.find((c) => c.id === mineCal.id)?.name === 'My own Calendar');
check('G6b', 'the plugin\'s skill is gone with it (no skill left behind)', ((await (await fetch(`${base}/api/skills`)).json()) ?? []).every((s) => s.name !== 'Helper skill'));
await admin(`/api/mcp/${mineCal.id}`, { method: 'DELETE' });
const twin = await installPlugin({ name: 'Twin Pack', connectors: [{ name: 'Twin A', url: 'https://twin.example.invalid/mcp' }, { name: 'Twin B', url: 'https://twin.example.invalid/mcp/' }], skills: [] });
const twinRec = (await pluginsNow()).find((p) => p.name === 'Twin Pack');
check('G7', 'a bundle that lists the same address twice installs with ONE connector, owned by the plugin', twin.status === 200 && (await connectorsNow()).filter((c) => /twin\.example/.test(c.url)).length === 1 && twinRec?.connectors.length === 1, `${twin.status}; owns ${twinRec?.connectors.length}`);
if (twinRec) await admin(`/api/plugins/${twinRec.id}`, { method: 'DELETE' });
check('G8', 'uninstalling it removes that connector (nothing left behind)', (await connectorsNow()).filter((c) => /twin\.example/.test(c.url)).length === 0);
const off = await (await addUrl('Sleepy Calendar', 'https://sleepy.example.invalid/mcp', { enabled: false })).json();
const sleepy = await installPlugin({ name: 'Sleepy Pack', connectors: [{ name: 'Sleepy', url: 'https://sleepy.example.invalid/mcp' }], skills: [] });
const nowOff = (await connectorsNow()).find((c) => c.id === off.id);
check('G9', 'reusing a connector the person switched OFF does not switch it on behind their back (the plugin says it switches its connectors on, so this is reported)', sleepy.status === 200 && nowOff?.enabled === false, `enabled ${nowOff?.enabled}`);
console.log(`INFO  the plugin is installed and says its connector is on, but the reused connector stays OFF: its tools are not offered until the person switches it on`);
const sleepyRec = (await pluginsNow()).find((p) => p.name === 'Sleepy Pack'); if (sleepyRec) await admin(`/api/plugins/${sleepyRec.id}`, { method: 'DELETE' });
await admin(`/api/mcp/${off.id}`, { method: 'DELETE' });
const pa = await installPlugin({ name: 'Pack A', connectors: [{ name: 'Shared', url: 'https://shared.example.invalid/mcp' }], skills: [] });
const pb = await installPlugin({ name: 'Pack B', connectors: [{ name: 'Shared too', url: 'https://shared.example.invalid/mcp' }], skills: [] });
const recs = await pluginsNow(); const ra = recs.find((p) => p.name === 'Pack A'); const rb = recs.find((p) => p.name === 'Pack B');
check('G10', 'plugin B reuses the connector plugin A added: both install, A owns it, B owns no connector', pa.status === 200 && pb.status === 200 && ra?.connectors.length === 1 && rb?.connectors.length === 0, `A owns ${ra?.connectors.length}, B owns ${rb?.connectors.length}`);
await admin(`/api/plugins/${ra.id}`, { method: 'DELETE' });
const stillThere = (await connectorsNow()).filter((c) => /shared\.example/.test(c.url)).length;
console.log(`INFO  uninstalling Pack A while Pack B still relies on its connector: connectors left for that address = ${stillThere} (${stillThere === 0 ? 'Pack B silently loses it' : 'kept'})`);
check('G11', 'FINDING CHECK: uninstalling plugin A must not silently take away the connector that plugin B is using', stillThere === 1, `${stillThere} connector(s) left for the shared address`);
if (rb) await admin(`/api/plugins/${rb.id}`, { method: 'DELETE' });
for (const c of await connectorsNow()) await admin(`/api/mcp/${c.id}`, { method: 'DELETE' });
const mine2 = await (await addUrl('Notes', 'https://one.example.invalid/mcp', { enabled: false })).json();
const clash = await installPlugin({ name: 'Name Clash Pack', connectors: [{ name: 'Notes', url: 'https://two.example.invalid/mcp' }], skills: [] });
check('G12', 'a plugin connector with the same NAME but another address is a new connector (two called Notes)', clash.status === 200 && (await connectorsNow()).filter((c) => c.name === 'Notes').length === 2, `${clash.status}`);
const clashRec = (await pluginsNow()).find((p) => p.name === 'Name Clash Pack'); if (clashRec) await admin(`/api/plugins/${clashRec.id}`, { method: 'DELETE' });
await admin(`/api/mcp/${mine2.id}`, { method: 'DELETE' });
const dup = await (await addUrl('Dup first', 'https://dup.example.invalid/mcp')).json();
seen = []; steps = [{ name: 'add_connector', args: { name: 'Dup', url: 'https://dup.example.invalid/mcp' } }, undefined];
await reply('add a connector');
check('G13', 'the model adding a connector whose address already exists is told so, naming the first connector, and nothing is added', /already a connector \(Dup first\)/.test(toolResult()) && (await connectorsNow()).filter((c) => /dup\.example/.test(c.url)).length === 1, toolResult().slice(0, 140));
await admin(`/api/mcp/${dup.id}`, { method: 'DELETE' });

upstream.close();
for (const f of cleanups) { try { await f(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

/**
 * QA, v0.1.9 W4-11 new-feature walk on the candidate head: a plugin installed, its skill used, its connector tool used (text and picture), switched off and on, the read-only
 * trust in Plan mode, the list-paging bound, uninstall. Real server on an invented data folder; invented local MCP servers; a scripted OpenAI-style model. No network.
 *   node e2e/w019-w411.mjs
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const { startApp } = await imp('test/helpers.js');
const NL = String.fromCharCode(10); const j = { 'content-type': 'application/json' };
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const PIX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// ---- an invented MCP server over HTTP: tools ping (read-only), write_note (no label), snap (returns text and a picture)
const mcpCalls = []; let listRequests = 0;
function startMcp({ endless = false } = {}) {
  const sessions = new Set();
  const srv = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
    let m = {}; try { m = JSON.parse(raw); } catch { /* x */ }
    const json = (o, h = {}) => { res.writeHead(200, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
    if (m.method === 'initialize') { const id = randomUUID(); sessions.add(id); return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'inv', version: '1' } } }, { 'mcp-session-id': id }); }
    if (m.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (m.method === 'tools/list') {
      listRequests += 1;
      if (endless) return json({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'tool' + listRequests, description: 'x', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }], nextCursor: 'c' + listRequests } });
      return json({ jsonrpc: '2.0', id: m.id, result: { tools: [
        { name: 'ping', description: 'read-only ping', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
        { name: 'write_note', description: 'writes a note (no label)', inputSchema: { type: 'object', properties: {} } },
        { name: 'snap', description: 'returns a picture', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } });
    }
    if (m.method === 'tools/call') { mcpCalls.push(m.params.name); const name = m.params.name;
      if (name === 'snap') return json({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'here is the snap' }, { type: 'image', mimeType: 'image/png', data: PIX }] } });
      return json({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ran ' + name }] } }); }
    res.writeHead(200); res.end('{}'); }); });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, url: 'http://127.0.0.1:' + srv.address().port + '/mcp', close: () => { srv.closeAllConnections?.(); srv.close(); } })));
}
const mcp = await startMcp(); cleanups.push(async () => mcp.close()); const endless = await startMcp({ endless: true }); cleanups.push(async () => endless.close());

// ---- the scripted model
const seen = []; let script = () => ({ kind: 'text', text: 'ok' });
const up = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => {
  if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
  const b = JSON.parse(raw); seen.push(b); const r = script(b, seen.length); res.writeHead(200, { 'content-type': 'text/event-stream' }); const fr = (d) => 'data: ' + JSON.stringify({ choices: [{ delta: d }] }) + NL + NL;
  if (r.kind === 'tool') res.write(fr({ tool_calls: [{ index: 0, id: 'c' + seen.length, function: { name: r.name, arguments: JSON.stringify(r.args ?? {}) } }] })); else res.write(fr({ content: r.text ?? 'ok' }));
  res.end('data: [DONE]' + NL + NL); }); });
await new Promise((r) => up.listen(0, '127.0.0.1', r)); cleanups.push(() => new Promise((r) => { up.closeAllConnections?.(); up.close(r); }));
const { base } = await startApp(t, { fake: false });
await fetch(base + '/api/providers/openai/connect', { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: 'http://127.0.0.1:' + up.address().port + '/v1' }) });
const chat = async (text, { mode = 'auto', vision = true } = {}) => { const s = await (await fetch(base + '/api/sessions', { method: 'POST', headers: j, body: JSON.stringify({ title: 'w411' }) })).json(); await fetch(base + '/api/sessions/' + s.id + '/setting/permissionMode', { method: 'PATCH', headers: j, body: JSON.stringify({ value: mode }) });
  seen.length = 0; const res = await fetch(base + '/api/sessions/' + s.id + '/messages', { method: 'POST', headers: j, body: JSON.stringify({ content: text, providerId: 'openai', model: 'gpt-4o', workMode: 'chat', vision }) }); let out = ''; const dec = new TextDecoder();
  for await (const c of res.body) { const part = dec.decode(c, { stream: true }); out += part; for (const m of part.matchAll(new RegExp('event: permission' + NL + 'data: (.*)', 'g'))) { const d = JSON.parse(m[1]); await fetch(base + '/api/sessions/' + s.id + '/permission/' + d.id, { method: 'POST', headers: j, body: JSON.stringify({ allowed: true }) }); } }
  return { out, bodies: [...seen] }; };
const toolNames = (bodies) => [...new Set(bodies.flatMap((b) => (b.tools ?? []).map((d) => d.function.name)))];
const sysAll = (bodies) => bodies.flatMap((b) => b.messages.filter((m) => m.role === 'system').map((m) => String(m.content))).join(NL);

// ===== A. install a plugin (skill + connector) through the real route
const inst = await fetch(base + '/api/plugins', { method: 'POST', headers: j, body: JSON.stringify({ name: 'pack', description: 'qa pack', connectors: [{ name: 'packconn', url: mcp.url }], skills: [{ name: 'pack-lore', description: 'pack lore', instructions: 'PACKLORE-INSTRUCTION: carrots are orange.' }] }) });
const plugin = (await inst.json()).plugin; const skillsList = await (await fetch(base + '/api/skills')).json(); const connList = await (await fetch(base + '/api/mcp')).json();
const sk = skillsList.find((s) => s.name === 'pack-lore'); const cn = connList.find((c) => c.name === 'packconn');
check('A1', 'installing a plugin adds its skill and its connector and records both against the plugin', inst.status === 200 && Boolean(sk) && Boolean(cn) && (plugin?.skills ?? []).includes(sk.id) && (plugin?.connectors ?? []).includes(cn.id), 'HTTP ' + inst.status + '; skill enabled ' + sk?.enabled + '; connector enabled ' + cn?.enabled);
if (cn && sk) {
  await fetch(base + '/api/mcp/' + cn.id + '/tools').then((r) => r.json()).catch(() => {}); // list its tools once (the page does this when the person tests it)
  if (cn.enabled === false) await fetch(base + '/api/mcp/' + cn.id, { method: 'PATCH', headers: j, body: JSON.stringify({ enabled: true }) });
  if (sk.enabled === false) await fetch(base + '/api/skills/' + sk.id, { method: 'PATCH', headers: j, body: JSON.stringify({ enabled: true }) });
  // B. use the skill and the connector tool
  script = () => ({ kind: 'text', text: 'hello' }); const u1 = await chat('hello');
  check('B1', 'the plugin\'s skill reaches the model (its instructions are in the system text) in a new chat', /PACKLORE-INSTRUCTION|pack-lore/.test(sysAll(u1.bodies) + JSON.stringify(u1.bodies[0]?.messages ?? [])), '');
  check('B2', 'the connector\'s tools are offered under the connector\'s name (packconn__ping, __write_note, __snap)', ['packconn__ping', 'packconn__write_note', 'packconn__snap'].every((n) => toolNames(u1.bodies).includes(n)), toolNames(u1.bodies).filter((n) => /packconn/.test(n)).join());
  script = (b, n) => (n === 1 ? { kind: 'tool', name: 'packconn__ping', args: {} } : { kind: 'text', text: 'saw: ' + String(b.messages.at(-1).content) }); mcpCalls.length = 0;
  const u2 = await chat('ping please'); check('B3', 'a connector tool is called and its answer comes back to the model', mcpCalls.includes('ping') && /saw: ran ping/.test(u2.out), u2.out.replace(/\s+/g, ' ').slice(-120));
  // D-2: a picture from a connector
  script = (b, n) => (n === 1 ? { kind: 'tool', name: 'packconn__snap', args: {} } : { kind: 'text', text: 'looked' });
  const seeing = await chat('take a snap', { vision: true }); const blind = await chat('take a snap', { vision: false });
  const imgParts = (bodies) => bodies.flatMap((b) => b.messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))).filter((p) => p.type === 'image_url').length;
  const toolText = (bodies) => String(bodies.at(-1)?.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '');
  check('D1', 'a model that can see gets the connector\'s picture after the answer (one image part), and the tool text says it is shown', imgParts(seeing.bodies) === 1 && /shown after this answer/.test(toolText(seeing.bodies)), 'images ' + imgParts(seeing.bodies) + '; ' + toolText(seeing.bodies).slice(0, 140));
  check('D2', 'a model that cannot see gets only the placeholder line (no image part) saying it is not shown', imgParts(blind.bodies) === 0 && /not shown here/.test(toolText(blind.bodies)), 'images ' + imgParts(blind.bodies) + '; ' + toolText(blind.bodies).slice(0, 140));
  // C. switch the plugin off and on
  const off = await fetch(base + '/api/plugins/' + plugin.id, { method: 'PATCH', headers: j, body: JSON.stringify({ enabled: false }) });
  script = () => ({ kind: 'text', text: 'hello' }); const offChat = await chat('hello again');
  check('C1', 'switching the plugin OFF takes its skill and its connector tools away from new chats', off.status === 200 && !/PACKLORE-INSTRUCTION/.test(sysAll(offChat.bodies) + JSON.stringify(offChat.bodies[0]?.messages ?? [])) && !toolNames(offChat.bodies).some((n) => /packconn/.test(n)), 'HTTP ' + off.status + '; tools ' + toolNames(offChat.bodies).filter((n) => /packconn/.test(n)).join());
  const on = await fetch(base + '/api/plugins/' + plugin.id, { method: 'PATCH', headers: j, body: JSON.stringify({ enabled: true }) }); script = () => ({ kind: 'text', text: 'hello' }); const onChat = await chat('and now');
  console.log('INFO  after switching the plugin back on: skill ' + /PACKLORE-INSTRUCTION|pack-lore/.test(sysAll(onChat.bodies) + JSON.stringify(onChat.bodies[0]?.messages ?? [])) + '; connector tools ' + toolNames(onChat.bodies).filter((n) => /packconn/.test(n)).join() + ' (connectors may stay off until switched on: by design for new connectors)');
  check('C2', 'switching it back ON returns its skill', on.status === 200 && /PACKLORE-INSTRUCTION|pack-lore/.test(sysAll(onChat.bodies) + JSON.stringify(onChat.bodies[0]?.messages ?? [])), 'HTTP ' + on.status);
  // E. read-only trust in Plan mode
  await fetch(base + '/api/mcp/' + cn.id, { method: 'PATCH', headers: j, body: JSON.stringify({ enabled: true }) });
  await fetch(base + '/api/mcp/' + cn.id, { method: 'PATCH', headers: j, body: JSON.stringify({ trustReadOnly: false }) });
  script = () => ({ kind: 'text', text: 'plan' }); const plan0 = await chat('plan it', { mode: 'plan' });
  check('E1', 'Plan mode with an UNTRUSTED connector: none of its tools are offered, even the ones labelled read-only', !toolNames(plan0.bodies).some((n) => /packconn/.test(n)), toolNames(plan0.bodies).filter((n) => /packconn/.test(n)).join() || 'none');
  const trust = await fetch(base + '/api/mcp/' + cn.id, { method: 'PATCH', headers: j, body: JSON.stringify({ trustReadOnly: true }) });
  const plan1 = await chat('plan it again', { mode: 'plan' });
  check('E2', 'after the person trusts its labels, Plan mode offers only the read-only tools (ping, snap) and NOT the unlabelled write_note', trust.status === 200 && toolNames(plan1.bodies).includes('packconn__ping') && toolNames(plan1.bodies).includes('packconn__snap') && !toolNames(plan1.bodies).includes('packconn__write_note'), 'HTTP ' + trust.status + '; ' + toolNames(plan1.bodies).filter((n) => /packconn/.test(n)).join());
  // F. uninstall
  const del = await fetch(base + '/api/plugins/' + plugin.id, { method: 'DELETE' }); const skillsAfter = await (await fetch(base + '/api/skills')).json(); const connAfter = await (await fetch(base + '/api/mcp')).json();
  check('F1', 'uninstalling the plugin removes its skill and its connector', del.status === 200 && !skillsAfter.some((s) => s.name === 'pack-lore') && !connAfter.some((c) => c.name === 'packconn'), 'HTTP ' + del.status);
  script = () => ({ kind: 'text', text: 'hello' }); const gone = await chat('after uninstall');
  check('F2', 'after uninstall a new chat has neither the skill nor the connector tools', !/PACKLORE-INSTRUCTION/.test(sysAll(gone.bodies) + JSON.stringify(gone.bodies[0]?.messages ?? [])) && !toolNames(gone.bodies).some((n) => /packconn/.test(n)), '');
}
// ===== G. the list-paging bound: a server whose list never ends
const ec = await (await fetch(base + '/api/mcp', { method: 'POST', headers: j, body: JSON.stringify({ name: 'endless', url: endless.url, enabled: true }) })).json(); listRequests = 0; const t0 = Date.now();
const er = await fetch(base + '/api/mcp/' + ec.id + '/tools').then((r) => r.json()).catch((e) => ({ error: e.message }));
check('G1', 'a server that never stops sending pages is cut off by itself: at most 100 list requests, quickly, and the answer says the list was cut', listRequests <= 100 && listRequests >= 20 && Date.now() - t0 < 30000 && (er.truncated === true || /cut|truncat/i.test(JSON.stringify(er))), listRequests + ' requests in ' + (Date.now() - t0) + ' ms; ' + JSON.stringify(er).slice(0, 140));
for (const f of cleanups.reverse()) { try { await f(); } catch { /* x */ } }
const bad = rows.filter((x) => !x.ok); console.log(NL + (rows.length - bad.length) + ' of ' + rows.length + ' passed'); process.exit(bad.length ? 1 : 0);

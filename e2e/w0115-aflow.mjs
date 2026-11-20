/**
 * QA v0.1.15 AGENT-FLOW F1 to F3 functional check (92a53bc1): Bunny's real server (createApp, test mode), a scripted model that records every request, a stand-in GitHub and a stand-in MCP server.
 * Invented profile only. Cards (permission, capability, question) are answered like the page answers them.
 *   BUNNY_FAKE_UPSTREAM=1 node e2e/w0115-aflow.mjs <outFile.json>
 */
process.env.BUNNY_FAKE_UPSTREAM = '1';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(); const imp = (p) => import(pathToFileURL(resolve(root, p)).href);
const { createApp } = await imp('src/server/app.js'); const { memorySecretStore } = await imp('src/providers/connections.js');
const OUT = process.argv[2] ?? join(process.cwd(), 'aflow.json'); const NL = String.fromCharCode(10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = []; const flat = (s) => String(s ?? '').replace(/\s+/g, ' ');
const row = (id, expected, actual, ok) => { rows.push({ id, expected, actual: flat(actual).slice(0, 700), ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '\n   expected: ' + expected + '\n   actual:   ' + flat(actual).slice(0, 600)); };

// ---- the scripted model ----
let script = () => ({ content: 'ok' }); let seen = []; let delayMs = 0;
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', async () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"qa-model"}]}'); return; }
    const body = JSON.parse(raw); seen.push(body);
    if (delayMs) await wait(delayMs);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: script(body, seen.length) }] }) + NL + NL); res.end('data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] });
const sysOf = (b) => (b?.messages ?? []).filter((m) => m.role === 'system').map((m) => String(m.content)).join(NL);

// ---- the stand-in internet: a GitHub plugin repo with a weather connector, and the MCP server it names ----
const REPO = { 'plugin.json': JSON.stringify({ name: 'carrot-helper', description: 'Carrot know-how' }), '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' } } }) };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url?.url ?? url);
  if (u.includes('api.github.com') && u.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(REPO).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
  const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u);
  if (m) return REPO[m[1]] !== undefined ? new Response(REPO[m[1]], { status: 200 }) : new Response('not found', { status: 404 });
  if (u === 'https://weather.example.com/mcp') {
    const rpc = JSON.parse(String(init?.body ?? '{}'));
    const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
    if (rpc.method === 'initialize') return reply({ protocolVersion: rpc.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'weather', version: '1' } });
    if (rpc.method === 'tools/list') return reply({ tools: [{ name: 'forecast', description: 'The forecast for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } }, annotations: { readOnlyHint: true } }] });
    if (rpc.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'Sunny in Lisbon, 24 degrees' }] });
    return new Response('', { status: 202 });
  }
  return realFetch(url, init);
};

// ---- the app ----
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115f-data-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w0115f-folder-'));
const bunny = await createApp({ dataDir: DATA, fake: true, secretStore: memorySecretStore(), localGuard: true, folderPickerOnly: false });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${bunny.server.address().port}`;
const api = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j, text: t }; };
await api('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'sk-qa-0000000000' });
const plist = (await api('/api/providers')).json; const pid = (Array.isArray(plist) ? plist : plist.providers).find((p) => p.custom || /QA Harbor/.test(p.name)).id;
await api('/api/settings', 'PUT', { providerId: pid, model: 'qa-model' });
const resetConnectors = async () => { for (const c of (await api('/api/mcp')).json ?? []) await api('/api/mcp/' + c.id, 'DELETE'); for (const p of ((await api('/api/settings')).json?.plugins ?? [])) await api('/api/plugins/' + p.id, 'DELETE'); };

// ---- one reply, with the cards answered like the page answers them ----
const say = async (sid, content, { grant = true, allow = true, question = 'Keep going', mode = 'chat', extra = {} } = {}) => {
  const res = await bunny.adminFetch(`/api/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, providerId: pid, model: 'qa-model', workMode: mode, ...extra }) });
  const reader = res.body.getReader(); let text = ''; const answered = new Set(); const cards = [];
  for (;;) {
    let chunk; try { chunk = await reader.read(); } catch (e) { console.log("STREAM ERROR", String(e).slice(0,80), "after:", text.slice(-600)); break; }
    const { done: end, value } = chunk; if (end) break;
    text += new TextDecoder().decode(value);
    if (process.env.QA_DEBUG) for (const m of new TextDecoder().decode(value).split('event: ').slice(1)) console.log('  ev', m.slice(0, 200).split(String.fromCharCode(10)).join(' | '));
    for (const kind of ['permission', 'capability', 'question']) {
      for (const m of text.matchAll(new RegExp('event: ' + kind + String.fromCharCode(10) + 'data: (.*)' + String.fromCharCode(10), 'g'))) {
        let card; try { card = JSON.parse(m[1]); } catch { continue; }
        if (answered.has(card.id)) continue; answered.add(card.id); cards.push({ kind, card });
        const answer = kind === 'permission' ? { allowed: allow } : kind === 'capability' ? { granted: grant } : { choices: [question] };
        await bunny.adminFetch(`/api/sessions/${sid}/${kind}/${card.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(answer) });
      }
    }
  }
  return { text, cards, working: (text.match(/event: working/g) ?? []).length };
};
const newChat = async (mode = 'chat') => (await api('/api/sessions', 'POST', { title: 'QA', providerId: pid, model: 'qa-model', workMode: mode, ...(mode === 'code' ? { folder: FOLDER } : {}) })).json.id;
const installScript = (body, n) => {
  const told = body.messages.filter((m) => m.role === 'tool');
  if (n === 1) return call('c1', 'install_plugin', { url: 'https://github.com/bunny/carrot-helper' });
  const forecast = (body.tools ?? []).find((d) => /forecast/.test(d.function.name));
  if (n === 2 && forecast) return call('c2', forecast.function.name, { city: 'Lisbon' });
  return { content: 'final: ' + (told.at(-1)?.content ?? '') };
};
const userMsgs = (b) => b.messages.filter((m) => m.role === 'user').length;

try {
  // ===== (1) F1: found, installed, switched on, usable in the same reply =====
  for (const mode of ['chat', 'code']) {
    await resetConnectors(); await api('/api/settings', 'PUT', { connectorsEnabled: true }); seen = []; script = installScript;
    if (mode === 'code') await bunny.chooseFolder(FOLDER);
    const sid = await newChat(mode); const r = await say(sid, 'find me a weather tool and tell me the forecast for Lisbon', { grant: true, mode });
    const second = seen[1]; const toolNames = (second?.tools ?? []).map((d) => d.function.name); const told = second?.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? '';
    const mcp = (await api('/api/mcp')).json ?? [];
    row(`F1-1 (${mode} mode) install, the person says yes, then use it in the same reply`, 'the 2nd model request of the SAME reply carries the connector tool; the tool message says it is switched on and lists the tool; the model calls it and gets the result; no new user message', JSON.stringify({ requests: seen.length, toolOffered: toolNames.filter((n) => /forecast/.test(n)), told: told.slice(0, 190), userMessagesIn2nd: second ? userMsgs(second) : null, connectors: mcp.map((c) => [c.name, c.enabled]), cards: r.cards.map((c) => c.kind), finalHasResult: /Sunny in Lisbon/.test(r.text) }), toolNames.some((n) => /forecast/.test(n)) && /now switched on/.test(told) && /You now have its tools: .*forecast/.test(told) && /Sunny in Lisbon/.test(r.text) && second && userMsgs(second) === 1 && mcp.length === 1 && mcp[0].enabled === true);
    const sess = (await api('/api/sessions/' + sid)).json; const toolSteps = (sess.messages ?? []).filter((m) => m.kind === 'tool_call' || m.role === 'tool').length;
    row(`F1-1b (${mode} mode) the chat shows the steps it took`, 'the saved chat holds the install step and the connector call', `saved tool steps: ${toolSteps}; messages ${sess.messages?.length}`, toolSteps >= 2);
  }
  await resetConnectors(); seen = []; script = installScript; { const sid = await newChat('chat'); await say(sid, 'add a weather tool', { grant: false }); const t2 = seen[1]; const mcp = (await api('/api/mcp')).json ?? [];
    row('F1-2 the person says no on the card', 'no tool arrives; the connector stays off', JSON.stringify({ forecastOffered: (t2?.tools ?? []).some((d) => /forecast/.test(d.function.name)), connectors: mcp.map((c) => [c.name, c.enabled]) }), t2 && !(t2.tools ?? []).some((d) => /forecast/.test(d.function.name)) && mcp.every((c) => c.enabled === false)); }
  await resetConnectors(); await api('/api/settings', 'PUT', { connectorsEnabled: false }); seen = []; script = installScript; { const sid = await newChat('chat'); const r = await say(sid, 'add a weather tool', { grant: true }); const t2 = seen[1]; const told = t2?.messages.filter((m) => m.role === 'tool').at(-1)?.content ?? ''; const sess = (await api('/api/sessions/' + sid)).json; const shown = /Connectors are turned off/.test(r.text) || JSON.stringify(sess.messages ?? []).includes('Connectors are turned off');
    row('F1-3 Connectors turned off in Settings, then install and yes', 'no tools arrive; "Connectors are turned off in Settings › Capabilities" reaches the model and is shown in the chat', JSON.stringify({ forecastOffered: (t2?.tools ?? []).some((d) => /forecast/.test(d.function.name)), toldModel: told.slice(0, 220), lineShownInChatStream: /Connectors are turned off/.test(r.text), lineInSavedChat: JSON.stringify(sess.messages ?? []).includes('Connectors are turned off') }), t2 && !(t2.tools ?? []).some((d) => /forecast/.test(d.function.name)) && /Connectors are turned off in Settings › Capabilities/.test(told) && shown); }
  await api('/api/settings', 'PUT', { connectorsEnabled: true }); await resetConnectors();

  // ===== (2) F2: the model knows what is on and off, and how to get each =====
  script = (body) => { const sys = sysOf(body); const q = String(body.messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''); if (/browser panel/i.test(q)) { const line = /the browser panel: ([^;.]+)/.exec(sys); return { content: line ? `About the browser panel: ${line[1]}.` : 'I do not have a browser panel line.' }; } if (/search this pc|find a file/i.test(q)) { const line = /searching this PC: (off; tell the person[^;]+|[^;.]+)(;|\. )/.exec(sys); return { content: line ? `Searching this PC: ${line[1]}.` : 'Searching this PC is on.' }; } return { content: 'ok' }; };
  await api('/api/settings', 'PUT', { pcSearchEnabled: false }); seen = []; { const sid = await newChat('chat'); const r = await say(sid, 'open the browser panel and show me the page', { extra: { browserControl: false } });
    row('F2-1 browser panel, asked outside the desktop window (browserControl false)', 'the map line says where it is available, and the model passes it on (not an error)', JSON.stringify({ line: /the browser panel: [^;.]+/.exec(sysOf(seen[0]))?.[0], answer: flat(r.text).match(/About the browser panel[^"]*/)?.[0] }), /the browser panel: only in the desktop window/.test(sysOf(seen[0])) && /desktop window/.test(r.text)); }
  seen = []; { const sid = await newChat('chat'); await say(sid, 'open the browser panel', { extra: { browserControl: true } });
    row('F2-2 same question inside the desktop window (browserControl true)', 'the map lists the browser panel as ON (no "not here")', JSON.stringify({ on: /Abilities now\. On: [^.]*/.exec(sysOf(seen[0]))?.[0], offLine: /the browser panel: [^;.]+/.exec(sysOf(seen[0]))?.[0] ?? null }), /On: [^.]*the browser panel/.test(sysOf(seen[0])) && !/the browser panel: only/.test(sysOf(seen[0]))); }
  seen = []; { const sid = await newChat('chat'); const r = await say(sid, 'find a file about my taxes on this PC');
    row('F2-3 Search this PC off: the model is given the Settings step', 'map says to turn on Search this PC in Settings › Capabilities', JSON.stringify({ line: /searching this PC: off; tell the person[^;]+/.exec(sysOf(seen[0]))?.[0], answer: flat(r.text).match(/Searching this PC[^"]*/)?.[0] }), /searching this PC: off; tell the person to turn on Search this PC in Settings › Capabilities/.test(sysOf(seen[0])) && /Settings › Capabilities/.test(r.text)); }
  await api('/api/settings', 'PUT', { pcSearchEnabled: true }); seen = []; { const sid = await newChat('chat'); await say(sid, 'find a file about my taxes on this PC');
    row('F2-4 Search this PC on: the map lists it as on', 'On: … searching this PC; no off-line for it', JSON.stringify({ on: /Abilities now\. On: [^.]*/.exec(sysOf(seen[0]))?.[0], off: /searching this PC: [^;]+/.exec(sysOf(seen[0]))?.[0] ?? null }), /On: [^.]*searching this PC/.test(sysOf(seen[0])) && !/searching this PC: off/.test(sysOf(seen[0]))); }
  await api('/api/settings', 'PUT', { pcSearchEnabled: false }); seen = []; { const sid = await newChat('chat'); await say(sid, 'hello'); const s = sysOf(seen[0]);
    row('F2-5 files, computer, building, Google, GitHub off', 'each off ability has its one step: request_capability cards for code/computer/build, Settings › Profile for Google and GitHub; the closing "do not just say you cannot"', flat(/Abilities now\.[\s\S]*?cannot\./.exec(s)?.[0] ?? '(no map)').slice(0, 640), /files and commands: off; call request_capability with code_mode/.test(s) && /control of this computer: off; call request_capability with computer_use/.test(s) && /building tools: off; call request_capability with custom_tools/.test(s) && /sign in to Google in Settings › Profile/.test(s) && /sign in to GitHub in Settings › Profile/.test(s) && /do not just say you cannot/.test(s)); }
  await resetConnectors(); await api('/api/mcp', 'POST', { name: 'Sleepy', url: 'https://sleepy.example.com/mcp', enabled: false }); seen = []; { const sid = await newChat('chat'); await say(sid, 'hello'); const s = sysOf(seen[0]);
    row('F2-6 an installed but switched-off connector', 'named with the Settings › Customize step', /Connectors installed but not working: [^;]*;[^.]*\./.exec(s)?.[0] ?? '(missing)', /Connectors installed but not working: Sleepy \(switched off\); the person switches them on or signs in under Settings › Customize/.test(s)); }
  await resetConnectors(); seen = []; { const sid = await newChat('chat'); await say(sid, 'hello', { extra: {} }); }
  seen = []; { const sid = await newChat('code'); await bunny.chooseFolder(FOLDER); await say(sid, 'hello', { mode: 'code' }); const s = sysOf(seen[0]); row('F2-7 Code mode with a folder', 'files and commands listed as on', /Abilities now\. On: [^.]*/.exec(s)?.[0] ?? '(missing)', /On: [^.]*files and commands/.test(s)); }
  { const sid = await newChat('chat'); seen = []; const res = await bunny.adminFetch(`/api/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'quick', providerId: pid, model: 'qa-model', workMode: 'chat', textOnly: true }) }); await res.text();
    row('F2-8 the Quick ask bar gets no ability map (nobody can answer a card there)', 'no "Abilities now" text in a text-only reply', /Abilities now/.test(sysOf(seen[0])) ? 'present' : 'absent', !/Abilities now/.test(sysOf(seen[0]))); }

  // ===== (3) F3: a long research job in Chat mode =====
  await api('/api/settings', 'PUT', { autoContinueSteps: 500, autoContinueMinutes: 120, defaultEffort: 'medium' });
  seen = []; script = (body, n) => (n <= 14 ? call('c' + n, 'list_sessions', { n }) : { content: 'All done after many steps.' });
  { const sid = await newChat('chat'); const r = await say(sid, 'research this thoroughly');
    row('F3-1 Chat job needing 14 steps (medium effort = 6)', 'goes on past 6 steps, finishes with its answer, shows "Still working" events', JSON.stringify({ modelRequests: seen.length, toolRounds: seen.filter((b) => b.tools).length, working: r.working, finished: /All done after many steps/.test(r.text) }), seen.length >= 15 && /All done after many steps/.test(r.text) && r.working >= 1); }
  await api('/api/settings', 'PUT', { autoContinueSteps: 14 }); seen = []; script = (body, n) => (n <= 40 ? call('c' + n, 'list_sessions', { n }) : { content: 'All done after many steps.' });
  { const sid = await newChat('chat'); const r = await say(sid, 'research this thoroughly');
    row('F3-2 step cap (Keep going on long jobs = 14)', 'the reply stops at the cap, not at 40 steps, and does not hang', JSON.stringify({ modelRequests: seen.length, finishedAll: /All done after many steps/.test(r.text), endedWithDone: /event: done/.test(r.text), tail: r.text.split("event: ").slice(-4).map((x) => x.slice(0, 160)) }), seen.length >= 12 && seen.length <= 22 && !/All done after many steps/.test(r.text) && /event: done/.test(r.text)); }
  await api('/api/settings', 'PUT', { autoContinueSteps: 500, autoContinueMinutes: 1 }); seen = []; delayMs = 7000; script = (body, n) => (n <= 40 ? call('c' + n, 'list_sessions', { n }) : { content: 'All done after many steps.' });
  { const t0 = Date.now(); const sid = await newChat('chat'); const r = await say(sid, 'research this thoroughly'); const secs = Math.round((Date.now() - t0) / 1000);
    row('F3-3 time cap (Longest long job = 1 minute), model takes 7 s per step', 'the reply stops soon after the minute is up (around step 12), not at 40 steps', JSON.stringify({ modelRequests: seen.length, seconds: secs, finishedAll: /All done after many steps/.test(r.text), endedWithDone: /event: done/.test(r.text) }), seen.length >= 8 && seen.length <= 16 && !/All done after many steps/.test(r.text) && /event: done/.test(r.text)); }
  delayMs = 0; await api('/api/settings', 'PUT', { autoContinueSteps: 500, autoContinueMinutes: 120 });
  for (const answer of ['Stop here', 'Keep going']) {
    seen = []; script = (body, n) => (n <= 5 ? call('c' + n, 'list_sessions', { n: 1 }) : { content: 'All done after repeats.' });
    const sid = await newChat('chat'); const r = await say(sid, 'research this thoroughly', { question: answer }); const card = r.cards.find((c) => c.kind === 'question')?.card;
    row(`F3-4 the same step three times in a row, answer "${answer}"`, answer === 'Stop here' ? 'a card asks "same step three times… Keep trying, or stop here?"; Stop here ends the reply (no 5th call)' : 'the card asks; Keep going lets the reply finish', JSON.stringify({ card: card?.question?.slice(0, 90), choices: card?.choices?.map((c) => c.label ?? c), modelRequests: seen.length, finished: /All done after repeats/.test(r.text) }), Boolean(card && /three times in a row/.test(card.question)) && (answer === 'Stop here' ? seen.length <= 4 && !/All done after repeats/.test(r.text) : /All done after repeats/.test(r.text)));
  }
  seen = []; script = (body, n) => (n <= 12 ? call('c' + n, 'web_search', { query: 'x' + n }) : { content: 'enough' });
  { const sid = await newChat('chat'); const res = await bunny.adminFetch(`/api/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'quick', providerId: pid, model: 'qa-model', workMode: 'chat', textOnly: true }) }); await res.text();
    row('F3-5 the Quick ask bar is never extended', 'at most its own steps (about 6 + answer)', `modelRequests ${seen.length}`, seen.length <= 7); }
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); rows.push({ id: 'script', expected: '', actual: String(e), ok: false }); }
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const bad = rows.filter((x) => !x.ok); console.log('\n' + (rows.length - bad.length) + ' of ' + rows.length + ' passed; failed: ' + bad.map((x) => x.id.split(' ')[0]).join(' '));
try { globalThis.fetch = realFetch; provider.close(); await bunny.close?.(); bunny.server.close(); } catch { /* x */ }
process.exit(0);

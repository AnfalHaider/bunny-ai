/**
 * QA v0.1.15 QUICK ASK AUDIT: the bar's real answerer (electron/quick-ask-answer.js) against Bunny's real server (createApp, BUNNY_FAKE_UPSTREAM=1 test mode, stand-in file index
 * over invented files), a scripted model that either calls tools or ignores them, and a stand-in internet. Invented profile only; nothing real is read.
 *   BUNNY_FAKE_UPSTREAM=1 BUNNY_PCSEARCH_FAKE=1 node e2e/w0115-qstore.mjs <outFile.json>
 * A row: setting or flow, expected, actual. Output JSON for the report.
 */
process.env.BUNNY_FAKE_UPSTREAM = '1';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const imp = (p) => import(pathToFileURL(resolve(root, p)).href);
const { createApp } = await imp('src/server/app.js');
const { memorySecretStore } = await imp('src/providers/connections.js');
const { createFakePcSearch } = await imp('src/server/pcFake.js');
const { createAnswerer } = await imp('electron/quick-ask-answer.js');
const OUT = process.argv[2] ?? join(process.cwd(), 'qstore.json');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NL = String.fromCharCode(10);
const rows = [];
const row = (id, expected, actual, ok, extra = '') => { rows.push({ id, expected, actual, ok: Boolean(ok), extra }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '\n   expected: ' + expected + '\n   actual:   ' + actual + (extra ? '\n   note:     ' + extra : '')); };

// ---- the scripted model: MODE 'tools' calls the right tool first then answers; 'ignore' never calls a tool; 'marker' answers with the needs-window marker ----
let MODE = 'tools'; const seen = [];
const lastUser = (msgs) => [...msgs].reverse().find((m) => m.role === 'user' && !/search results from web pages/i.test(String(m.content)))?.content ?? '';
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"qa-model"}]}'); return; }
    let body = {}; try { body = JSON.parse(raw); } catch { /* x */ }
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    const q = String(typeof lastUser(msgs) === 'string' ? lastUser(msgs) : JSON.stringify(lastUser(msgs)));
    const toolResults = msgs.filter((m) => m.role === 'tool').map((m) => String(m.content));
    const injected = msgs.some((m) => m.role === 'user' && /search results from web pages/i.test(String(m.content)));
    seen.push({ mode: MODE, q: q.slice(0, 80), tools: (body.tools ?? []).map((t) => t.function?.name), nToolResults: toolResults.length, injected, sys: msgs.filter((m) => m.role === 'system').map((m) => String(m.content)).join(' ').slice(0, 2000) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = (o) => res.write('data: ' + JSON.stringify(o) + NL + NL);
    const text = (t) => { data({ choices: [{ delta: { content: t } }] }); data({ choices: [{ delta: {}, finish_reason: 'stop' }] }); };
    const call = (name, args) => { data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_' + name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }); data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }); };
    const offered = (body.tools ?? []).map((t) => t.function?.name);
    if (MODE === 'marker') text('[[NEEDS_BUNNY_WINDOW]] This needs a tool I do not have here.');
    else if (MODE === 'ignore') text(/tax|file/i.test(q) ? 'I cannot see files on your computer. Please open the full Bunny app to do that.' : 'I cannot browse the internet, so I cannot tell you the weather. Open the full app.');
    else if (toolResults.length || injected) text(toolResults.some((t) => /tax return/i.test(t)) ? 'I found two tax return files: tax return 2025.txt and tax return 2024.txt, in your Documents folder.' : 'Islamabad is 24 degrees and clear, from the search. Source: https://weather.example.test/islamabad');
    else if (/tax/i.test(q) && offered.includes('search_pc')) call('search_pc', { terms: ['tax'] });
    else if (/weather|internet|news|tomorrow/i.test(q) && offered.includes('web_search')) call('web_search', { query: /tomorrow/i.test(q) ? 'Islamabad weather tomorrow' : 'weather in Islamabad today' });
    else text(/tax/i.test(q) ? 'I do not have a way to look at your files here. Please open the full app.' : 'I could not look that up here.');
    res.end('data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));

// ---- the stand-in internet (the server's own fetch) ----
let searches = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url?.url ?? url);
  if (/html\.duckduckgo\.com/.test(u)) { searches.push(u); return new Response('<div class="result"><a class="result__a" href="https://weather.example.test/islamabad">Islamabad weather today</a><a class="result__snippet">Islamabad: 24 degrees, clear skies.</a></div>', { status: 200, headers: { 'content-type': 'text/html' } }); }
  return realFetch(url, init);
};

const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115q-data-'));
const pcFake = createFakePcSearch();
let bunny = null;
const startApp = async () => {
  bunny = await createApp({ dataDir: DATA, fake: true, secretStore: memorySecretStore(), pcOptions: pcFake, localGuard: true, folderPickerOnly: false });
  await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
};
const stopApp = async () => { try { await bunny.close?.(); } catch { /* x */ } try { bunny.server.close(); } catch { /* x */ } };
const api = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j }; };
await startApp();
const pr = await api('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'sk-qa-0000000000' });
const plist = (await api('/api/providers')).json; const custom = (Array.isArray(plist) ? plist : plist?.providers ?? []).find((p) => p.custom || /QA Harbor/.test(p.name ?? '')); const pid = custom?.id ?? pr.json?.id;
await api('/api/settings', 'PUT', { providerId: pid, model: 'qa-model', callName: 'Pat' });

// ---- one bar: ask, then follow-ups, as the bar does (the same session) ----
const newBar = () => {
  const events = []; const a = createAnswerer({ adminFetch: (p, i) => bunny.adminFetch(p, i), emit: (e) => events.push(e), getSettings: () => bunny.getSettings() });
  return { a, events, ask: async (text, pc = false) => { events.length = 0; searches = []; seen.length = 0; await a.ask({ text, pc }); return summarize([...events]); } };
};
const summarize = (ev) => {
  let ans = ''; for (const e of ev) { if (e.type === 'restart') ans = ''; else if (e.type === 'delta') ans += e.text; } // a restart drops what came before it (as the bar does)
  const last = ev.filter((e) => ['done', 'error', 'needs-window', 'stopped'].includes(e.type)).at(-1);
  const pcStates = ev.filter((e) => e.type === 'pc').map((e) => e.state + (e.total != null ? `(${e.total})` : ''));
  return { ans, end: last?.type ?? 'none', needsWindow: ev.some((e) => e.type === 'needs-window'), restart: ev.some((e) => e.type === 'restart'), err: ev.find((e) => e.type === 'error')?.message, pcStates, lookups: last?.lookups, sources: (last?.sources ?? []).length, model: seen.at(-1) };
};
const short = (r) => `[${r.end}${r.needsWindow ? ', CARD: This needs Bunny\'s window' : ''}${r.restart ? ', auto-retry' : ''}] "${r.ans.replace(/\s+/g, ' ').slice(0, 110)}"${r.pcStates.length ? ' pc=' + r.pcStates.join('>') : ''}${r.err ? ' err=' + r.err.slice(0, 80) : ''}; tools offered: ${JSON.stringify(seen.flatMap((s) => s.tools ?? []).filter((x, i, arr) => arr.indexOf(x) === i))}; web searches run: ${searches.length}`;
const set = async (patch) => { const r = await api('/api/settings', 'PUT', patch); if (r.status !== 200) console.log('SETTINGS REFUSED', r.status, JSON.stringify(patch), JSON.stringify(r.json)); return r; };
const tools = () => [...new Set(seen.flatMap((s) => s.tools ?? []))];

const flat = (s) => String(s).replace(/\s+/g, ' ');
const chatText = async (sid) => { await wait(1500); const s = (await api('/api/sessions/' + sid)).json; const msgs = s?.messages ?? []; const last = [...msgs].reverse().find((m) => m.role === 'assistant'); return { n: msgs.length, last: typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? ''), assistants: msgs.filter((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.trim()).length }; };
try {
  await set({ pcSearchEnabled: true, pcSearchBarAuto: true, pcSearchAfter: 'read' });
  MODE = 'ignore';
  let bar = newBar(); let r = await bar.ask('find my tax returns file'); let c = await chatText(bar.a.sessionId);
  row('S1 stubborn model, file question: the chat opened in Bunny', 'stored reply is what the bar showed (the found files), not the model refusal; one assistant reply', 'bar: ' + flat(r.ans).slice(0, 100) + ' || chat: ' + flat(c.last).slice(0, 140) + ' (assistant replies ' + c.assistants + ')', /tax return/i.test(c.last) && !/cannot see files|open the full/i.test(c.last) && c.assistants === 1);
  bar = newBar(); r = await bar.ask('weather in Islamabad today'); c = await chatText(bar.a.sessionId);
  row('S2 stubborn model, weather: the chat opened in Bunny', 'stored reply is the web results the bar showed, not the refusal', 'bar: ' + flat(r.ans).slice(0, 100) + ' || chat: ' + flat(c.last).slice(0, 140) + ' (assistant replies ' + c.assistants + ')', /web search found|weather.example/i.test(c.last) && !/cannot browse|open the full/i.test(c.last) && c.assistants === 1);
  await bar.ask('and tomorrow?'); c = await chatText(bar.a.sessionId);
  row('S3 follow-up in the same bar, then the chat', 'chat holds both turns, last reply is the bar one, no refusal text', 'chat: ' + flat(c.last).slice(0, 120) + ' (assistant replies ' + c.assistants + ', messages ' + c.n + ')', !/cannot browse|open the full/i.test(c.last) && c.assistants === 2);
  MODE = 'tools'; bar = newBar(); r = await bar.ask('weather in Islamabad today'); c = await chatText(bar.a.sessionId);
  row('S4 tool-calling model (control): chat after the bar answered', 'one assistant reply with the answer', 'chat: ' + flat(c.last).slice(0, 120) + ' (assistant replies ' + c.assistants + ')', /24 degrees/.test(c.last) && c.assistants === 1);
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); rows.push({ id: 'script', expected: '', actual: String(e), ok: false }); }
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const bad = rows.filter((x) => !x.ok); console.log(rows.length - bad.length, 'of', rows.length, 'passed');
try { await stopApp(); provider.close(); } catch { /* x */ }
process.exit(0);

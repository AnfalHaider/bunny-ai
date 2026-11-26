/**
 * QA v0.1.15 QUICK ASK AUDIT: the bar's real answerer (electron/quick-ask-answer.js) against Bunny's real server (createApp, BUNNY_FAKE_UPSTREAM=1 test mode, stand-in file index
 * over invented files), a scripted model that either calls tools or ignores them, and a stand-in internet. Invented profile only; nothing real is read.
 *   BUNNY_FAKE_UPSTREAM=1 BUNNY_PCSEARCH_FAKE=1 node e2e/w0115-qaudit.mjs <outFile.json>
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
const OUT = process.argv[2] ?? join(process.cwd(), 'qaudit.json');
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
  if (/html\.duckduckgo\.com/.test(u)) { searches.push(u); return new Response(`<div class="result"><a class="result__a" href="https://weather.example.test/islamabad">Islamabad weather today</a><a class="result__snippet">Islamabad: 24 degrees, clear skies. (stand-in answer to: ${decodeURIComponent(/[?&]q=([^&]+)/.exec(u)?.[1] ?? '')})</a></div>`, { status: 200, headers: { 'content-type': 'text/html' } }); }
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
const { resetWebSearch } = await imp('src/server/webSearch.js');
const newBar = () => {
  const events = []; const a = createAnswerer({ adminFetch: (p, i) => bunny.adminFetch(p, i), emit: (e) => events.push(e), getSettings: () => bunny.getSettings() });
  return { a, events, ask: async (text, pc = false) => { resetWebSearch(); /* v0.1.16: a repeated question is answered from memory for two minutes, and each flow here is its own person asking */ events.length = 0; searches = []; seen.length = 0; await a.ask({ text, pc }); return summarize([...events]); } };
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

try {
  // ===== A. Search this PC and its sub-options =====
  const tax = 'find my tax returns file';
  MODE = 'tools';
  await set({ pcSearchEnabled: false });
  let bar = newBar(); let r = await bar.ask(tax);
  row('A1 Search this PC OFF, "find my tax returns file", model that calls tools', 'bar says plainly that Search this PC is off and where to turn it on (not "open the app"); no file tool offered', short(r), !tools().includes('search_pc') && /search this pc|settings|turn it on|off/i.test(r.ans) && !r.needsWindow, '');
  MODE = 'ignore'; bar = newBar(); r = await bar.ask(tax);
  row('A2 Search this PC OFF, same question, model that ignores tools', 'same: tells the person Search this PC is off / how to turn it on', short(r), /search this pc|turn it on|settings/i.test(r.ans) && !r.needsWindow);
  await set({ pcSearchEnabled: true, pcSearchBarAuto: true, pcSearchAfter: 'read' });
  MODE = 'tools'; bar = newBar(); r = await bar.ask(tax);
  row('A3 Search this PC ON (auto on, after=read), model that calls tools', 'bar searches, finds both tax returns, answers from them, names the files; no window card', short(r), tools().includes('search_pc') && /tax return 2025/i.test(r.ans) && !r.needsWindow && r.pcStates.length > 0);
  MODE = 'ignore'; bar = newBar(); r = await bar.ask(tax);
  row('A4 Search this PC ON, model that IGNORES tools (the owner\'s case)', 'Bunny searches itself and still lists the tax returns (the owner: it "should just simply do that, rather than getting stuck and telling me to open the app")', short(r), /tax return/i.test(r.ans) && !/open the full|open .* bunny/i.test(r.ans) && !r.needsWindow);
  MODE = 'marker'; bar = newBar(); r = await bar.ask(tax);
  row('A5 Search this PC ON, model answers with the needs-window marker', 'bar searches or answers; no dead-end card', short(r), !r.needsWindow && /tax return/i.test(r.ans));
  // auto off
  await set({ pcSearchBarAuto: false }); MODE = 'tools'; bar = newBar(); r = await bar.ask(tax);
  row('A6 "Quick ask searches by itself" OFF, plain question', 'no file tool offered to the model; bar says to pick Search this PC in the + menu (or answers without files)', short(r), !tools().includes('search_pc') && !r.needsWindow, 'a plain "I cannot look at files here / open the full app" would be the dead end');
  bar = newBar(); r = await bar.ask(tax, true);
  row('A7 same, but Search this PC chosen in the + menu (force)', 'file tool offered; both tax returns found', short(r), tools().includes('search_pc') && /tax return/i.test(r.ans) && !r.needsWindow);
  await set({ pcSearchBarAuto: true });
  // after-a-search: show vs read
  await set({ pcSearchAfter: 'show' }); MODE = 'tools'; bar = newBar(); r = await bar.ask(tax);
  row('A8 "After a search" = Show what was found', 'bar shows the list; the files are NOT read (no "read" step)', short(r), r.pcStates.some((s) => s.startsWith('results')) && !r.pcStates.includes('read') && !r.pcStates.includes('reading'));
  await set({ pcSearchAfter: 'read' }); bar = newBar(); r = await bar.ask(tax);
  row('A9 "After a search" = Read the files, then answer', 'bar reads the best matches and names them (a "reading"/"read" step)', short(r), r.pcStates.includes('reading') || r.pcStates.includes('read'));
  // exclusions
  const docs = join(pcFake.home, 'Documents'); const ex = await set({ pcSearchExcluded: [docs] });
  MODE = 'tools'; bar = newBar(); r = await bar.ask(tax);
  row('A10 Excluded folders: Documents added', 'no result from Documents; the bar says nothing was found (with a note of exclusions)', short(r), !/tax return 2025/i.test(r.ans) && r.pcStates.some((s) => /none|results\((0|1)\)/.test(s)), 'settings reply ' + ex.status);
  await set({ pcSearchExcluded: [] });

  // ===== B. web flows =====
  const weather = 'weather in Islamabad today';
  MODE = 'tools'; bar = newBar(); r = await bar.ask(weather);
  row('B1 "weather in Islamabad today", model that calls web_search', 'searches, answers with the temperature and the source link; no card', short(r), searches.length >= 1 && /24 degrees/.test(r.ans) && /weather\.example\.test/.test(r.ans) && !r.needsWindow);
  const bFollow = await bar.ask('and tomorrow?');
  row('B2 follow-up in the same bar ("and tomorrow?") after B1', 'searches again or answers; stays in the bar', short(bFollow), bFollow.end === 'done' && !bFollow.needsWindow && bFollow.ans.length > 5);
  MODE = 'ignore'; bar = newBar(); r = await bar.ask(weather);
  row('B3 "weather in Islamabad today", model that IGNORES tools', 'Bunny searches by itself (the owner: "it should search the internet") and answers the weather', short(r), searches.length >= 1 && /24 degrees|clear/i.test(r.ans) && !/cannot browse/i.test(r.ans));
  r = await bar.ask('and tomorrow?');
  row('B4 follow-up after B3 (ignoring model)', 'still answers from the web', short(r), searches.length >= 1 && !/cannot browse|open the full/i.test(r.ans));
  bar = newBar(); r = await bar.ask('search the internet for the weather in Islamabad');
  row('B5 "search the internet for the weather in Islamabad", ignoring model', 'Bunny searches (retry) and answers', short(r), searches.length >= 1 && /24 degrees|clear/i.test(r.ans) && !/cannot browse/i.test(r.ans));
  MODE = 'tools'; bar = newBar(); r = await bar.ask('search the internet for the weather in Islamabad');
  row('B6 same, model that calls tools', 'searches once and answers', short(r), searches.length >= 1 && /24 degrees/.test(r.ans));
  MODE = 'marker'; bar = newBar(); r = await bar.ask(weather);
  row('B7 weather, model answers with the needs-window marker', 'no dead-end card; Bunny searches or shows words', short(r), !r.needsWindow && searches.length >= 1);
  MODE = 'ignore'; bar = newBar(); r = await bar.ask('what is the latest news about Pakistan cricket');
  row('B8 plain current-events question, ignoring model, no "search the internet" words', 'Bunny searches by itself', short(r), searches.length >= 1);
  MODE = 'ignore'; bar = newBar(); r = await bar.ask('hello, who are you?');
  row('B9 small talk (control)', 'answers, no search, no card', short(r), r.end === 'done' && !r.needsWindow);

  // ===== C. settings that survive a restart =====
  await set({ pcSearchEnabled: true, pcSearchBarAuto: false, pcSearchAfter: 'show', pcSearchExcluded: [docs] });
  await stopApp(); await startApp();
  const s = (await api('/api/settings')).json ?? {};
  row('C1 Search this PC settings survive a restart (enabled, auto off, after=show, 1 excluded folder)', 'all four come back as set', JSON.stringify({ on: s.pcSearchEnabled, auto: s.pcSearchBarAuto, after: s.pcSearchAfter, excluded: (s.pcSearchExcluded ?? []).length }), s.pcSearchEnabled === true && s.pcSearchBarAuto === false && s.pcSearchAfter === 'show' && (s.pcSearchExcluded ?? []).length === 1);
  MODE = 'tools'; bar = newBar(); r = await bar.ask(tax);
  row('C2 after the restart the bar behaves by those settings (auto off: no file tool)', 'no search_pc offered', short(r), !tools().includes('search_pc'));
  await set({ pcSearchEnabled: true, pcSearchBarAuto: true, pcSearchAfter: 'read', pcSearchExcluded: [] });
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); rows.push({ id: 'script', expected: '', actual: String(e), ok: false }); }
writeFileSync(OUT, JSON.stringify(rows, null, 1));
const bad = rows.filter((x) => !x.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed; ${bad.length} failed: ${bad.map((x) => x.id.split(' ')[0]).join(' ')}`);
try { await stopApp(); provider.close(); } catch { /* x */ }
process.exit(0);

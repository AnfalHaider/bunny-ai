/**
 * QA, v0.1.14 WEB-ACCESS: Quick ask asked to "search the internet for the weather in Islamabad", in the REAL bar (Electron, invented profile, no OS keys).
 * The model is a scripted OpenAI-compatible server that ALWAYS calls web_search first (what the owner's model did), then answers from the result.
 * The internet is a stand-in: the main process's fetch answers html.duckduckgo.com with a canned page; nothing leaves this PC.
 *   node e2e/w0114-qsearch.mjs
 */
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron } from 'playwright';

const root = process.cwd(); const exe = resolve(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0114q-data-')); const USER = mkdtempSync(join(tmpdir(), 'bunny-w0114q-user-'));
const rows = []; const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (id, label, ok, detail = '') => { rows.push({ id, label, ok: Boolean(ok), detail: String(detail) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 600) : '')); };
const NL = String.fromCharCode(10);
const SOURCE = 'https://weather.example.test/islamabad';

const seen = []; // what the model was sent: tool names offered, whether a tool result came back
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"qa-model"}]}'); return; }
    let body = {}; try { body = JSON.parse(raw); } catch { /* x */ }
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    const toolMsg = msgs.filter((m) => m.role === 'tool').map((m) => String(m.content));
    seen.push({ tools: (body.tools ?? []).map((t) => t.function?.name ?? t.name), toolResults: toolMsg.map((t) => t.slice(0, 160)) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const data = (o) => res.write('data: ' + JSON.stringify(o) + NL + NL);
    if (!toolMsg.length) {
      data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_ws1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'weather in Islamabad' }) } }] } }] });
      data({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] });
    } else {
      data({ choices: [{ delta: { content: 'Islamabad is 24 degrees and clear right now, from the search. Sources: ' + SOURCE + ' (Weather Example).' } }] });
      data({ choices: [{ delta: {}, finish_reason: 'stop' }] });
    }
    res.end('data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));

const env = { ...process.env, BUNNY_DATA_DIR: DATA }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS; delete env.BUNNY_FAKE_UPSTREAM;
const app = await _electron.launch({ executablePath: exe, args: [root, '--user-data-dir=' + USER], env, timeout: 90000 });
const win = await app.firstWindow(); await win.waitForLoadState('domcontentloaded'); await wait(2500);
const finish = async (code) => { try { await Promise.race([app.close(), wait(15000)]); } catch { /* x */ } try { provider.close(); } catch { /* x */ } const bad = rows.filter((r) => !r.ok); console.log(`\n${rows.length - bad.length} of ${rows.length} passed`); console.log('=== FAILED ==='); for (const r of bad) console.log(`${r.id} :: ${r.label} :: ${r.detail}`); process.exit(code ?? (bad.length ? 1 : 0)); };
const pageApi = (fnSrc, ...a) => win.evaluate(async ([src, args]) => { const m = await import('/src/ui/api.js'); return new Function('m', 'args', `return (async () => { ${src} })()`)(m, args); }, [fnSrc, a]);

try {
  await app.evaluate(({ app: a, globalShortcut, shell }) => {
    globalThis.__hot = null; globalThis.__shortcuts = []; globalThis.__fetches = [];
    globalShortcut.register = (acc, cb) => { globalThis.__shortcuts.push(acc); globalThis.__hot = cb; return true; };
    globalShortcut.unregister = () => {}; globalShortcut.isRegistered = () => true;
    a.setLoginItemSettings = () => {}; shell.openExternal = async () => {};
    // the internet: a stand-in search page; every other address goes where it went
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = String(url?.url ?? url);
      if (/html\.duckduckgo\.com/.test(u)) {
        globalThis.__fetches.push(u);
        const html = '<div class="result"><a class="result__a" href="https://weather.example.test/islamabad">Islamabad weather today</a><a class="result__snippet">Islamabad: 24 degrees, clear skies.</a></div>';
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return real(url, init);
    };
  });
  const port = provider.address().port;
  const made = await pageApi("return await m.sendJSON('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: args[0], apiKey: 'sk-qa-0000000000' });", `http://127.0.0.1:${port}/v1`).catch((e) => ({ error: String(e) }));
  const providers = await pageApi("return await m.getJSON('/api/providers');");
  const custom = (Array.isArray(providers) ? providers : providers.providers ?? []).find((p) => p.custom || /QA Harbor/.test(p.name ?? '')); const pid = custom?.id ?? made?.id;
  await pageApi("return await m.sendJSON('/api/settings', 'PUT', { providerId: args[0], model: 'qa-model' });", pid).catch(() => {});
  await win.reload(); await wait(2000);
  await win.evaluate(() => window.bunnyDesktop.setPrefs({ quickAskEnabled: true })); await wait(800);

  const barPage = async () => { for (let i = 0; i < 30; i++) { const p = app.windows().find((w) => /quick-ask\/bar\.html/.test(w.url())); if (p) return p; await wait(250); } return null; };
  await app.evaluate(() => globalThis.__hot()); const bar = await barPage(); await wait(900);
  check('QS-0', 'the bar opened', Boolean(bar));
  await bar.locator('#text').fill('search the internet for the weather in Islamabad'); await wait(300);
  await bar.locator('#go').click(); await wait(7000);
  const st = await bar.evaluate(() => ({
    ans: document.getElementById('ans')?.innerText ?? '', cardShown: !document.getElementById('card').hidden, cardTitle: document.querySelector('#card .t')?.textContent ?? '', cardBody: document.querySelector('#card .b')?.textContent ?? '',
    buttons: [...document.querySelectorAll('#card button, #foot button')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim()), keys: document.getElementById('keyline')?.textContent ?? '',
    bodyText: document.body.innerText.slice(0, 900),
  }));
  const fetches = await app.evaluate(() => globalThis.__fetches);
  console.log('model saw:', JSON.stringify(seen));
  check('QS-1', 'the model was offered web_search (and read_url) in the bar, and its search reached the (stand-in) web', seen[0]?.tools?.includes('web_search') && fetches.length >= 1, JSON.stringify({ offered: seen[0]?.tools, searches: fetches.length }));
  check('QS-2', 'the model got the search result back (a tool result containing the listed address)', seen.some((s) => s.toolResults.some((t) => t.includes('weather.example.test'))), JSON.stringify(seen.map((s) => s.toolResults)));
  check('QS-3', 'the bar shows the answer, with the source address in it', /24 degrees/.test(st.ans) && st.ans.includes(SOURCE), st.ans);
  check('QS-4', 'no "needs Bunny\'s window" card and no Open in Bunny asked for in place of the answer', !st.cardShown && !/This needs Bunny|open the full app|Open in Bunny/i.test(st.cardTitle + ' ' + st.cardBody) , JSON.stringify({ cardShown: st.cardShown, title: st.cardTitle, body: st.cardBody }));
  console.log('buttons now:', JSON.stringify(st.buttons), 'keys:', st.keys);
  await bar.screenshot({ path: join(DATA, 'qsearch-bar.png') }).catch(() => {}); console.log('picture:', join(DATA, 'qsearch-bar.png'));
  await finish();
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); rows.push({ id: 'script', label: 'script error', ok: false, detail: String(e) }); await finish(1); }

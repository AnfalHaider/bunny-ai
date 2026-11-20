/**
 * QA v0.1.15 F10 (one install card) in real use: Bunny's real server and chat page (Chromium, phone and desktop, light and dark), a scripted model, a stand-in GitHub and MCP server, invented profile.
 *   BUNNY_FAKE_UPSTREAM=1 node e2e/w0115-f10.mjs <outDir>
 */
process.env.BUNNY_FAKE_UPSTREAM = '1';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
const root = process.cwd(); const imp = (p) => import(pathToFileURL(resolve(root, p)).href);
const { createApp } = await imp('src/server/app.js'); const { memorySecretStore } = await imp('src/providers/connections.js');
const OUT = process.argv[2] ?? join(process.cwd(), 'f10-out'); mkdirSync(OUT, { recursive: true }); const NL = String.fromCharCode(10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rows = []; const flat = (s) => String(s ?? '').replace(/\s+/g, ' ');
const row = (id, expected, actual, ok) => { rows.push({ id, expected, actual: flat(actual).slice(0, 700), ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '\n   expected: ' + expected + '\n   actual:   ' + flat(actual).slice(0, 600)); };

let steps = []; let seen = [];
const call = (id, name, args) => ({ tool_calls: [{ index: 0, id, function: { name, arguments: JSON.stringify(args) } }] });
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"qa-model"}]}'); return; }
    const body = JSON.parse(raw); seen.push(body);
    const done = body.messages.filter((m) => m.role === 'tool').length; const step = steps[done];
    const forecast = (body.tools ?? []).find((d) => /forecast/.test(d.function.name));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    let delta;
    if (step === 'USE_FORECAST') delta = forecast ? call('f' + done, forecast.function.name, { city: 'Lisbon' }) : { content: 'The forecast tool is not available.' };
    else if (step) delta = call('c' + done, step.name, step.args);
    else delta = { content: 'All done: ' + flat(body.messages.filter((m) => m.role === 'tool').at(-1)?.content).slice(0, 120) };
    res.write('data: ' + JSON.stringify({ choices: [{ delta }] }) + NL + NL); res.end('data: [DONE]' + NL + NL);
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));

// stand-in GitHub (a normal plugin and a very long one) and a stand-in MCP server
const files = (long) => ({ 'README.md': '# x', 'plugin.json': JSON.stringify({ name: long ? 'huge-pack' : 'carrot-helper', description: 'QA plugin' }), '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' } } }),
  ...(long ? Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`skills/skill-number-${i}/SKILL.md`, `---${NL}name: skill-number-${i}${NL}description: ${'a long description '.repeat(6)}${NL}---${NL}Do it.`])) : {}) });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url?.url ?? url);
  const repoLong = /huge-pack/.test(u);
  if (/api\.github\.com\/repos\/[^/]+\/[^/]+\/git\/trees/.test(u)) { const f = files(repoLong); return new Response(JSON.stringify({ tree: Object.keys(f).map((path) => ({ path, type: 'blob', size: f[path].length })) }), { status: 200 }); }
  if (/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(u)) return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
  const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(u);
  if (m) { const f = files(repoLong); return f[m[1]] !== undefined ? new Response(f[m[1]], { status: 200 }) : new Response('not found', { status: 404 }); }
  if (u === 'https://weather.example.com/mcp') {
    const rpc = JSON.parse(String(init?.body ?? '{}')); const reply = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 's1' } });
    if (rpc.method === 'initialize') return reply({ protocolVersion: rpc.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'weather', version: '1' } });
    if (rpc.method === 'tools/list') return reply({ tools: [{ name: 'forecast', description: 'The forecast for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } } }, annotations: { readOnlyHint: true } }] });
    if (rpc.method === 'tools/call') return reply({ content: [{ type: 'text', text: 'Sunny in Lisbon, 24 degrees' }] });
    return new Response('', { status: 202 });
  }
  return realFetch(url, init);
};

const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115g-data-'));
const bunny = await createApp({ dataDir: DATA, fake: true, secretStore: memorySecretStore(), localGuard: true, folderPickerOnly: false, lanAddress: '127.0.0.2', networkProfile: async () => ({ name: 'Test network', category: 'Private' }) });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${bunny.server.address().port}`;
const api = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j, text: t }; };
await api('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'sk-qa-0000000000' });
const plist = (await api('/api/providers')).json; const pid = (Array.isArray(plist) ? plist : plist.providers).find((p) => p.custom || /QA Harbor/.test(p.name)).id;
await api('/api/settings', 'PUT', { providerId: pid, model: 'qa-model', callName: 'Pat' });
const reset = async () => { for (const c of (await api('/api/mcp')).json ?? []) await api('/api/mcp/' + c.id, 'DELETE'); for (const p of ((await api('/api/settings')).json?.plugins ?? [])) await api('/api/plugins/' + p.id, 'DELETE'); for (const s of (await api('/api/skills')).json ?? []) await api('/api/skills/' + s.id, 'DELETE'); };
const newChat = async (mode) => { const s = (await api('/api/sessions', 'POST', { title: 'QA', providerId: pid, model: 'qa-model', workMode: 'chat' })).json; await api(`/api/sessions/${s.id}/setting/permissionMode`, 'PATCH', { value: mode }); return s.id; };
const browser = await chromium.launch();
const addWeather = { name: 'add_connector', args: { name: 'Weather', url: 'https://weather.example.com/mcp' } };
const installPlugin = (n) => ({ name: 'install_plugin', args: { url: `https://github.com/bunny/${n}` } });

// one reply driven through the real chat page; `choose` is the label to click (or null to only look)
async function useUi({ mode, steps: s, choose, viewport = { width: 1280, height: 800 }, scheme = 'light', shot, mobile = false }) {
  await reset(); seen = []; steps = s; const sid = await newChat(mode);
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, isMobile: mobile, hasTouch: mobile }); const page = await ctx.newPage();
  await page.goto(`${base}/?chat=${sid}`); await wait(1800);
  // open the chat from the sidebar if the page did not
  if (!(await page.locator('#input').isVisible())) { await page.locator('#menu-button, #sidebar-toggle').first().click().catch(() => {}); }
  const open = await page.evaluate((id) => { const el = [...document.querySelectorAll('[data-id], .chat-row, .session')].find((e) => (e.dataset?.id ?? '') === id); el?.click(); return Boolean(el); }, sid).catch(() => false);
  if (open) await wait(800);
  await page.locator('#input').fill('please add a weather tool and tell me the forecast for Lisbon'); await page.locator('#send').click();
  const heading = page.locator('h4').filter({ hasText: /Install/ }).first();
  const appeared = await heading.waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
  const info = appeared ? await page.evaluate(() => { const h = [...document.querySelectorAll('h4')].find((x) => /Install/.test(x.textContent)); const card = h.closest('div'); const btns = [...card.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().height > 0); const vw = innerWidth; const vh = innerHeight; return { title: h.textContent, detail: (card.innerText ?? '').replace(/\s+/g, ' ').slice(0, 400), buttons: btns.map((b) => ({ text: b.textContent.trim(), cls: b.className, w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height), l: Math.round(b.getBoundingClientRect().left), r: Math.round(b.getBoundingClientRect().right), bg: getComputedStyle(b).backgroundColor, color: getComputedStyle(b).color })), vw, vh, sideways: document.documentElement.scrollWidth > innerWidth + 1, cardsCount: document.querySelectorAll('h4').length }; }) : null;
  if (shot && appeared) await page.screenshot({ path: join(OUT, shot) }).catch(() => {});
  let after = null; let toolAsked = false;
  if (appeared && choose) { await page.getByRole('button', { name: choose, exact: true }).click(); await wait(2500); const allow = page.getByRole('button', { name: 'Allow', exact: true }).first(); if (await allow.isVisible().catch(() => false)) { toolAsked = true; await allow.click().catch(() => {}); } await page.locator('#stop').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {}); await wait(1500); after = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(-600)); }
  const mcp = (await api('/api/mcp')).json ?? []; const settings = (await api('/api/settings')).json ?? {}; const skills = (await api('/api/skills')).json ?? [];
  const cardsHeadings = appeared ? await page.evaluate(() => [...document.querySelectorAll('h4')].map((h) => h.textContent).filter((t) => /Install|Switch on|Allow/.test(t))) : [];
  await ctx.close();
  return { toolAsked, appeared, info, after, mcp: mcp.map((c) => [c.name, c.enabled]), plugins: (settings.plugins ?? []).map((p) => p.name), skills: skills.map((s) => [s.name, s.enabled]), requests: seen.length, forecastOffered: seen.slice(1).some((b) => (b.tools ?? []).some((d) => /forecast/.test(d.function.name))), toolMsgs: seen.at(-1)?.messages.filter((m) => m.role === 'tool').map((m) => flat(m.content).slice(0, 420)) ?? [], cardsHeadings };
}
const labels = (r) => (r.info?.buttons ?? []).map((b) => b.text);
const THREE = ['Install and switch on', 'Install, keep off', "Don't install"];

try {
  for (const mode of ['ask', 'auto']) {
    const r = await useUi({ mode, steps: [addWeather, 'USE_FORECAST'], choose: 'Install and switch on', shot: `card-${mode}-desktop-light.png` });
    row(`F10-1 (${mode}) remote connector: one card, three choices, Install and switch on`, 'exactly one card with the three buttons in order; the connector is on; the connector tool is offered in the model\'s next request of the SAME reply and its result reaches the chat', JSON.stringify({ title: r.info?.title, buttons: labels(r), cardsOnPageWhenShown: r.info?.cardsCount, connectors: r.mcp, forecastOffered: r.forecastOffered, resultInChat: /Sunny in Lisbon/.test(r.after ?? ''), toolAsked: r.toolAsked }), r.appeared && JSON.stringify(labels(r)) === JSON.stringify(THREE) && r.info?.cardsCount === 1 && r.mcp.length === 1 && r.mcp[0][1] === true && r.forecastOffered && /Sunny in Lisbon/.test(r.after ?? ''));
  }
  for (const mode of ['ask', 'auto']) {
    const r = await useUi({ mode, steps: [addWeather], choose: 'Install, keep off' });
    row(`F10-2 (${mode}) Install, keep off`, 'installed but off; no tool offered; the model is told it was kept off', JSON.stringify({ connectors: r.mcp, forecastOffered: r.forecastOffered, toolMsgs: r.toolMsgs }), r.mcp.length === 1 && r.mcp[0][1] === false && !r.forecastOffered && /switched OFF/i.test(r.toolMsgs.join(' ')));
    const n = await useUi({ mode, steps: [addWeather], choose: "Don't install" });
    row(`F10-3 (${mode}) Don't install`, 'nothing installed; no connector; the model is told it was refused', JSON.stringify({ connectors: n.mcp, plugins: n.plugins, toolMsgs: n.toolMsgs }), n.mcp.length === 0 && n.plugins.length === 0 && /denied|not allowed|declin|did not|refus|no/i.test(n.toolMsgs.join(' ')));
  }
  { const r = await useUi({ mode: 'ask', steps: [installPlugin('carrot-helper'), 'USE_FORECAST'], choose: 'Install and switch on', shot: 'plugin-card-desktop-light.png' });
    row('F10-4 plugin: the card lists every part, Install and switch on makes the tool usable in the same reply', 'one card naming the plugin and its connector address; after the yes the connector tool is used in the same reply', JSON.stringify({ title: r.info?.title, detail: r.info?.detail?.slice(0, 260), buttons: labels(r), connectors: r.mcp, forecastOffered: r.forecastOffered, cardsOnPageWhenShown: r.info?.cardsCount }), r.appeared && JSON.stringify(labels(r)) === JSON.stringify(THREE) && /weather\.example\.com/.test(r.info.detail) && r.mcp[0]?.[1] === true && r.forecastOffered && r.info?.cardsCount === 1 && r.after && /Sunny in Lisbon/.test(r.after)); }
  { const r = await useUi({ mode: 'auto', steps: [installPlugin('huge-pack')], choose: 'Install, keep off', shot: 'plugin-toolong-desktop-light.png' });
    row('F10-5 too-long plugin (30 skills): no switch-on button', 'only "Install, keep off" and "Don\'t install"; title says Install (not switch on); body says too long and that it installs off; installed off', JSON.stringify({ title: r.info?.title, buttons: labels(r), detail: r.info?.detail?.slice(0, 160), connectors: r.mcp, skillsOn: r.skills.filter((s) => s[1]).length, skills: r.skills.length, plugins: r.plugins }), r.appeared && JSON.stringify(labels(r)) === JSON.stringify(['Install, keep off', "Don't install"]) && /Too long to show/.test(r.info.detail) && r.mcp.every((c) => c[1] === false) && r.skills.every((s) => s[1] === false) && r.plugins.length === 1); }
  // phone and desktop, both themes: the card itself
  for (const [name, viewport, scheme, mobile] of [['desktop-dark', { width: 1280, height: 800 }, 'dark', false], ['phone-light', { width: 390, height: 740 }, 'light', true], ['phone-dark', { width: 390, height: 740 }, 'dark', true], ['phone-small-light', { width: 360, height: 640 }, 'light', true]]) {
    const r = await useUi({ mode: 'ask', steps: [addWeather], choose: 'Install, keep off', viewport, scheme, mobile, shot: `card-${name}.png` });
    const b = r.info?.buttons ?? []; const prim = b.find((x) => /primary/.test(x.cls)); const other = b.find((x) => !/primary/.test(x.cls));
    row(`F10-6 card at ${name}`, 'three labelled buttons all whole on screen, none under 28 px tall (a 44 px touch target is the guideline: sizes are reported), no sideways scroll, the primary button looks different from the others', JSON.stringify({ buttons: b.map((x) => `${x.text} ${x.w}x${x.h} @${x.l}-${x.r}`), vw: r.info?.vw, sideways: r.info?.sideways, primaryBg: prim?.bg, otherBg: other?.bg }), r.appeared && b.length === 3 && b.every((x) => x.l >= 0 && x.r <= r.info.vw + 1 && x.h >= 28) && !r.info.sideways && prim && other && prim.bg !== other.bg);
  }
  // a device never sees the card
  await reset(); steps = [addWeather, 'USE_FORECAST']; seen = [];
  const passcode = 'qa-passcode-0115-abcdef'; const on = await api('/api/remote', 'PUT', { enabled: true, passcode }); const remoteUrl = (on.json?.url ?? '').replace(/\/$/, '');
  for (const level of ['chats', 'everything']) {
    await reset(); seen = []; steps = [addWeather, 'USE_FORECAST'];
    const ctx = await browser.newContext(); const sin = await ctx.request.post(remoteUrl + '/api/remote/signin', { data: { passcode } }); const st = await api('/api/remote'); const dev = (st.json?.devices ?? []).slice(-1)[0];
    const lv = await api(`/api/remote/devices/${dev.id}/level`, 'PATCH', { level });
    const meA = await (await ctx.request.get(remoteUrl + '/api/remote/me')).json(); const s = await (await ctx.request.post(remoteUrl + '/api/sessions', { headers: { 'x-bunny-csrf': meA.csrf }, data: { title: 'dev', providerId: pid, model: 'qa-model', workMode: 'chat' } })).json();
    const me = await (await ctx.request.get(remoteUrl + '/api/remote/me')).json(); const cookie = (await ctx.cookies()).map((c) => c.name + '=' + c.value).join('; '); const ac = new AbortController(); const killer = setTimeout(() => ac.abort(), 20000); let text = ''; let hung = false; let answeredDev = false; let devAnswer = null; try { const resp = await realFetch(`${remoteUrl}/api/sessions/${s.id}/messages`, { method: 'POST', signal: ac.signal, headers: { 'content-type': 'application/json', cookie, 'x-bunny-csrf': me.csrf }, body: JSON.stringify({ content: 'add a weather tool', providerId: pid, model: 'qa-model', workMode: 'chat' }) }); const rd = resp.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; text += new TextDecoder().decode(value); const pm = !answeredDev && new RegExp("event: permission" + String.fromCharCode(10) + "data: (.*)").exec(text); if (pm) { answeredDev = true; const card = JSON.parse(pm[1]); const ar = await realFetch(`${remoteUrl}/api/sessions/${s.id}/permission/${card.id}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie, 'x-bunny-csrf': me.csrf }, body: JSON.stringify({ allowed: true, choice: 'on' }) }); devAnswer = ar.status + ' ' + (await ar.text()).slice(0, 160); } } } catch { hung = !/event: done/.test(text); } clearTimeout(killer);
    await wait(1500); const mcp = (await api('/api/mcp')).json ?? [];
    row(`F10-7 a device at ${level} asks the model to add a connector`, level === 'everything' ? 'by design (DEVICE-FULL: an Everything device is treated as the window) the card IS shown and can be answered; recorded, not a failure' : 'no install card is ever sent to the device; nothing is installed', JSON.stringify({ signin: sin.status(), level: lv.status, permissionEvents: (text.match(/event: permission/g) ?? []).length, deviceAnsweredCardWith: devAnswer, hungUntilAbort: hung, events: [...new Set((text.match(/event: w+/g) ?? []))].join(','), installOffered: seen.some((b) => (b.tools ?? []).some((d) => /^(install_plugin|add_connector|install_from_github)$/.test(d.function.name))), connectors: mcp.length, tail: flat(text).slice(-200) }), sin.ok() && (level === 'everything' ? /event: permission/.test(text) : !/event: permission/.test(text) && !hung && mcp.length === 0));
    await ctx.close();
  }
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); rows.push({ id: 'script', expected: '', actual: String(e), ok: false }); }
writeFileSync(join(OUT, 'f10.json'), JSON.stringify(rows, null, 1));
const bad = rows.filter((x) => !x.ok); console.log('\n' + (rows.length - bad.length) + ' of ' + rows.length + ' passed; failed: ' + bad.map((x) => x.id.split(' ')[0]).join(' '));
try { await browser.close(); globalThis.fetch = realFetch; provider.close(); await bunny.close?.(); bunny.server.close(); } catch { /* x */ }
process.exit(0);

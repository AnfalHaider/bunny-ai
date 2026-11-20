/**
 * QA v0.1.15 SETTINGS BEHAVIOUR: for each server-side setting, the same chat message is sent with the setting in each state to a scripted model that records the request it gets
 * (system text, tools, token limit, effort). A setting "changes behaviour" if the request, the reply or the saved data differs. Invented profile, test mode.
 *   BUNNY_FAKE_UPSTREAM=1 node e2e/w0115-sbehave.mjs <outFile.json>
 */
process.env.BUNNY_FAKE_UPSTREAM = '1';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(); const imp = (p) => import(pathToFileURL(resolve(root, p)).href);
const { createApp } = await imp('src/server/app.js'); const { memorySecretStore } = await imp('src/providers/connections.js');
const OUT = process.argv[2] ?? join(process.cwd(), 'sbehave.json'); const NL = String.fromCharCode(10);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let last = null; const seen = [];
const provider = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"qa-model"},{"id":"other-model"},{"id":"third-model"}]}'); return; }
    let b = {}; try { b = JSON.parse(raw); } catch { /* x */ }
    last = b; seen.push(b);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Noted. This is the reply.' } }] }) + NL + NL); res.write('data: [DONE]' + NL + NL); res.end();
  });
});
await new Promise((r) => provider.listen(0, '127.0.0.1', r));
const DATA = mkdtempSync(join(tmpdir(), 'bunny-w0115b-data-')); const FOLDER = mkdtempSync(join(tmpdir(), 'bunny-w0115b-folder-'));
const bunny = await createApp({ dataDir: DATA, fake: true, secretStore: memorySecretStore(), localGuard: true, folderPickerOnly: false });
await new Promise((r) => bunny.server.listen(0, '127.0.0.1', r));
const api = async (path, method = 'GET', body) => { const r = await bunny.adminFetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { /* x */ } return { status: r.status, json: j, text: t }; };
await bunny.chooseFolder(FOLDER);
await api('/api/providers/custom', 'POST', { name: 'QA Harbor', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'sk-qa-0000000000' });
const plist = (await api('/api/providers')).json; const pid = (Array.isArray(plist) ? plist : plist.providers).find((p) => p.custom || /QA Harbor/.test(p.name)).id;
await api('/api/settings', 'PUT', { providerId: pid, model: 'qa-model' });
const ask = async (text = 'Please write a short note about my trip.', mode = 'chat', extra = {}) => {
  last = null; const s = (await api('/api/sessions', 'POST', { title: 'QA', providerId: pid, model: 'qa-model', workMode: mode })).json;
  const r = await api(`/api/sessions/${s.id}/messages`, 'POST', { content: text, providerId: pid, model: 'qa-model', workMode: mode, ...extra }); await wait(400);
  return { req: last, text: r.text, session: s.id };
};
const sysOf = (b) => (b?.messages ?? []).filter((m) => m.role === 'system').map((m) => String(m.content)).join(' ');
const sig = (r) => ({ sys: sysOf(r.req), tools: (r.req?.tools ?? []).map((t) => t.function?.name).sort(), max: r.req?.max_tokens ?? r.req?.max_completion_tokens ?? null, effort: r.req?.reasoning_effort ?? r.req?.reasoning?.effort ?? null, keys: Object.keys(r.req ?? {}).sort().join(','), msgs: (r.req?.messages ?? []).length });
const rows = [];
const test = async (key, label, aPatch, bPatch, opts = {}) => {
  await api('/api/settings', 'PUT', aPatch); const a = await ask(opts.text, opts.mode, opts.extra); const sa = sig(a);
  await api('/api/settings', 'PUT', bPatch); const b = await ask(opts.text, opts.mode, opts.extra); const sb = sig(b);
  const diffs = [];
  if (sa.sys !== sb.sys) { const wa = new Set(sa.sys.split(/\s+/)); const added = sb.sys.split(/\s+/).filter((w) => !wa.has(w)).slice(0, 14).join(' '); const wb = new Set(sb.sys.split(/\s+/)); const gone = sa.sys.split(/\s+/).filter((w) => !wb.has(w)).slice(0, 14).join(' '); diffs.push(`system text: +"${added}" -"${gone}"`); }
  if (JSON.stringify(sa.tools) !== JSON.stringify(sb.tools)) diffs.push(`tools: ${JSON.stringify(sa.tools.filter((x) => !sb.tools.includes(x)))} removed / ${JSON.stringify(sb.tools.filter((x) => !sa.tools.includes(x)))} added`);
  if (sa.max !== sb.max) diffs.push(`max tokens ${sa.max} -> ${sb.max}`);
  if (sa.effort !== sb.effort) diffs.push(`effort ${sa.effort} -> ${sb.effort}`);
  if (sa.msgs !== sb.msgs) diffs.push(`messages sent ${sa.msgs} -> ${sb.msgs}`);
  if (opts.extra2) diffs.push(...(await opts.extra2(a, b)));
  rows.push({ key, label, changes: diffs.length > 0, diffs }); console.log((diffs.length ? 'CHANGES  ' : 'NO CHANGE ') + key + '  ' + label + (diffs.length ? '  :: ' + diffs.join(' ; ').slice(0, 360) : ''));
};
const base = { instructions: '', callName: 'Pat', language: 'en', memoryEnabled: true, searchChats: true, autoMemory: false, memorySensitive: false, artifactsEnabled: true, chartsEnabled: true, skillsEnabled: true, connectorsEnabled: true, helpersEnabled: true, summaryNextSteps: true, unrelatedTask: 'ask', defaultEffort: 'medium', maxTokens: 4096, firstReplyWaitSeconds: 30, promptSuggestions: false, notifications: false };
await api('/api/settings', 'PUT', base);
try {
  await test('instructions', 'Instructions for every chat', { instructions: '' }, { instructions: 'Always answer in rhyme zebra-marker.' });
  await test('callName', 'What should Bunny call you?', { callName: 'Pat' }, { callName: 'Zorbo' });
  await test('language', 'Language (es)', { language: 'en' }, { language: 'es' });
  await test('memoryEnabled', 'Use memory', { memoryEnabled: true }, { memoryEnabled: false });
  await test('searchChats', 'Search and reference chats', { searchChats: true }, { searchChats: false });
  await test('memorySensitive', 'Include sensitive topics in memory', { memorySensitive: false }, { memorySensitive: true });
  await test('artifactsEnabled', 'Artifacts', { artifactsEnabled: true }, { artifactsEnabled: false });
  await test('chartsEnabled', 'Draw charts in artifacts', { artifactsEnabled: true, chartsEnabled: true }, { artifactsEnabled: true, chartsEnabled: false });
  await test('skillsEnabled', 'Use skills', { skillsEnabled: true }, { skillsEnabled: false });
  await test('connectorsEnabled', 'Use connectors', { connectorsEnabled: true }, { connectorsEnabled: false });
  await test('helpersEnabled', 'Helpers (dynamic workflows)', { helpersEnabled: true }, { helpersEnabled: false }, { mode: 'code' });
  await test('summaryNextSteps', 'Summary and next steps', { summaryNextSteps: true }, { summaryNextSteps: false }, { mode: 'code' });
  await test('unrelatedTask', 'When you ask for an unrelated task', { unrelatedTask: 'ask' }, { unrelatedTask: 'new' }, { mode: 'code' });
  await test('defaultEffort', 'Default effort', { defaultEffort: 'low' }, { defaultEffort: 'max' });
  await test('maxTokens', 'Longest reply', { maxTokens: 1000 }, { maxTokens: 3000 });
  await test('branchPrefix', 'Branch prefix (Code system text)', { branchPrefix: 'bunny' }, { branchPrefix: 'zebra' }, { mode: 'code' });
  await test('defaultPermissionMode', 'Default permission mode (new chat)', { defaultPermissionMode: 'ask' }, { defaultPermissionMode: 'plan' }, { mode: 'code' });
  await test('autoMemory', 'Generate memory from chats', { autoMemory: false }, { autoMemory: true }, { extra2: async () => { const m = await api('/api/memory'); return []; } });
  // allowlist and aliases act on the model list
  const modelsOf = async () => ((await api('/api/models')).json?.models ?? (await api('/api/models')).json ?? []).map?.((m) => m.id ?? m).join(',') ?? '';
  await api('/api/settings', 'PUT', { allowlist: [], aliases: {} }); const allA = await modelsOf();
  await api('/api/settings', 'PUT', { allowlist: ['qa-model'] }); const allB = await modelsOf();
  rows.push({ key: 'allowlist', label: 'Allowed models', changes: allA !== allB, diffs: [`model list ${JSON.stringify(allA).slice(0, 100)} -> ${JSON.stringify(allB).slice(0, 100)}`] }); console.log('allowlist', allA, '->', allB);
  await api('/api/settings', 'PUT', { allowlist: [] });
  const al = await api('/api/settings', 'PUT', { aliases: { fast: 'qa-model' } }); rows.push({ key: 'aliases', label: 'Aliases (name = model-id)', changes: al.status === 200 && Object.keys((await api('/api/settings')).json.aliases ?? {}).length === 1, diffs: ['saved ' + JSON.stringify((await api('/api/settings')).json.aliases)] });
  const sk = await api('/api/skills', 'POST', { name: 'qa-zebra-skill', description: 'Use when the person mentions zebras', instructions: 'Always mention zebra-skill-marker.', enabled: true });
  console.log('skill added', sk.status);
  await test('skillsEnabled+skill', 'Use skills (with one skill installed and on)', { skillsEnabled: true }, { skillsEnabled: false });
  await test('unrelatedTask-here', 'When you ask for an unrelated task = Do it here (vs ask)', { unrelatedTask: 'ask' }, { unrelatedTask: 'here' }, { mode: 'code' });
  const memBefore = ((await api('/api/memory')).json ?? []).length;
  await api('/api/settings', 'PUT', { autoMemory: false, memoryEnabled: true }); await ask('My name is Zorbo and I live in Lisbon. Remember that my favourite colour is teal.'); await wait(600);
  const memOff = ((await api('/api/memory')).json ?? []).length;
  await api('/api/settings', 'PUT', { autoMemory: true }); await ask('My name is Zorbo and I live in Lisbon. Remember that my favourite colour is teal.'); await wait(900);
  const memOn = ((await api('/api/memory')).json ?? []).length;
  rows.push({ key: 'autoMemory(effect)', label: 'Generate memory from chats', changes: memOn > memOff, diffs: ['memory entries: before ' + memBefore + ', after a message with autoMemory off ' + memOff + ', with it on ' + memOn] }); console.log('autoMemory memory entries', memBefore, memOff, memOn);
  // first reply wait: is it passed to the stream?
  console.log('--- done');
} catch (e) { console.log('SCRIPT ERROR', e?.stack ?? e); }
writeFileSync(OUT, JSON.stringify(rows, null, 1));
try { provider.close(); await bunny.close?.(); bunny.server.close(); } catch { /* x */ }
process.exit(0);

/**
 * QA, v0.1.9 qa-batch (883dafd) on the candidate head: (1) the quick-ask bar refuses by the chat's own limits with plain size messages (text over 128 KB, picture or
 * screenshot over 3 MB, PDF up to 8 MB; never the key message); (2) a 2 MB picture reaches the chat (message route body cap 48 MB); (3) G11: two plugins share a
 * connector, uninstall (or update) one, the connector stays with the other and goes with the last.
 *   node e2e/w019-qabatch.mjs
 */
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import net from 'node:net';

const imp = (p) => import(pathToFileURL(join(process.cwd(), p)).href);
const L = await imp('electron/quick-ask-logic.js'); const { startApp } = await imp('test/helpers.js'); const { createAppTools } = await imp('src/server/appTools.js'); const { createSkillStore } = await imp('src/server/skills.js'); const { createMcpStore } = await imp('src/server/mcpStore.js');
const NL = String.fromCharCode(10); const CRLF = String.fromCharCode(13, 10); const j = { 'content-type': 'application/json' }; const MB = 1024 * 1024;
const rows = []; const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log((ok ? 'PASS' : 'FAIL') + '  ' + id + '  ' + label + (detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 300) : '')); };
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const PNGH = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const png = (n) => Buffer.concat([PNGH, Buffer.alloc(Math.max(0, n - PNGH.length))]); const pdf = (n) => Buffer.concat([Buffer.from('%PDF-1.4' + NL), Buffer.alloc(Math.max(0, n - 9), 0x20)]); const txt = (n) => Buffer.alloc(n, 'hello world ');

// ===== (1) the bar's size rules
const cf = (name, bytes) => L.checkFile(name, bytes);
const r = {
  text100: cf('a.txt', txt(100 * 1024)), text128: cf('a.txt', txt(128 * 1024)), text129: cf('a.txt', txt(128 * 1024 + 1)), text200: cf('a.txt', txt(200 * 1024)), text5m: cf('a.txt', txt(5 * MB)),
  png2: cf('a.png', png(2 * MB)), png3: cf('a.png', png(3 * MB)), png3p: cf('a.png', png(3 * MB + 1)), png7: cf('a.png', png(7 * MB)),
  pdf1: cf('a.pdf', pdf(1 * MB)), pdf8: cf('a.pdf', pdf(8 * MB)), pdf8p: cf('a.pdf', pdf(8 * MB + 10)),
};
check('B1', 'text: 100 KB and exactly 128 KB are accepted; 128 KB + 1, 200 KB and 5 MB are refused with "The text file is over 128 KB." (never the key-or-password message)', r.text100.ok && r.text128.ok && [r.text129, r.text200, r.text5m].every((x) => !x.ok && x.message === 'The text file is over 128 KB.'), [r.text129, r.text200, r.text5m].map((x) => x.message).join(' | '));
check('B2', 'picture: 2 MB and exactly 3 MB are accepted; 3 MB + 1 and 7 MB are refused with "The picture is over 3 MB."', r.png2.ok && r.png3.ok && [r.png3p, r.png7].every((x) => !x.ok && x.message === 'The picture is over 3 MB.'), [r.png3p, r.png7].map((x) => x.message).join(' | '));
check('B3', 'PDF: 1 MB and exactly 8 MB are accepted; 8 MB + 10 is refused with "The file is over 8 MB."', r.pdf1.ok && r.pdf8.ok && !r.pdf8p.ok && r.pdf8p.message === 'The file is over 8 MB.', r.pdf8p.message);
const shot = (n) => ({ data: 'data:image/png;base64,' + png(n).toString('base64') });
const s2 = L.validateSubmission('hi', [shot(2 * MB)]); const s3p = L.validateSubmission('hi', [shot(3 * MB + 1)]); const s3 = L.validateSubmission('hi', [shot(3 * MB)]);
check('B4', 'screenshot: 2 MB and exactly 3 MB are accepted; over 3 MB is refused with "The screenshot is over 3 MB."', s2.ok && s3.ok && !s3p.ok && s3p.message === 'The screenshot is over 3 MB.', s3p.message);
check('B5', 'a secret-looking small text file still gets the key message (the size rule does not hide it) and a small secret is not accepted', (() => { const x = cf('c.txt', Buffer.from('api_key = sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6')); return !x.ok && x.message === L.SECRET_FILE_MESSAGE; })(), '');

// ===== (2) a 2 MB picture reaches the chat; the body cap is 48 MB
const seen = [];
const up = createServer((req, res) => { let raw = ''; req.on('data', (c) => { raw += c; }); req.on('end', () => { if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; } seen.push(JSON.parse(raw)); res.writeHead(200, { 'content-type': 'text/event-stream' }); res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'got it' } }] }) + NL + NL + 'data: [DONE]' + NL + NL); }); });
await new Promise((rr) => up.listen(0, '127.0.0.1', rr)); cleanups.push(() => new Promise((rr) => { up.closeAllConnections?.(); up.close(rr); }));
const { base } = await startApp(t, { fake: false }); const port = +new URL(base).port;
await fetch(base + '/api/providers/openai/connect', { method: 'POST', headers: j, body: JSON.stringify({ apiKey: 'sk-test-000000000000', baseUrl: 'http://127.0.0.1:' + up.address().port + '/v1' }) });
const sid = (await (await fetch(base + '/api/sessions', { method: 'POST', headers: j, body: JSON.stringify({ title: 'qa' }) })).json()).id;
const send = async (attachments) => { const res = await fetch(base + '/api/sessions/' + sid + '/messages', { method: 'POST', headers: j, body: JSON.stringify({ content: 'what is this', providerId: 'openai', model: 'gpt-4o', workMode: 'chat', attachments }) }); return { status: res.status, text: await res.text() }; };
const two = await send([{ name: 'p.png', mime: 'image/png', kind: 'image', data: 'data:image/png;base64,' + png(2 * MB).toString('base64') }]);
const img = seen.at(-1)?.messages?.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p) => p.type === 'image_url') ?? [];
check('C1', 'a 2 MB picture sent with a message reaches the chat and the model gets the image (it failed at 1 MB before)', two.status === 200 && /got it/.test(two.text) && img.length === 1, 'HTTP ' + two.status + '; image parts ' + img.length + '; ' + two.text.slice(0, 80));
const fiveMb = await send([{ name: 'big.png', mime: 'image/png', kind: 'image', data: 'data:image/png;base64,' + png(5 * MB).toString('base64') }]);
check('C2', 'a 5 MB picture (over the chat\'s own 4 MB limit) is refused by the chat with a plain size message, not a generic body error', /too large|4 MB|Images must be under/i.test(fiveMb.text) && !/request\.tooLarge/.test(fiveMb.text), 'HTTP ' + fiveMb.status + '; ' + fiveMb.text.slice(0, 160));
const over = await new Promise((rr) => { const s = net.connect(port, '127.0.0.1'); let d = ''; s.on('data', (x) => { d += x; }); s.on('error', () => {}); s.write('POST /api/sessions/' + sid + '/messages HTTP/1.1' + CRLF + 'Host: x' + CRLF + 'Content-Type: application/json' + CRLF + 'Content-Length: ' + 60 * MB + CRLF + 'Connection: close' + CRLF + CRLF); setTimeout(() => { const m = /^HTTP\/1\.1 (\d+)/.exec(d); rr({ status: m ? +m[1] : 0, body: d.split(CRLF + CRLF)[1] ?? '' }); s.destroy(); }, 700); });
check('C3', 'a message DECLARED at 60 MB is refused at once as too large ("over 48 MB")', over.status === 413 && /48 MB/.test(over.body), 'HTTP ' + over.status + '; ' + over.body.slice(0, 100));
const normal = await send([]); check('C4', 'an ordinary message still works', normal.status === 200 && /got it/.test(normal.text), 'HTTP ' + normal.status);

// ===== (3) G11: two plugins share a connector
const skillMd = (name) => '---' + NL + 'name: ' + name + NL + 'description: about ' + name + NL + '---' + NL + 'body of ' + name;
const files = { current: {} };
const github = async (url) => { if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files.current).map((path) => ({ path, type: 'blob' })) }), { status: 200 }); const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url); if (m && files.current[m[1]] !== undefined) return new Response(files.current[m[1]], { status: 200 }); return new Response('nf', { status: 404 }); };
const dir = await mkdtemp(join(tmpdir(), 'bunny-w019-g11-')); cleanups.push(() => rm(dir, { recursive: true, force: true }));
const skills = createSkillStore({ file: join(dir, 'skills.json') }); const mcp = createMcpStore({ file: join(dir, 'mcp.json') }); let settings = {};
const tools = createAppTools({ skills, mcp, getSettings: () => settings, saveSettings: async (p) => { settings = { ...settings, ...p }; }, fetchImpl: github });
const SHARED = 'https://shared.example.com/mcp';
const pack = (name, extraConn) => ({ 'plugin.json': JSON.stringify({ name, description: name }), ['skills/' + name + '/SKILL.md']: skillMd(name), '.mcp.json': JSON.stringify({ mcpServers: { shared: { url: SHARED }, ...(extraConn ? { own: { url: extraConn } } : {}) } }) });
files.current = pack('pack-a', 'https://a-only.example.com/mcp'); const A = (await tools.installFromGithub('https://github.com/o/pack-a')).record;
files.current = pack('pack-b'); const B = (await tools.installFromGithub('https://github.com/o/pack-b')).record;
const conns = async () => (await mcp.list()).map((c) => c.url);
check('G1', 'installing a second plugin that names the same connector address does not make a second connector (one at the shared address)', (await conns()).filter((u) => u === SHARED).length === 1, JSON.stringify(await conns()));
await tools.uninstall(A.id);
const afterA = await conns();
check('G2', 'uninstalling plugin A leaves the shared connector (plugin B still counts on it) and removes A\'s own connector', afterA.includes(SHARED) && !afterA.includes('https://a-only.example.com/mcp'), JSON.stringify(afterA));
const bRec = (settings.plugins ?? []).find((p) => p.id === B.id); const shared = (await mcp.list()).find((c) => c.url === SHARED);
check('G3', 'the shared connector now belongs to plugin B (handed over), so removing B later removes it', Boolean(bRec) && (bRec.connectors ?? []).includes(shared?.id), JSON.stringify({ connectors: bRec?.connectors, uses: bRec?.uses }));
await tools.uninstall(B.id);
check('G4', 'uninstalling the last plugin that uses it removes the shared connector, and no connector or skill of either plugin is left', !(await conns()).includes(SHARED) && (await skills.list()).filter((s) => /pack-/.test(s.name)).length === 0, JSON.stringify(await conns()));
// update path: A updated so that it no longer names the shared connector while B still uses it
files.current = pack('pack-a', 'https://a-only.example.com/mcp'); const A2 = (await tools.installFromGithub('https://github.com/o/pack-a')).record; files.current = pack('pack-b'); const B2 = (await tools.installFromGithub('https://github.com/o/pack-b')).record; void B2;
files.current = { 'plugin.json': JSON.stringify({ name: 'pack-a', description: 'a v2' }), 'skills/pack-a/SKILL.md': skillMd('pack-a'), '.mcp.json': JSON.stringify({ mcpServers: { own: { url: 'https://a-only.example.com/mcp' } } }) };
await tools.updatePlugin(A2.id);
check('G5', 'updating plugin A so it no longer names the shared connector does not remove it while plugin B uses it', (await conns()).includes(SHARED), JSON.stringify(await conns()));
for (const f of cleanups.reverse()) { try { await f(); } catch { /* x */ } }
const bad = rows.filter((x) => !x.ok); console.log(NL + (rows.length - bad.length) + ' of ' + rows.length + ' passed'); process.exit(bad.length ? 1 : 0);

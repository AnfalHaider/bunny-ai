/**
 * Q-2 timings on an invented profile: first load, API latency, a long chat, many chats.
 *   BASE=http://127.0.0.1:5392 node e2e/q2-perf.mjs
 */
import { chromium } from 'playwright';
const B = process.env.BASE;
if (!(await (await fetch(B + '/api/health')).json()).fake) throw new Error('refusing: not an invented profile');
const J = { 'content-type': 'application/json' };
const time = async (label, fn) => { const t = Date.now(); const r = await fn(); console.log(label.padEnd(58), `${Date.now() - t}ms`, r ?? ''); };
const browser = await chromium.launch();
const mk = async () => { const c = await browser.newContext({ viewport: { width: 1400, height: 900 }, baseURL: B }); return c.newPage(); };
let p = await mk(); const reqs = [];
p.on('request', (r) => reqs.push(r.url().replace(B, '')));
await time('first load: / until the greeting shows', async () => { await p.goto('/'); await p.waitForSelector('#greeting'); });
console.log('requests on first load:', reqs.length, 'of which /api:', reqs.filter((u) => u.startsWith('/api')).length, 'js/css:', reqs.filter((u) => /\.(js|css)/.test(u)).length);
const sizes = await p.evaluate(() => performance.getEntriesByType('resource').map((e) => [e.name.split('/').pop(), Math.round(e.transferSize / 1024)]).filter((x) => x[1] > 40));
console.log('big resources (KB):', JSON.stringify(sizes));
for (const u of ['/api/sessions', '/api/models', '/api/settings', '/api/providers', '/api/projects', '/api/abilities']) await time('GET ' + u + ' (empty profile)', async () => { const r = await fetch(B + u); await r.text(); return r.status; });
await time('import a 400-message chat', async () => { const md = Array.from({ length: 200 }, (_, i) => `## You\nQuestion number ${i}\n\n## Assistant\nAnswer number ${i} with some words to make it longer. `.repeat(1)).join('\n\n'); const r = await fetch(B + '/api/import', { method: 'POST', headers: J, body: JSON.stringify({ content: md, title: 'Long chat' }) }); return r.status; });
await time('create 150 more chats', async () => { for (let i = 0; i < 150; i++) await fetch(B + '/api/sessions', { method: 'POST', headers: J, body: JSON.stringify({ title: `Perf chat ${i}`, providerId: 'x', model: 'y' }) }); });
await time('GET /api/sessions with ~150 chats', async () => { const r = await fetch(B + '/api/sessions'); const j = await r.json(); return `${j.length} rows, ${JSON.stringify(j).length} bytes`; });
p = await mk();
await time('reload: / with ~150 chats until the sidebar lists them', async () => { await p.goto('/'); await p.waitForSelector('.session-row'); });
const list = await (await fetch(B + '/api/sessions')).json(); const long = list.find((s) => s.title === 'Long chat');
await time('open the 400-message chat until the last message paints', async () => { await p.goto(`/src/ui/index.html?s=${long.id}`); await p.waitForSelector('.msg'); await p.waitForFunction(() => document.querySelectorAll('.msg').length >= 400, null, { timeout: 15000 }).catch(() => {}); return `${await p.locator('.msg').count()} messages in the DOM`; });
const heap = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB' : 'n/a'); console.log('JS heap after the long chat:', heap);
await time('type in the search box over 150 chats (filter)', async () => { await p.locator('#search').fill('Perf chat 14'); await p.waitForTimeout(600); return `${await p.locator('.session-row').count()} rows`; });
await time('scroll the long chat to the top', async () => { await p.locator('#messages').evaluate((e) => { e.scrollTop = 0; }); await p.waitForTimeout(100); });
await browser.close();

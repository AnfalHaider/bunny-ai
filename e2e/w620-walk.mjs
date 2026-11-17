/**
 * QA, W6-20: a browser screenshot reaches a model that can see. The real server with a scripted OpenAI-style model; this walk plays
 * the part of the window that answers the "browser" request (a PNG data address, or other things). What the model is SENT is recorded.
 *   node e2e/w620-walk.mjs      (from a checkout that has test/helpers.js)
 */
import { createServer } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { startApp, post } = await import(pathToFileURL(join(process.cwd(), 'test', 'helpers.js')).href);
const cleanups = []; const t = { after: (f) => cleanups.push(f) };
const j = { 'content-type': 'application/json' };
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 230) : ''}`); };
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const { base } = await startApp(t, { fake: false });
let seen = [];
const upstream = createServer((req, res) => {
  let raw = ''; req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    if (req.url.endsWith('/models')) { res.writeHead(200, j); res.end('{"data":[{"id":"gpt-4o"}]}'); return; }
    const body = JSON.parse(raw); seen.push(body);
    const hasTool = body.messages.some((m) => m.role === 'tool');
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const delta = hasTool ? { content: 'I looked.' } : { tool_calls: [{ index: 0, id: 'c1', function: { name: 'browser_screenshot', arguments: '{}' } }] };
    res.end(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
await post(base, '/api/providers/openai/connect', { apiKey: 'sk-test-000000000000', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });

async function shot({ vision, answer, say = 'look at the page', sessionId = null }) {
  seen = [];
  let id = sessionId;
  if (!id) {
    const { body: s } = await post(base, '/api/sessions', { title: 'Shot' });
    id = s.id;
    await fetch(`${base}/api/sessions/${id}/setting/permissionMode`, { method: 'PATCH', headers: j, body: JSON.stringify({ value: 'auto' }) });
  }
  const payload = { content: say, providerId: 'openai', model: 'gpt-4o', browserControl: true };
  if (vision !== undefined) payload.vision = vision;
  const res = await fetch(`${base}/api/sessions/${id}/messages`, { method: 'POST', headers: j, body: JSON.stringify(payload), signal: AbortSignal.timeout(150000) });
  const reader = res.body.getReader(); let buffer = ''; const answered = new Set(); let all = ''; let answerStatus = null;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    const piece = new TextDecoder().decode(value); buffer += piece; all += piece;
    for (const m of buffer.matchAll(/event: browser\ndata: (.*)\n/g)) {
      const ask = JSON.parse(m[1]); if (answered.has(ask.id)) continue; answered.add(ask.id);
      answerStatus = (await post(base, `/api/sessions/${id}/browser/${ask.id}`, { note: 'Screenshot taken.', ...answer })).status;
    }
  }
  const saved = await (await fetch(`${base}/api/sessions/${id}`)).json();
  const second = seen[1]?.messages ?? [];
  const toolMsg = second.find((m) => m.role === 'tool');
  const hasImage = JSON.stringify(second).includes('"type":"image_url"');
  return { answerStatus, id, seen, toolText: String(toolMsg?.content ?? ''), hasImage, saved, all, second };
}

const a = await shot({ vision: true, answer: { image: PNG } });
check('S1', 'a model that can see gets the picture itself in its next request, and the tool line says the picture is attached', a.hasImage && /the picture is attached below/.test(a.toolText) && JSON.stringify(a.second).includes(PNG.slice(0, 40)), a.toolText);
const b = await shot({ vision: false, answer: { image: PNG } });
check('S2', 'a model that cannot see gets no picture, and is told to work from the text', !b.hasImage && /cannot see pictures: work from the text/.test(b.toolText), b.toolText);
const c = await shot({ vision: undefined, answer: { image: PNG } });
check('S3', 'when the page does not say (no vision field) the picture is sent, as for a model that can see', c.hasImage, `image sent: ${c.hasImage}`);
const d = await shot({ vision: true, answer: { image: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' } });
check('S4', 'a JPEG address is not accepted: no picture attached, no picture sent, the reply still finishes', !d.hasImage && !/attached below/.test(d.toolText) && /I looked/.test(d.all), d.toolText);
const e = await shot({ vision: true, answer: { image: 'javascript:alert(1)' } });
check('S5', 'a non-image string as the picture is ignored the same way', !e.hasImage && !/attached below/.test(e.toolText) && /I looked/.test(e.all), e.toolText);
const f = await shot({ vision: true, answer: {} });
check('S6', 'an answer with no picture at all (window had nothing) sends no picture and says nothing about one', !f.hasImage && !/attached below|cannot see/.test(f.toolText), f.toolText);
const sized = (kb) => `data:image/png;base64,${Buffer.alloc(Math.round(kb * 1024 * 0.75), 7).toString('base64')}`;
const okSize = await shot({ vision: true, answer: { image: sized(900) } });
check('S7', 'a picture of 900 KB (as the page would send it) reaches the model', okSize.hasImage && /I looked/.test(okSize.all), `sent ${Math.round(JSON.stringify(okSize.second).length / 1024)} KB`);
const began = Date.now();
const over = await shot({ vision: true, answer: { image: sized(1300) } });
const waited = Date.now() - began;
check('S7b', 'a picture of 1.3 MB (a photo-heavy page at 1280 px wide) is not lost: it reaches the model', over.hasImage && waited < 15000, `picture sent: ${over.hasImage}; reply took ${Math.round(waited / 1000)} s`);
const sevenMb = await shot({ vision: true, answer: { image: sized(7000) } });
check('S7c', 'a picture of 7 MB (still under the 12 MB the route reads) reaches the model', sevenMb.hasImage, `sent ${Math.round(JSON.stringify(sevenMb.second).length / 1024)} KB`);
const beganBig = Date.now();
const huge = await shot({ vision: true, answer: { image: sized(13000) } });
const hugeMs = Date.now() - beganBig;
check('S7d', 'a picture over 12 MB (13 MB): the waiting reply is told AT ONCE (well under 10 s, not 90 s) that it is too large, no picture is sent, and the reply finishes', !huge.hasImage && hugeMs < 10000 && /too large|too big/i.test(huge.toolText) && /I looked/.test(huge.all) && huge.answerStatus === 413, `status ${huge.answerStatus}, ${hugeMs} ms; tool line: ${huge.toolText.slice(0, 140)}`);
{
  const { id: sid } = await shot({ vision: true, answer: { image: PNG } });
  void sid;
  const probe = await fetch(`${base}/api/sessions/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}/browser/${'1'.repeat(8)}-1111-4111-8111-${'1'.repeat(12)}`, { method: 'POST', headers: j, body: '{}' });
  check('S7e', 'an answer posted to a request that is not waiting is still refused with 404 (unchanged)', probe.status === 404, `${probe.status}`);
}
// the picture shows in the chat (the saved step keeps the attachment), and does not leave the chat when the reply is replayed
const stepWithShot = a.saved.messages.find((m) => m.kind === 'tool_call' && (m.attachments ?? []).length);
check('S8', 'the saved chat keeps the screenshot as an attachment of the step (stored on this computer, not in the transcript text)', Boolean(stepWithShot) && /^\/api\/screens\/[\w-]+\.png$/.test(stepWithShot.attachments[0].data) && !JSON.stringify(a.saved).includes(PNG.slice(30, 70)), JSON.stringify(stepWithShot?.attachments ?? null).slice(0, 120));
const next = await shot({ vision: true, answer: { image: PNG }, say: 'and again', sessionId: a.id });
const imgCount = (JSON.stringify(next.seen[0]?.messages ?? []).match(/"type":"image_url"/g) ?? []).length;
console.log(`INFO  a second message in the same chat: the first request already carries ${imgCount} earlier picture(s)`);
check('S9', 'a second message in the same chat works and a fresh picture reaches the model again', next.hasImage && /I looked/.test(next.all), `earlier pictures replayed: ${imgCount}`);

await new Promise((r) => upstream.close(r));
for (const fn of cleanups) { try { await fn(); } catch { /* ignore */ } }
const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, post } from './helpers.js';

// QA (W4-8b): a message with a picture of 2 MB was answered "too large (over 1 MB)" by the message route although the chat accepts pictures up to 4 MB.
test('a message may carry the attachments the chat accepts: a 2 MB picture and a 5 MB PDF get past the body limit; one past 48 MB is still refused', async (t) => {
  const { base } = await startApp(t);
  const { body: session } = await post(base, '/api/sessions', { title: 'big' });
  const send = async (attachments) => {
    const res = await fetch(`${base}/api/sessions/${session.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: 'look', attachments, providerId: 'openai', model: 'gpt-4o', workMode: 'chat' }) });
    return { status: res.status, text: await res.text() };
  };
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2 * 1024 * 1024, 1)]);
  const ok = await send([{ name: 'a.png', mime: 'image/png', data: `data:image/png;base64,${png.toString('base64')}` }]);
  assert.doesNotMatch(ok.text, /too large \(over 1 MB\)|request\.tooLarge/);
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7 '), Buffer.alloc(5 * 1024 * 1024, 0x20)]);
  const doc = await send([{ name: 'a.pdf', mime: 'application/pdf', data: `data:application/pdf;base64,${pdf.toString('base64')}` }]);
  assert.doesNotMatch(doc.text, /request\.tooLarge/);
  const huge = Buffer.alloc(50 * 1024 * 1024, 0x61);
  const refused = await send([{ name: 'b.txt', mime: 'text/plain', data: huge.toString('base64') }]);
  assert.match(refused.text, /request.tooLarge|too large (over 48 MB)/, 'a request past 48 MB is still refused');
});

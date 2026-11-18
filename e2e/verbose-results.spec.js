import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetProfile } from './helpers.js';

// SET-WORK (QA's row): "Default transcript view: Verbose" shows a step's whole result. A 7 000-character read_file result is short in Normal and whole in Verbose.
// (The chat saves the longer copy of a workspace file or command step, up to 8 000 characters; the short display copy is 1 200.)
const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;
const BODY = Array.from({ length: 700 }, (_, i) => `line${String(i).padStart(3, '0')}x`).join('\n'); // about 6 000 characters
let server; let port; let folder;
test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'bunny-verbose-'));
  writeFileSync(join(folder, 'big.txt'), BODY);
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"reader"}]}'); return; }
      if (req.method !== 'POST') { res.writeHead(200); res.end('ok'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const sent = JSON.parse(raw);
      if (sent.messages.some((m) => m.role === 'tool')) { res.end(`${frame({ content: 'Read it.' })}data: [DONE]\n\n`); return; }
      res.write(frame({ tool_calls: [{ index: 0, id: 'c_1', function: { name: 'read_file', arguments: JSON.stringify({ path: 'big.txt' }) } }] }));
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.afterAll(async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); });
test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: 'all', transcriptView: 'normal' } });
});
test.afterEach(async ({ request }) => {
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null, transcriptView: 'normal' } });
});

test('a 7 000-character read_file result is short in Normal and whole in Verbose (after the reply and after a reload)', async ({ page, request }) => {
  const made = await (await request.post('/api/providers/custom', { data: { name: 'Reader', baseUrl: `http://127.0.0.1:${port}/v1` } })).json();
  const providerId = made.id ?? (await (await request.get('/api/providers')).json()).find((p) => p.custom).id;
  const session = await (await request.post('/api/sessions', { data: { title: 'Read a big file', workMode: 'code', folder, permissionMode: 'auto' } })).json();
  await request.post(`/api/sessions/${session.id}/messages`, { data: { content: 'read big.txt', providerId, model: 'reader', workMode: 'code', folder } });
  const saved = await (await request.get(`/api/sessions/${session.id}`)).json();
  const step = saved.messages.find((m) => m.kind === 'tool_call');
  expect(step, 'the step was saved').toBeTruthy();
  expect(String(step.result).length, 'the short display copy').toBeLessThanOrEqual(1300);
  expect(String(step.modelResult ?? '').length, 'the longer saved copy').toBeGreaterThan(5500);

  const shown = async () => {
    await page.goto('/');
    await page.locator(`#sessions a[href*="${session.id}"]`).first().click();
    const result = page.locator('.tool-call-result').first();
    await expect(result).toBeAttached(); // the step is in the page (the folded group keeps it there)
    return result.evaluate((el) => el.textContent.length);
  };
  const normal = await shown();
  expect(normal, 'Normal: about 500 characters').toBeLessThan(700);
  await request.put('/api/settings', { data: { transcriptView: 'verbose' } });
  const verbose = await shown();
  expect(verbose, 'Verbose: the whole result (about 6 000 characters)').toBeGreaterThan(5500);
  expect(await page.locator('.tool-call-result').first().evaluate((el) => el.textContent.includes('line699x'))).toBe(true);
});

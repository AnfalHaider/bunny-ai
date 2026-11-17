import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { listTools } from '../src/server/mcp.js';

// The client version a connector is told in the handshake is the app's own version, read from package.json, never a number typed into the code.
const json = { 'content-type': 'application/json' };

test('the connector handshake tells the connector the version in package.json', async (t) => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  let told = null;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      const r = JSON.parse(raw || '{}');
      if (r.method === 'initialize') {
        told = r.params?.clientInfo;
        res.writeHead(200, { ...json, 'mcp-session-id': 'v1' });
        return res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 's', version: '1' } } }));
      }
      if (r.method === 'notifications/initialized') { res.writeHead(202).end(); return; }
      res.writeHead(200, json);
      res.end(JSON.stringify({ jsonrpc: '2.0', id: r.id, result: { tools: [] } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }));
  await listTools({ id: 'ver-1', name: 'Ver', url: `http://127.0.0.1:${server.address().port}/mcp` });
  assert.deepEqual(told, { name: 'Bunny AI', version: pkg.version });
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
});

test('no app version is typed into the connector code any more', async () => {
  const code = await readFile(new URL('../src/server/mcp.js', import.meta.url), 'utf8');
  assert.doesNotMatch(code, /version:\s*'\d+\.\d+\.\d+'/);
});

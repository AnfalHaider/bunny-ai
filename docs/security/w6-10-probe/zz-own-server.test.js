// W610-1 probe (Security): with the REAL app running (its request guard, its port registered), can fetchLimited reach Bunny's own page and its token?
// Run from a checkout of the W6-10 branch: node --test --test-concurrency=1 docs/security/w6-10-probe/zz-own-server.test.js
import { test } from 'node:test';
import { createServer } from 'node:http';
import { startApp } from '../../../test/helpers.js';
import { fetchLimited } from '../../../src/server/download.js';

test('SEC probe W610-1: fetchLimited against the real app', async (t) => {
  const { base } = await startApp(t, { fake: true });
  const port = new URL(base).port;
  // a plain GET straight at the app does hand out the page and its token (this is what must be unreachable)
  const direct = await (await fetch(`${base}/`)).text();
  console.log(`direct GET / carries the token meta: ${/name="bunny-token"/.test(direct)}`);
  // a local server that redirects to Bunny's page
  const hop = createServer((req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${port}/` }); res.end(); });
  await new Promise((r) => hop.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => hop.close(r)));
  const tries = [
    `http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://127.1:${port}/`, `http://2130706433:${port}/`,
    `http://[::ffff:127.0.0.1]:${port}/`, `http://x.localhost:${port}/`, `http://localtest.me:${port}/`,
    `http://127.0.0.1:${hop.address().port}/to-bunny`,
  ];
  for (const url of tries) {
    let verdict;
    try {
      const got = await fetchLimited(url, { allowLoopback: true });
      const text = Buffer.from(got.bytes ?? []).toString('utf8');
      verdict = /bunny-token/.test(text) ? 'TOKEN FETCHED <-- bypass' : `fetched (${text.length} bytes, no token)`;
    } catch (err) { verdict = `refused: ${String(err.message).slice(0, 70)}`; }
    console.log(`${url.replace(String(port), '<bunny>').padEnd(44)} ${verdict}`);
  }
});

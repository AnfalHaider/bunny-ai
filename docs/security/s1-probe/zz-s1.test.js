// Copy into test/ of a checkout and run: node --test test/zz-s1.test.js (localGuard: true is what turns the request guard on in tests).
// S-1 re-check at bf83b01 (Security): the request guard from outside. Raw requests; the token only from the served page.
import { test } from 'node:test';
import { startApp } from './helpers.js';
import http from 'node:http';
const raw = (base, method, path, headers = {}, body = null) => new Promise((resolve, reject) => {
  const u = new URL(base + path);
  const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => { let t = ''; res.on('data', (c) => { t += c; }); res.on('end', () => resolve({ status: res.statusCode, text: t })); });
  req.on('error', reject); if (body) req.write(body); req.end();
});
test('S-1 from outside', async (t) => {
  const { base } = await startApp(t, { localGuard: true });
  const page = await raw(base, 'GET', '/src/ui/settings.html', { accept: 'text/html' });
  const token = /name="bunny-token" content="([^"]+)"/.exec(page.text)?.[1];
  const host = new URL(base).host;
  const rows = [];
  const row = async (label, method, path, headers, body) => { const r = await raw(base, method, path, { host, ...headers }, body); rows.push(String(r.status).padEnd(4) + ' ' + label + (r.status === 403 ? '  ' + (/"code":"([^"]+)"/.exec(r.text)?.[1] ?? '') : '')); };
  rows.push('page has a token meta: ' + Boolean(token));
  await row('GET /api/settings, no token', 'GET', '/api/settings');
  await row('GET /api/settings, token', 'GET', '/api/settings', { 'x-bunny-token': token });
  await row('GET /api/settings, wrong token', 'GET', '/api/settings', { 'x-bunny-token': 'x'.repeat(64) });
  await row('token + Origin https://evil.example', 'GET', '/api/settings', { 'x-bunny-token': token, origin: 'https://evil.example' });
  await row('token + Origin null', 'GET', '/api/settings', { 'x-bunny-token': token, origin: 'null' });
  await row('token + Host evil.example (rebinding)', 'GET', '/api/settings', { 'x-bunny-token': token, host: 'evil.example' });
  await row('token + Host evil.example:' + host.split(':')[1], 'GET', '/api/settings', { 'x-bunny-token': token, host: 'evil.example:' + host.split(':')[1] });
  await row('token + Sec-Fetch-Site cross-site', 'GET', '/api/settings', { 'x-bunny-token': token, 'sec-fetch-site': 'cross-site' });
  await row('no token + Sec-Fetch-Site same-origin', 'GET', '/api/settings', { 'sec-fetch-site': 'same-origin' });
  await row('POST text/plain, no token', 'POST', '/api/sessions', { 'content-type': 'text/plain' }, '{"title":"x"}');
  await row('POST json, no token', 'POST', '/api/sessions', { 'content-type': 'application/json' }, '{"title":"x"}');
  await row('PUT settings, no token, form type', 'PUT', '/api/settings', { 'content-type': 'application/x-www-form-urlencoded' }, 'theme=dark');
  await row('OPTIONS preflight, evil origin', 'OPTIONS', '/api/settings', { origin: 'https://evil.example', 'access-control-request-method': 'PUT' });
  await row('Google callback, bogus state', 'GET', '/api/account/google/callback?state=bogus&code=x');
  await row('connector callback, bogus state', 'GET', '/api/connectors/oauth/callback?state=bogus&code=x');
  await row('connector callback, no state', 'GET', '/api/connectors/oauth/callback');
  await row('connector callback POST', 'POST', '/api/connectors/oauth/callback?state=bogus', {}, '{}');
  await row('callback path with dot-segments', 'GET', '/api/connectors/oauth/callback/../../settings?state=bogus');
  await row('callback path, other case', 'GET', '/API/connectors/oauth/callback?state=bogus');
  await row('callback + trailing slash', 'GET', '/api/connectors/oauth/callback/?state=bogus');
  await row('GET /api/permission-rules, no token', 'GET', '/api/permission-rules');
  await row('GET /api/screens, no token', 'GET', '/api/screens/11111111-1111-1111-1111-111111111111.png');
  console.log(rows.join('\n'));
});

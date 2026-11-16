// W5-7 probe (Security): copy both zz-sec57 files into test/ of a checkout, then: node --test test/zz-sec57.test.js (token-only writes, folderPickerOnly). rel.mjs is the W5-8 target-check probe.
// W5-7 probe (Security): with only the page token (folderPickerOnly: true), which writes still go through?
import { test } from 'node:test';
import { startApp, json } from './helpers.js';
import { readFileSync } from 'node:fs';
const j = { 'content-type': 'application/json' };
const call = (base, method, path, body) => json(base, path, { method, headers: j, body: body === undefined ? undefined : JSON.stringify(body) });
const table = JSON.parse(readFileSync(new URL('./zz-sec57.json', import.meta.url), 'utf8'));
test('token-only attacks W5-7', async (t) => {
  const { base } = await startApp(t, { folderPickerOnly: true });
  const s = await call(base, 'POST', '/api/sessions', { title: 'x' });
  const id = s.body.id; const U = '11111111-1111-1111-1111-111111111111';
  const rows = [];
  for (const [method, rawPath, body] of table.routes) {
    const path = rawPath.replace('$ID', id).replace('$U', U);
    const r = await call(base, method, path, body);
    const blocked = r.status === 403 && r.body?.code === 'request.windowOnly';
    rows.push((blocked ? 'BLOCKED ' : 'open    ') + String(r.status).padEnd(4) + ' ' + method.padEnd(6) + ' ' + rawPath + (body && Object.keys(body).length ? ' ' + JSON.stringify(body).slice(0, 50) : '') + (blocked ? '' : '   -> ' + JSON.stringify(r.body).slice(0, 60)));
  }
  for (const k of table.settingKeys) {
    const r = await call(base, 'PUT', '/api/settings', { [k]: k === 'allowlist' ? [] : k === 'aliases' ? {} : 'x' });
    const blocked = r.status === 403 && r.body?.code === 'request.windowOnly';
    rows.push((blocked ? 'BLOCKED ' : 'open    ') + String(r.status).padEnd(4) + ' PUT    settings key ' + k);
  }
  console.log(rows.join('\n'));
});

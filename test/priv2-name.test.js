import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userInfo } from 'node:os';
import { systemUserName } from '../src/server/app.js';
import { startApp } from './helpers.js';

// PRIV-2: an invented profile never carries the Windows user name.
test('systemUserName: an invented profile uses a fixed name, BUNNY_DISPLAY_NAME overrides, normal installs read the OS name', () => {
  assert.equal(systemUserName({ BUNNY_DATA_DIR: 'x' }), 'Sam');
  assert.equal(systemUserName({ BUNNY_FAKE_UPSTREAM: '1' }), 'Sam');
  assert.equal(systemUserName({ BUNNY_DATA_DIR: 'x', BUNNY_DISPLAY_NAME: 'Robin Hood' }), 'Robin');
  const real = systemUserName({});
  assert.equal(real.toLowerCase(), String(userInfo().username).replace(/[._-]+/g, ' ').trim().split(/\s+/)[0].toLowerCase());
});

test('with an invented profile, /api/settings and the page never contain the OS user name', async (t) => {
  const user = String(userInfo().username);
  const { base } = await startApp(t); // fake: true, as every invented profile
  const body = await (await fetch(`${base}/api/settings`)).text();
  const page = await (await fetch(`${base}/`)).text();
  if (user.length > 2) for (const text of [body, page]) assert.ok(!text.toLowerCase().includes(user.toLowerCase()), 'the OS user name leaked');
  assert.equal(JSON.parse(body).systemUserName, 'Sam');
});

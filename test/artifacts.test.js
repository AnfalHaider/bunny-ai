/**
 * Artifacts: a reply promoted to something that lives beside the chat.
 *
 * Versions are append-only and restore appends the old content back, so a
 * person can always walk forward again. Each behaviour is checked through the
 * API the panel uses.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startApp, json, post, patch, del } from './helpers.js';

async function newArtifact(base, overrides = {}) {
  const res = await post(base, '/api/artifacts', {
    title: 'Landing page',
    kind: 'html',
    language: 'html',
    content: '<h1>Hello</h1>',
    ...overrides,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

test('an artifact is created with one version and a preview', async (t) => {
  const { base } = await startApp(t);
  const artifact = await newArtifact(base);
  assert.equal(artifact.title, 'Landing page');
  assert.equal(artifact.kind, 'html');
  assert.equal(artifact.versions.length, 1);
  assert.equal(artifact.versions[0].content, '<h1>Hello</h1>');

  const { body: listed } = await json(base, '/api/artifacts');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, artifact.id);
  assert.match(listed[0].preview, /Hello/);
  assert.equal(listed[0].versionCount, 1);
});

test('an artifact needs a title and content', async (t) => {
  const { base } = await startApp(t);
  const noTitle = await post(base, '/api/artifacts', { title: ' ', content: 'x' });
  assert.equal(noTitle.status, 400);
  assert.equal(noTitle.body.code, 'artifact.titleRequired');

  const noContent = await post(base, '/api/artifacts', { title: 'Empty', content: '' });
  assert.equal(noContent.status, 400);
  assert.equal(noContent.body.code, 'artifact.contentRequired');
});

test('editing an artifact appends a version instead of overwriting the old one', async (t) => {
  const { base } = await startApp(t);
  const artifact = await newArtifact(base);

  const { status, body } = await patch(base, `/api/artifacts/${artifact.id}`, { content: '<h1>Hello again</h1>' });
  assert.equal(status, 200);
  assert.equal(body.versions.length, 2);
  assert.equal(body.versions[0].content, '<h1>Hello</h1>');
  assert.equal(body.versions[1].content, '<h1>Hello again</h1>');
});

test('restoring an older version brings its content back without deleting history', async (t) => {
  const { base } = await startApp(t);
  const artifact = await newArtifact(base);
  await patch(base, `/api/artifacts/${artifact.id}`, { content: 'second' });

  const { status, body } = await post(base, `/api/artifacts/${artifact.id}/restore`, { version: 0 });
  assert.equal(status, 200);
  assert.equal(body.versions.at(-1).content, '<h1>Hello</h1>');
  assert.equal(body.versions.length, 3);
  assert.equal(body.versions.at(-1).restoredFrom, 0);
});

test('restoring a version that does not exist is refused', async (t) => {
  const { base } = await startApp(t);
  const artifact = await newArtifact(base);
  const { status, body } = await post(base, `/api/artifacts/${artifact.id}/restore`, { version: 9 });
  assert.equal(status, 400);
  assert.equal(body.code, 'artifact.noVersion');
});

test('an artifact can be starred, renamed and deleted', async (t) => {
  const { base } = await startApp(t);
  const artifact = await newArtifact(base);

  const starred = await patch(base, `/api/artifacts/${artifact.id}`, { starred: true, title: 'Homepage' });
  assert.equal(starred.body.starred, true);
  assert.equal(starred.body.title, 'Homepage');

  const removed = await del(base, `/api/artifacts/${artifact.id}`);
  assert.equal(removed.body.ok, true);
  const { body: left } = await json(base, '/api/artifacts');
  assert.equal(left.length, 0);
});

test('artifacts are listed per conversation', async (t) => {
  const { base } = await startApp(t);
  const one = await post(base, '/api/sessions', { title: 'One' });
  const two = await post(base, '/api/sessions', { title: 'Two' });

  await newArtifact(base, { sessionId: one.body.id, title: 'From one' });
  await newArtifact(base, { sessionId: two.body.id, title: 'From two' });

  const { body: onlyOne } = await json(base, `/api/artifacts?sessionId=${one.body.id}`);
  assert.equal(onlyOne.length, 1);
  assert.equal(onlyOne[0].title, 'From one');

  const { body: all } = await json(base, '/api/artifacts');
  assert.equal(all.length, 2);
});

test('reading an artifact returns every version', async (t) => {
  const { base } = await startApp(t);
  const artifact = await newArtifact(base);
  await patch(base, `/api/artifacts/${artifact.id}`, { content: 'v2' });

  const { status, body } = await json(base, `/api/artifacts/${artifact.id}`);
  assert.equal(status, 200);
  assert.equal(body.versions.length, 2);
  assert.equal(body.versions[1].content, 'v2');
});

test('an unknown artifact is a 404', async (t) => {
  const { base } = await startApp(t);
  const { status } = await json(base, '/api/artifacts/00000000-0000-0000-0000-000000000000');
  assert.equal(status, 404);
});

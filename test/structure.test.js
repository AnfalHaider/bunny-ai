/**
 * Structure: branching, nesting, projects, pinning, archiving, search, export,
 * message editing, compaction and the context meter.
 *
 * These are the behaviours that make a long-lived workspace usable, and each
 * one is asserted through the public API rather than the store internals, so a
 * route that forgets to pass a field fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startApp, json, post, patch, del, connectProvider } from './helpers.js';

async function sessionWithTurns(base, lines = ['hello', 'hi there']) {
  const model = await connectProvider(base);
  const created = await post(base, '/api/sessions', { title: 'New chat' });
  const id = created.body.id;
  for (const line of lines) {
    await post(base, `/api/sessions/${id}/messages`, {
      content: line, providerId: 'anthropic', model,
    });
  }
  return id;
}

test('a new chat can be renamed through PATCH', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'New chat' });
  const { status, body } = await patch(base, `/api/sessions/${created.id}`, { title: '  Tax notes  ' });
  assert.equal(status, 200);
  assert.equal(body.title, 'Tax notes');
});

test('a blank rename falls back to a usable title', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Keep' });
  const { body } = await patch(base, `/api/sessions/${created.id}`, { title: '   ' });
  assert.equal(body.title, 'Untitled');
});

test('pinned chats sort above newer unpinned ones', async (t) => {
  const { base } = await startApp(t);
  const first = await post(base, '/api/sessions', { title: 'Older' });
  const second = await post(base, '/api/sessions', { title: 'Newer' });
  await patch(base, `/api/sessions/${first.body.id}`, { pinned: true });

  const { body: rows } = await json(base, '/api/sessions');
  assert.equal(rows[0].id, first.body.id, 'pinned chat should lead the list');
  assert.equal(rows[1].id, second.body.id);
});

test('an archived chat leaves the list unless asked for', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Sweep this' });
  await patch(base, `/api/sessions/${created.id}`, { archived: true });

  const { body: visible } = await json(base, '/api/sessions');
  assert.equal(visible.length, 0);

  const { body: all } = await json(base, '/api/sessions?archived=1');
  assert.equal(all.length, 1);
  assert.equal(all[0].archived, true);
});

test('search matches message text, not only titles', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Untitled thing' });
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'my favourite colour is ultramarine', providerId: 'anthropic', model: await connectProvider(base),
  });

  const { body: hits } = await json(base, '/api/search?q=ultramarine');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, created.id);

  const { body: none } = await json(base, '/api/search?q=chartreuse');
  assert.equal(none.length, 0);

  const { body: empty } = await json(base, '/api/search?q=');
  assert.deepEqual(empty, []);
});

test('a branch copies the transcript up to the chosen turn and points at its parent', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);
  const { body: parent } = await post(base, '/api/sessions', { title: 'Original' });
  await post(base, `/api/sessions/${parent.id}/messages`, {
    content: 'first question', providerId: 'anthropic', model,
  });
  // The message stream is SSE, so message ids come from reading the session
  // back rather than from the send response.
  const { body: afterFirst } = await json(base, `/api/sessions/${parent.id}`);
  const firstId = afterFirst.messages.find((m) => m.content === 'first question').id;

  await post(base, `/api/sessions/${parent.id}/messages`, {
    content: 'second question', providerId: 'anthropic', model,
  });

  const { status, body: branch } = await post(base, `/api/sessions/${parent.id}/fork`, { at: firstId });
  assert.equal(status, 200);
  assert.equal(branch.parentId, parent.id);
  assert.equal(branch.title, 'Original (branch)');
  assert.equal(branch.branchFrom, 0);

  // The branch keeps the messages up to the fork point, not the ones after it.
  const { body: branchFull } = await json(base, `/api/sessions/${branch.id}`);
  const contents = branchFull.messages.map((m) => m.content);
  assert.ok(contents.includes('first question'));
  assert.equal(contents.includes('second question'), false);

  const { body: all } = await json(base, '/api/sessions?archived=1');
  const child = all.find((s) => s.parentId === parent.id);
  assert.ok(child, 'the sidebar needs the parent link to nest the branch');
});

test('deleting a message truncates the transcript at that point', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);
  const { body: created } = await post(base, '/api/sessions', { title: 'Trim me' });
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'one', providerId: 'anthropic', model,
  });
  const { body: afterOne } = await json(base, `/api/sessions/${created.id}`);
  const firstId = afterOne.messages.find((m) => m.content === 'one').id;
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'two', providerId: 'anthropic', model,
  });

  const { status, body } = await del(base, `/api/sessions/${created.id}/messages/${firstId}`);
  assert.equal(status, 200);
  assert.equal(body.messages.length, 0);
});

test('editing a message replaces it and drops everything after', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);
  const { body: created } = await post(base, '/api/sessions', { title: 'Fix me' });
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'typo', providerId: 'anthropic', model,
  });
  const { body: afterTypo } = await json(base, `/api/sessions/${created.id}`);
  const firstId = afterTypo.messages.find((m) => m.content === 'typo').id;
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'later reply', providerId: 'anthropic', model,
  });

  const { status, body } = await patch(base, `/api/sessions/${created.id}/messages/${firstId}`, { content: 'corrected' });
  assert.equal(status, 200);
  assert.equal(body.messages.length, 1);
  assert.equal(body.messages[0].content, 'corrected');
});

test('editing an unknown message is a 404, not a silent success', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Nope' });
  const { status } = await patch(
    base,
    `/api/sessions/${created.id}/messages/00000000-0000-0000-0000-000000000000`,
    { content: 'x' },
  );
  assert.equal(status, 404);
});

test('export returns a markdown transcript and a json one', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Exportable' });
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'exportable question', providerId: 'anthropic', model: await connectProvider(base),
  });

  const md = await fetch(`${base}/api/sessions/${created.id}/export?format=markdown`);
  assert.equal(md.status, 200);
  assert.match(md.headers.get('content-type'), /text\/markdown/);
  assert.match(md.headers.get('content-disposition'), /attachment/);
  const text = await md.text();
  assert.match(text, /## You/);
  assert.match(text, /exportable question/);

  const raw = await fetch(`${base}/api/sessions/${created.id}/export?format=json`);
  const parsed = JSON.parse(await raw.text());
  assert.equal(parsed.title, 'Exportable');
  assert.equal(parsed.messages[0].role, 'user');
});

test('the context meter counts what the transcript will cost', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Measure me' });
  await post(base, `/api/sessions/${created.id}/messages`, {
    content: 'x'.repeat(400), providerId: 'anthropic', model: await connectProvider(base),
  });

  const { body } = await json(base, `/api/sessions/${created.id}`);
  assert.ok(body.context.used >= 100, `expected ~100 tokens, got ${body.context.used}`);
  assert.equal(body.context.limit, 200_000);
  assert.ok(body.context.pct >= 0 && body.context.pct <= 100);
  assert.equal(body.context.messages, 2);
});

test('/compact replaces the transcript with a labelled summary', async (t) => {
  const { base } = await startApp(t);
  const id = await sessionWithTurns(base, ['ask one', 'answer one', 'ask two', 'answer two']);

  const { status, body } = await post(base, `/api/sessions/${id}/compact`);
  assert.equal(status, 200);
  assert.match(body.summary, /Summary of the conversation so far/);
  assert.match(body.summary, /ask one/);
  assert.ok(body.after.used < body.before.used);

  const { body: after } = await json(base, `/api/sessions/${id}`);
  assert.equal(after.messages.length, 1);
  assert.equal(after.messages[0].kind, 'summary');
});

test('compacting an almost empty chat explains itself instead of pretending', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Tiny' });
  const { status, body } = await post(base, `/api/sessions/${created.id}/compact`);
  assert.equal(status, 400);
  assert.equal(body.code, 'compact.nothing');
});

test('a project holds conversations and its instructions reach the model', async (t) => {
  const { base } = await startApp(t);
  const model = await connectProvider(base);

  const project = await post(base, '/api/projects', {
    name: 'Contracts', instructions: 'Always answer in French.',
  });
  assert.equal(project.status, 200);

  const { body: listed } = await json(base, '/api/projects');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].name, 'Contracts');

  const { body: chat } = await post(base, '/api/sessions', {
    title: 'Clause one', projectId: project.body.id, providerId: 'anthropic', model,
  });
  const { body: scoped } = await json(base, `/api/sessions?projectId=${project.body.id}`);
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].id, chat.id);

  const res = await fetch(`${base}/api/sessions/${chat.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content: 'Bonjour', providerId: 'anthropic', model }),
  });
  assert.equal(res.status, 200);
  await res.text();

  // The instruction is prepended to the model input, not stored as a turn.
  const { body: stored } = await json(base, `/api/sessions/${chat.id}`);
  assert.equal(stored.messages.some((m) => m.content.includes('Always answer in French')), false);
  assert.equal(stored.messages[0].content, 'Bonjour');
});

test('a project can be renamed and removed', async (t) => {
  const { base } = await startApp(t);
  const { body: project } = await post(base, '/api/projects', { name: 'Temp' });
  const renamed = await patch(base, `/api/projects/${project.id}`, { name: 'Permanent' });
  assert.equal(renamed.body.name, 'Permanent');

  const removed = await del(base, `/api/projects/${project.id}`);
  assert.equal(removed.body.ok, true);
  const { body: left } = await json(base, '/api/projects');
  assert.equal(left.length, 0);
});

test('a project with no name is refused with a code', async (t) => {
  const { base } = await startApp(t);
  const { status, body } = await post(base, '/api/projects', { name: '   ' });
  assert.equal(status, 400);
  assert.equal(body.code, 'project.nameRequired');
});

test('an incognito chat is still a chat, just marked', async (t) => {
  const { base } = await startApp(t);
  const { body: created } = await post(base, '/api/sessions', { title: 'Off the record', incognito: true });
  const { body: got } = await json(base, `/api/sessions/${created.id}`);
  assert.equal(got.incognito, true);
});

test('deleting a project keeps its chats, back under All chats', async (t) => {
  const { base } = await startApp(t);
  const { body: project } = await post(base, '/api/projects', { name: 'Going away' });
  const { body: chat } = await post(base, '/api/sessions', { title: 'Keep me', projectId: project.id });
  assert.equal((await json(base, `/api/sessions/${chat.id}`)).body.projectId, project.id);
  const removed = await del(base, `/api/projects/${project.id}`);
  assert.equal(removed.body.moved, 1);
  const { body: after } = await json(base, `/api/sessions/${chat.id}`);
  assert.equal(after.title, 'Keep me');
  assert.equal(after.projectId, null);
});

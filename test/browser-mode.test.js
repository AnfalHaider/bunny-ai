import { test } from 'node:test';
import assert from 'node:assert/strict';

// BROWSER step 1: a page in a browser (no desktop bridge): window-only controls say "Change this in Bunny's window.", and a closed Bunny says so.
globalThis.window = { matchMedia: undefined };
const mode = await import('../src/ui/browser-mode.js');
const { sendJSON } = await import('../src/ui/api.js');

const health = (lock) => async () => ({ ok: true, json: async () => ({ ok: true, windowOnlyLock: lock }) });

/** A tiny stand-in for document: enough elements to build the page from text. */
function fakeDoc() {
  const made = [];
  const el = (tag) => ({ tag, children: [], style: {}, attrs: {}, set id(v) { this._id = v; }, get id() { return this._id; }, setAttribute(k, v) { this.attrs[k] = v; }, append(...c) { this.children.push(...c); }, prepend(...c) { this.children.unshift(...c); } });
  const doc = { body: el('body'), createElement: (t) => { const e = el(t); made.push(e); return e; }, getElementById: (id) => [...made].find((e) => e.id === id) ?? null };
  return doc;
}
const textOf = (e) => [e.textContent ?? '', ...(e.children ?? []).map((c) => (typeof c === 'string' ? c : textOf(c)))].join(' ');

test('the lock sentence is the server\'s own words, and the page asks the server once whether the lock is on', async () => {
  assert.equal(mode.LOCK_MESSAGE, "Change this in Bunny's window.");
  mode.resetBrowserMode();
  let asked = 0;
  const f = async (...a) => { asked += 1; return health(true)(...a); };
  assert.equal(await mode.windowOnlyLocked(f), true);
  assert.equal(await mode.windowOnlyLocked(f), true);
  assert.equal(asked, 1);
  mode.resetBrowserMode();
  assert.equal(await mode.windowOnlyLocked(health(false)), false);
  mode.resetBrowserMode();
  assert.equal(await mode.windowOnlyLocked(async () => { throw new TypeError('fetch failed'); }), false, 'not known: the server still decides');
  mode.resetBrowserMode();
});

test('in a browser on a locked server a window-only write is refused with that sentence before anything is sent; on an unlocked server it goes through', async () => {
  const real = globalThis.fetch;
  try {
    mode.resetBrowserMode();
    const sent = [];
    globalThis.fetch = async (path, init) => { sent.push(path); return health(true)(); };
    await assert.rejects(() => sendJSON('/api/permission-rules', 'PUT', { global: {} }), (err) => err.message === "Change this in Bunny's window." && err.code === 'window.only');
    assert.deepEqual(sent, ['/api/health'], 'only the one question about the lock was sent');
    // an ordinary write is not touched
    globalThis.fetch = async (path) => { sent.push(path); return { ok: true, json: async () => ({ ok: 1 }) }; };
    assert.deepEqual(await sendJSON('/api/sessions', 'POST', { title: 'x' }), { ok: 1 });
    // an unlocked server (the plain web build): the write is sent
    mode.resetBrowserMode();
    globalThis.fetch = async (path) => (path === '/api/health' ? health(false)() : (sent.push(path), { ok: true, json: async () => ({ done: true }) }));
    assert.deepEqual(await sendJSON('/api/permission-rules', 'PUT', { global: {} }), { done: true });
  } finally { globalThis.fetch = real; mode.resetBrowserMode(); }
});

test('"Bunny is not running": built from text, once, and it checks again until Bunny is back, then reloads', async () => {
  const doc = fakeDoc();
  let alive = false;
  let reloaded = 0;
  const page = mode.showNotRunning(doc, { check: async () => alive, reload: () => { reloaded += 1; }, everyMs: 20 });
  assert.equal(mode.showNotRunning(doc), page, 'only one');
  assert.match(textOf(page), /Bunny is not running/);
  assert.match(textOf(page), /Keep running in the tray/);
  assert.equal(page.attrs.role, 'alert');
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(reloaded, 0, 'still not running: no reload');
  alive = true;
  await new Promise((r) => setTimeout(r, 80));
  assert.ok(reloaded >= 1, 'Bunny is back: the page reloads');
});

test('a Settings page in a browser gets one note saying controls that change what Bunny may do are locked', () => {
  const doc = fakeDoc();
  const note = mode.showBrowserLockNote(doc);
  assert.match(note.textContent, /You are using Bunny in a browser/);
  assert.match(note.textContent, /Change this in Bunny's window\./);
  assert.equal(mode.showBrowserLockNote(doc), note, 'only one');
});

test('which cards a page may answer: the window always, a tab on this computer never, a signed-in device all but the capability cards that change what Bunny may do', async () => {
  const { cardNeedsLock, cardKind, DEVICE_CAPABILITIES } = mode;
  const kinds = [{ kind: 'permission' }, { kind: 'question' }, { kind: 'capability', capability: 'code_mode' }, { kind: 'capability', capability: 'leave_plan_mode' }, { kind: 'capability', capability: 'computer_use' }, { kind: 'capability', capability: 'custom_tools' }, { kind: 'capability', capability: 'switch_on_added' }];
  for (const k of kinds) {
    assert.equal(cardNeedsLock(k, { bridge: true, locked: true }), false, 'the window: never');
    assert.equal(cardNeedsLock(k, { locked: false }), false, 'a server without the lock (the plain web build): never');
    assert.equal(cardNeedsLock(k, { locked: true }), true, 'a tab on this computer: always');
  }
  assert.deepEqual([...DEVICE_CAPABILITIES], ['code_mode', 'leave_plan_mode']);
  const device = (k) => cardNeedsLock(k, { device: true, locked: true });
  assert.deepEqual(kinds.map(device), [false, false, false, false, true, true, true]);
  const fake = (classes, capability) => ({ classList: { contains: (c) => classes.includes(c) }, dataset: { capability } });
  assert.deepEqual(cardKind(fake(['permission-prompt', 'capability-card'], 'computer_use')), { kind: 'capability', capability: 'computer_use' });
  assert.deepEqual(cardKind(fake(['permission-prompt', 'question-card'])), { kind: 'question' });
  assert.deepEqual(cardKind(fake(['permission-prompt'])), { kind: 'permission' });
});

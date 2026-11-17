import { test } from 'node:test';
import assert from 'node:assert/strict';

// v0.1.10: in the installed app every window-only write from a Settings page failed ("Change this in Bunny's window.") because the Settings pages run in an
// iframe and Electron's preload exposes window.bunnyDesktop to the main frame only. The bridge is now resolved from the page or its SAME-origin parent.
globalThis.window = { matchMedia: undefined };
const { desktopBridge, sendJSON } = await import('../src/ui/api.js');

const bridge = () => ({ secureWrite: async (method, path, body) => ({ status: 200, data: { ok: true, via: 'bridge', method, path, body } }), pickFolder: async () => 'C:\\invented' });
const page = (origin, over = {}) => ({ location: { origin }, ...over });

test('a page with its own bridge uses it', () => {
  const b = bridge();
  assert.equal(desktopBridge(page('app://bunny', { bunnyDesktop: b })), b);
});

test('a Settings iframe uses its SAME-origin parent\'s bridge', () => {
  const b = bridge();
  const parent = page('app://bunny', { bunnyDesktop: b });
  const frame = page('app://bunny', { parent });
  frame.parent = parent;
  assert.equal(desktopBridge(frame), b);
});

test('a frame from another origin gets no bridge: reading its parent throws or the origins differ', () => {
  const b = bridge();
  // origins differ
  const parent = page('https://elsewhere.test', { bunnyDesktop: b });
  assert.equal(desktopBridge(page('app://bunny', { parent })), null);
  // a cross-origin parent: touching its location throws
  const hidden = { get location() { throw new DOMException('Blocked a frame from accessing a cross-origin frame.', 'SecurityError'); }, bunnyDesktop: b };
  assert.equal(desktopBridge(page('app://bunny', { parent: hidden })), null);
  // no parent, or the page is its own parent (a top window with no bridge: a plain browser)
  assert.equal(desktopBridge(page('app://bunny')), null);
  const top = page('app://bunny');
  top.parent = top;
  assert.equal(desktopBridge(top), null);
  assert.equal(desktopBridge(null), null);
});

test('sendJSON from the iframe sends a window-only write through the parent\'s bridge, and an ordinary write over HTTP', async () => {
  const b = bridge();
  const parent = page('app://bunny', { bunnyDesktop: b });
  const frame = page('app://bunny', { parent });
  globalThis.window = frame;
  try {
    const out = await sendJSON('/api/plugins/00000000-0000-4000-8000-000000000000', 'DELETE');
    assert.equal(out.via, 'bridge', 'a plugin uninstall is a window-only write');
    assert.equal(out.method, 'DELETE');
    // not window-only: plain fetch (stubbed)
    let fetched = null;
    const real = globalThis.fetch;
    globalThis.fetch = async (path) => { fetched = path; return { ok: true, json: async () => ({ plain: true }) }; };
    try {
      const plain = await sendJSON('/api/something-ordinary', 'POST', { a: 1 });
      assert.deepEqual([fetched, plain.plain], ['/api/something-ordinary', true]);
    } finally { globalThis.fetch = real; }
  } finally { globalThis.window = { matchMedia: undefined }; }
});

test('a cross-origin frame does NOT get the bridge: its window-only write goes over HTTP, where the server refuses it', async () => {
  const b = bridge();
  const frame = page('app://bunny', { parent: page('https://elsewhere.test', { bunnyDesktop: b }) });
  globalThis.window = frame;
  let fetched = null;
  const real = globalThis.fetch;
  globalThis.fetch = async (path) => { fetched = path; return { ok: false, status: 403, json: async () => ({ message: "Change this in Bunny's window." }) }; };
  try {
    await assert.rejects(() => sendJSON('/api/plugins/00000000-0000-4000-8000-000000000000', 'DELETE'), /Change this in Bunny's window/);
    assert.match(fetched, /^\/api\/plugins\//);
  } finally { globalThis.fetch = real; globalThis.window = { matchMedia: undefined }; }
});

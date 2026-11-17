import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserViews } from '../electron/browserViews.js';
import { pixelDifference, fitBitmap, sideBySide, describeScore } from '../electron/pageCompare.js';
import { browserToolDefinitions, describeBrowserTool, BROWSER_TOOL_RISK } from '../src/server/browserTools.js';

// W6-11: compare two pages as pictures. Pixel maths in plain JS; the pages are photographed in hidden off-screen windows (fakes here).
const solid = (w, h, bgra) => { const b = Buffer.alloc(w * h * 4); for (let i = 0; i < w * h; i += 1) b.set(bgra, i * 4); return b; };
const withBlock = (bitmap, w, x0, y0, bw, bh) => { const out = Buffer.from(bitmap); for (let y = y0; y < y0 + bh; y += 1) for (let x = x0; x < x0 + bw; x += 1) out.set([0, 0, 0, 255], (y * w + x) * 4); return out; };
const WHITE = [255, 255, 255, 255];

test('W6-11: a picture compared with itself scores 0; one changed block scores above 0 and below 1', () => {
  const w = 100;
  const h = 80;
  const page = solid(w, h, WHITE);
  assert.equal(pixelDifference(page, Buffer.from(page), w, h).score, 0);
  const changed = pixelDifference(page, withBlock(page, w, 10, 10, 20, 20), w, h);
  assert.equal(changed.different, 400);
  assert.ok(changed.score > 0 && changed.score < 1);
  assert.equal(changed.score, 400 / (w * h));
  assert.equal(pixelDifference(page, solid(w, h, [0, 0, 0, 255]), w, h).score, 1);
  assert.equal(pixelDifference(page, solid(w, h, [250, 250, 250, 255]), w, h).score, 0, 'tiny colour noise is not a difference');
  assert.throws(() => pixelDifference(page, solid(10, 10, WHITE), w, h), /not the same size/);
});

test('W6-11: pages of different heights are cut or padded, and the side-by-side picture has the right size', () => {
  const tall = fitBitmap(solid(10, 20, [0, 0, 0, 255]), 10, 20, 10, 8);
  assert.equal(tall.length, 10 * 8 * 4);
  const short = fitBitmap(solid(10, 4, [0, 0, 0, 255]), 10, 4, 10, 8);
  assert.deepEqual([...short.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...short.subarray(short.length - 4)], [255, 255, 255, 255], 'padded with white');
  const a = solid(10, 8, WHITE);
  const d = pixelDifference(a, solid(10, 8, [0, 0, 0, 255]), 10, 8);
  const side = sideBySide(a, a, d.mask, 10, 8);
  assert.equal(side.width, 10 * 3 + 16);
  assert.equal(side.bitmap.length, side.width * 8 * 4);
  assert.match(describeScore(1280, 0), /At 1280 px wide: 0% of the pixels differ \(identical\)/);
  assert.match(describeScore(390, 0.123), /12\.3%/);
});

/** Electron stand-ins: a window per address that "photographs" the bitmap the test chose for that address. */
function fakes(pages, log = []) {
  class FakeWindow {
    constructor(opts) {
      this.opts = opts;
      let url = '';
      this.webContents = {
        setWindowOpenHandler() {},
        on() {},
        once() {},
        loadURL: async (u) => { url = u; log.push(['load', u, opts.width, opts.webPreferences.partition, opts.webPreferences.offscreen]); },
        capturePage: async () => ({ resize: ({ width, height }) => ({ toBitmap: () => pages[url](width, height) }) }),
      };
    }

    destroy() { log.push(['destroy']); }
  }
  const nativeImage = { createFromBitmap: (bitmap, size) => ({ size, resize: ({ width }) => ({ toDataURL: () => `data:image/png;base64,RESIZED${width}` }), toDataURL: () => `data:image/png;base64,PIC${size.width}x${size.height}` }) };
  return { FakeWindow, nativeImage };
}
const views = (BrowserWindow, nativeImage) => createBrowserViews({ WebContentsView: class {}, session: { fromPartition: () => ({ setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } }) }, getWindow: () => null, getOwnPort: () => '5173', BrowserWindow, nativeImage, resolveName: async () => [{ address: '93.184.216.34', family: 4 }] });

test('W6-11: compare of a page with itself scores 0; with a page with one changed block, above 0 and below 1, at both widths', async () => {
  const log = [];
  const base = (w, h) => solid(w, h, WHITE);
  const { FakeWindow, nativeImage } = fakes({
    'https://example.com/a': base,
    'https://example.com/same': base,
    'https://example.com/b': (w, h) => withBlock(base(w, h), w, 5, 5, 30, 30),
  }, log);
  const v = views(FakeWindow, nativeImage);
  const same = await v.compare({}, { a: 'https://example.com/a', b: 'https://example.com/same' });
  assert.equal(same.error, undefined);
  assert.match(same.note, /At 1280 px wide: 0% of the pixels differ \(identical\)/);
  assert.match(same.note, /At 390 px wide: 0%/);
  const diff = await v.compare({}, { a: 'https://example.com/a', b: 'https://example.com/b' });
  const scores = [...diff.note.matchAll(/At (\d+) px wide: ([\d.]+)%/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(scores.map((s) => s[0]), [1280, 390], 'both widths');
  for (const [, pct] of scores) assert.ok(pct > 0 && pct < 100, `score ${pct}`);
  assert.equal(diff.images.length, 2, 'one picture per width');
  assert.ok(diff.image.startsWith('data:image/png;base64,'));
  assert.ok(log.some((l) => l[0] === 'load' && /^bunny-compare-/.test(String(l[3])) && l[4] === true), 'off-screen, in the panel\'s own partition');
  assert.equal(log.filter((l) => l[0] === 'destroy').length, log.filter((l) => l[0] === 'load').length, 'every window is closed');
});

test('W6-11: addresses that are not http(s), or are Bunny itself, are refused; bad widths too', async () => {
  const { FakeWindow, nativeImage } = fakes({});
  const v = views(FakeWindow, nativeImage);
  for (const bad of ['file:///C:/x.html', 'javascript:alert(1)', 'http://127.0.0.1:5173/', 'http://localhost:5173/settings.html', 'https://user:pw@example.com/']) {
    const r = await v.compare({}, { a: bad, b: 'https://example.com/' });
    assert.match(r.error ?? '', /http or https/, bad);
  }
  assert.match((await v.compare({}, { a: 'https://example.com/', b: 'https://example.com/', widths: [10, 99999] })).error, /between 320 and 1920/);
  assert.match((await createBrowserViews({ WebContentsView: class {}, session: {}, getWindow: () => null }).compare({}, { a: 'https://a.example/', b: 'https://b.example/' })).error, /desktop app/);
});

test('W6-11: the tool is offered with the read tools (so Plan mode keeps it), changes nothing, and names both pages on its card', () => {
  assert.equal(BROWSER_TOOL_RISK.browser_compare, 'read');
  assert.ok(browserToolDefinitions(['read']).some((d) => d.function.name === 'browser_compare'));
  assert.ok(!browserToolDefinitions(['edit']).some((d) => d.function.name === 'browser_compare'));
  assert.match(describeBrowserTool('browser_compare', { a: 'https://one.example/', b: 'https://two.example/' }), /one\.example.*two\.example/);
});

test('W6-11 (Security): the hidden windows use a fresh in-memory partition of their own, and a private or LAN page is refused unless the panel has it open', async () => {
  const { isLanAddress } = await import('../electron/browserViews.js');
  for (const lan of ['http://192.168.1.5/', 'http://10.0.0.2:8080/x', 'http://localhost:3000/', 'http://printer.local/', 'http://nas/', 'http://[::1]:9000/', 'http://172.16.4.4/']) assert.equal(isLanAddress(lan), true, lan);
  for (const open of ['https://example.com/', 'http://93.184.216.34/']) assert.equal(isLanAddress(open), false, open);
  const log = [];
  const { FakeWindow, nativeImage } = fakes({ 'https://example.com/a': (w, h) => solid(w, h, WHITE) }, log);
  const parts = [];
  const v = createBrowserViews({ WebContentsView: class {}, session: { fromPartition: (name) => { parts.push(name); return { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, on() {}, webRequest: { onBeforeRequest() {} } }; } }, getWindow: () => null, getOwnPort: () => '5173', BrowserWindow: FakeWindow, nativeImage, resolveName: async () => [{ address: '93.184.216.34', family: 4 }] });
  const lanTry = await v.compare({}, { a: 'https://example.com/a', b: 'http://192.168.1.5/admin' });
  assert.match(lanTry.error, /private network/);
  assert.equal(log.filter((l) => l[0] === 'load').length, 0, 'nothing was loaded');
  await v.compare({}, { a: 'https://example.com/a', b: 'https://example.com/a', widths: [320] });
  const used = log.find((l) => l[0] === 'load')[3];
  assert.match(used, /^bunny-compare-/);
  assert.ok(!used.startsWith('persist:') && used !== 'persist:bunny-browser', 'a fresh partition in memory, never the panel\'s');
  assert.ok(parts.includes(used));
});

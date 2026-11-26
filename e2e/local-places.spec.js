import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';

// LOCAL-MODELS 3c and 3d (design-local-models v6, Security LF-1 to LF-26): the places UI, driven with canned answers for /api/local-models/places and a stand-in for the dialogs the main process shows.
// Fake mode has no folders of its own, so the page's own module is tested here with invented paths (Sam is an invented user).
test.beforeEach(async ({ request }) => { await resetProfile(request); await request.delete('/api/local-models'); });

const STATUS = (models = []) => ({ fake: true, installed: true, setup: null, program: { sizeMB: 39, licence: 'MIT', name: 'llama.cpp', from: 'GitHub', host: 'github.com', signed: false },
  runtime: { backend: 'cpu', useGpu: false, idleMinutes: 10, idleChoices: [5, 10, 30, 60, 0] }, running: null, alerts: [], models, usedBytes: 0,
  pc: { totalRam: 17e9, freeRam: 7.1e9, vram: null, freeVram: null, freeDisk: 41e9 }, error: null, raised: [] });
const MODEL = { id: 'qwen3-4b', name: 'Qwen3 4B', publisher: 'Qwen', licence: 'Apache-2.0', size: 2.5e9, fit: 'fits', fitText: 'Fits', tools: true, state: 'ready', canDownload: true, done: 2.5e9, fingerprint: '9f3a1c0e4b72', notFound: false };
const PLACES = (over = {}) => ({
  download: { custom: false, where: null, root: 'C:\\Users\\Sam\\AppData\\Local\\BunnyAI\\models', cloud: false, available: true, message: null, defaultRoot: 'C:\\Users\\Sam\\AppData\\Local\\BunnyAI\\models', freeBytes: 41e9 },
  downloads: { 'qwen3-4b': { where: 'C:\\Users\\Sam\\AppData\\Local\\BunnyAI\\models\\Qwen__Qwen3-4B-GGUF\\rev\\q.gguf' } }, folders: [], own: [], busy: false, move: null, lastMove: null, removal: null, ...over });

async function open(page, { places = PLACES(), models = [MODEL], onPost = null, bridge = true } = {}) {
  await page.route('**/api/local-models', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: STATUS(models) }) : r.fallback()));
  await page.route('**/api/local-models/places**', async (r) => {
    const req = r.request();
    if (req.method() === 'GET') return r.fulfill({ json: places });
    const out = onPost ? await onPost(req.url().split('/places/')[1], req.postDataJSON()) : places;
    return r.fulfill({ json: out ?? places });
  });
  await page.addInitScript((withBridge) => {
    window.__calls = [];
    if (withBridge) window.bunnyDesktop = { localModels: {
      showFolder: async () => ({ ok: true }),
      chooseDownloadFolder: async () => { window.__calls.push('chooseDownloadFolder'); return window.__download ?? { ok: false, canceled: true }; },
      addModelFolder: async () => { window.__calls.push('addModelFolder'); return window.__folder ?? { ok: false, canceled: true }; },
      pickModelFile: async () => { window.__calls.push('pickModelFile'); return window.__pick ?? { ok: false, canceled: true }; },
    } };
  }, bridge);
  await page.goto('/src/ui/providers.html?embed=1');
  await page.locator('#bunny-local').getByRole('button', { name: 'Manage', exact: true }).click();
}
const lm = (page) => page.locator('#bunny-local');

test('the download row shows Bunny\'s own folder by default and opens Windows\' picker; nothing is typed', async ({ page }) => {
  await open(page);
  await expect(lm(page).locator('[data-places="download"]')).toContainText("Bunny's own folder");
  await expect(lm(page).locator('input[type="text"], textarea')).toHaveCount(0);
  await lm(page).getByRole('button', { name: 'Change…' }).click();
  expect(await page.evaluate(() => window.__calls)).toEqual(['chooseDownloadFolder']);
});

test('a chosen folder with models left behind offers Move first; Move and Leave them are both there', async ({ page }) => {
  const moved = PLACES({ download: { ...PLACES().download, custom: true, where: 'D:\\Models', root: 'D:\\Models\\Bunny models', cloud: false } });
  const posts = [];
  await open(page, { places: moved, onPost: async (p) => { posts.push(p); return moved; } });
  const c = lm(page).locator('[data-card="move"]');
  await expect(c).toContainText('Move your 1 downloaded model to the new folder?');
  await expect(c).toContainText('plus 2 GB free');
  await expect(c.getByRole('button').first()).toHaveText('Move');
  await c.getByRole('button', { name: 'Move', exact: true }).click();
  expect(posts).toContain('move');
  await expect(lm(page).getByRole('button', { name: "Use Bunny's folder" })).toBeVisible();
});

test('an unavailable download folder says so and never mentions a fall-back; a model that is gone says Not found', async ({ page }) => {
  const gone = PLACES({ download: { ...PLACES().download, custom: true, where: 'E:\\Models', root: null, available: false, message: "The download folder isn't available. Plug in the drive or choose another folder." } });
  await open(page, { places: gone, models: [{ ...MODEL, notFound: true, state: 'none' }] });
  await expect(lm(page)).toContainText("The download folder isn't available. Plug in the drive or choose another folder.");
  await expect(lm(page)).toContainText('Not found');
  await expect(lm(page)).not.toContainText('falls back');
});

test('LF-6: the add card puts "Don\'t add" first; Add stays off until the person says they trust the file; an unknown chat format is shown as plain text, never as markup', async ({ page }) => {
  const evil = '<img src=x onerror="window.__pwned=1">{{ messages }}';
  await page.addInitScript((tpl) => {
    window.__pick = { ok: true, card: { token: 't1', name: 'quill.Q4_K_M.gguf', where: 'C:\\Users\\Sam\\Models', size: 8.9e9, architecture: 'llama', quant: 'Q4_K_M', license: 'The file names no licence',
      format: { kind: 'unknown', text: 'Unknown chat format' }, template: tpl, memory: { size: 8.9e9, freeRam: 7.1e9, freeVram: null, mayNotFit: true }, fromLmStudio: false, toolsOff: true,
      trust: "Bunny didn't download this file and can't check where it came from. A model file can carry an attack on the program that loads it, and its chat format is run as given. Add it only if you trust where you got it." } };
  }, evil);
  const posts = [];
  await open(page, { onPost: async (p, b) => { posts.push([p, b]); return p === 'add-file' ? { added: { id: 'x' }, places: PLACES({ own: [{ id: 'x', name: 'quill.Q4_K_M.gguf', size: 8.9e9, format: 'unknown', toolsOn: false, real: 'C:\\Users\\Sam\\Models\\quill.Q4_K_M.gguf' }] }) } : PLACES(); } });
  await lm(page).getByRole('button', { name: 'Add a model from this PC…' }).click();
  const c = lm(page).locator('[data-card="add-file"]');
  await expect(c).toContainText("Bunny didn't download this file and can't check where it came from");
  await expect(c).toContainText('Unknown chat format');
  await expect(c).toContainText('This may not fit in memory and can make the PC slow.');
  await expect(c).toContainText('Tools are off for this model.');
  await expect(c.locator('.lm-acts button').nth(0)).toHaveText("Don't add");
  await expect(c.locator('.btn-primary')).toHaveText("Don't add");
  await expect(c.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
  await c.getByRole('button', { name: 'Show the template' }).click();
  await expect(c.locator('pre')).toHaveText(evil);
  expect(await c.locator('pre img').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  await c.getByLabel(/I trust where I got this file/).check();
  await c.getByRole('button', { name: 'Add', exact: true }).click();
  expect(posts.find(([p]) => p === 'add-file')[1]).toEqual({ token: 't1' });
  await expect(lm(page).locator('[data-own="x"]')).toContainText('Your file');
  await expect(lm(page).locator('[data-own="x"]')).toContainText('Tools off');
  await expect(lm(page).locator('[data-own="x"]')).toContainText('The file stays where it is.');
});

test('model folders: LM Studio\'s listed first and tagged, a file is added by its id, junk files are counted not listed, Remove says what it leaves alone', async ({ page }) => {
  const folders = [{ id: 'lmstudio', auto: 'lmstudio', name: "LM Studio's models folder", real: 'C:\\Users\\Sam\\.lmstudio\\models', state: 'ok', count: 1, models: [{ id: 'abc123', name: 'harbor\u202E.gguf', size: 1.9e9, quant: 'Q4_K_M', architecture: 'llama', where: 'pub\\harbor', format: 'known', added: false }], skipped: { split: 2, projector: 1, unreadable: 1 } },
    { id: 'f1', auto: null, name: 'Models', real: 'D:\\Models', state: 'missing', message: 'Folder not found', models: [], count: 0, skipped: {} }];
  const posts = [];
  await open(page, { places: PLACES({ folders }), onPost: async (p, b) => { posts.push([p, b]); if (p === 'inspect') return { token: 'tk', name: 'harbor.gguf', where: 'C:\\Users\\Sam\\.lmstudio\\models\\pub\\harbor', size: 1.9e9, architecture: 'llama', quant: 'Q4_K_M', license: 'The file says: apache-2.0', format: { kind: 'known', text: 'Same chat format as Qwen3 4B' }, template: null, memory: { size: 1.9e9, freeRam: 7e9, freeVram: null, mayNotFit: false }, fromLmStudio: true, toolsOff: true, trust: 'trust sentence' }; return PLACES({ folders }); } });
  const g = lm(page).locator('[data-places="folders"]');
  await expect(g).toContainText("LM Studio's models folder");
  await expect(g).toContainText('Found automatically');
  await expect(g).toContainText('Folder not found');
  await expect(g).toContainText('Skipped 4 files');
  await expect(g.locator('[data-entry="abc123"] b')).toHaveText('harbor.gguf'.replace('harbor', 'harbor\u202E'));
  await g.getByRole('button', { name: /^Add harbor/ }).click();
  expect(posts.find(([p]) => p === 'inspect')[1]).toEqual({ entryId: 'abc123' });
  await expect(lm(page).locator('[data-card="add-file"]')).toContainText("From LM Studio's models folder");
  await expect(lm(page).locator('[data-card="add-file"]')).toContainText('Same chat format as Qwen3 4B');
  await lm(page).locator('[data-card="add-file"]').getByRole('button', { name: "Don't add" }).click();
  await g.getByRole('button', { name: /^Remove Models from the list/ }).click();
  await expect(g.locator('[data-card="remove-folder"]')).toContainText("Your files and anything you downloaded elsewhere aren't touched");
});

test('Remove Bunny local names each place and what is never touched; a plain browser (no dialogs) shows "Bunny\'s window only"', async ({ page }) => {
  await open(page, { bridge: false });
  await expect(lm(page)).toContainText("Change: Bunny's window only");
  await lm(page).getByRole('button', { name: 'Remove…' }).click();
  await expect(lm(page).locator('[data-card="remove"]')).toContainText('2.3 GB in C:\\Users\\Sam\\AppData\\Local\\BunnyAI\\models');
  await expect(lm(page).locator('[data-card="remove"]')).toContainText('Your own model files and the folders you added are never touched');
});

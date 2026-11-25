import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resetProfile } from './helpers.js';

// AGENT-FLOW F12 in the page: the chip starts on Smart, the first message in a git folder asks once (the trust card), a yes lists the folder in Settings and Remove brings the card back.
// Everything runs on the e2e suite's invented profile and invented folders.
test.describe.configure({ mode: 'serial' });

const frame = (d) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}

`;
let server; let port;
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.url.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"data":[{"id":"scripted"}]}'); return; }
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`${frame({ content: 'Hello.' })}data: [DONE]

`);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
test.afterAll(async () => { await new Promise((r) => { server.closeAllConnections?.(); server.close(r); }); });
test.beforeEach(async ({ request }) => {
  await resetProfile(request);
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: 'all', autoJudgeEnabled: true } }); // the e2e server is shared: an earlier spec may have turned the check off
  expect((await request.post('/api/providers/custom', { data: { name: 'Scripted', baseUrl: `http://127.0.0.1:${port}/v1` } })).ok()).toBeTruthy();
});
test.afterEach(async ({ request }) => {
  for (const p of (await (await request.get('/api/providers')).json()).filter((x) => x.custom)) await request.delete(`/api/providers/${p.id}`);
  await request.put('/api/settings', { data: { modelFilter: null } });
});
const gitRepo = () => {
  const d = mkdtempSync(join(tmpdir(), 'bunny-f12-e2e-git-')); const g = (...a) => execFileSync('git', a, { cwd: d, stdio: 'pipe' });
  g('init', '-q', '-b', 'main'); g('config', 'user.email', 'qa@example.invalid'); g('config', 'user.name', 'QA'); writeFileSync(join(d, 'README.md'), '# demo\n'); g('add', '.'); g('commit', '-q', '-m', 'first');
  return d;
};
async function open(page) {
  await page.goto('/');
  await page.evaluate(() => { localStorage.setItem('bunny.modelAuto', '0'); localStorage.setItem('bunny.workMode', 'code'); });
  await page.goto('/');
  await expect(page.locator('#greeting')).toBeVisible();
  await page.locator('#picker-button').click();
  await page.locator('.picker-panel .picker-item:not(.picker-auto)').first().click();
}
async function useFolder(page, dir) {
  await page.locator('#mode-code').click();
  if (!(await page.getByRole('dialog', { name: 'Choose a folder' }).count())) await page.locator('#folder-chip').click();
  await page.locator('input[aria-label="Folder path"]').fill(dir);
  await page.getByRole('button', { name: 'Use folder' }).click();
  await expect(page.locator('#folder-chip')).toHaveAttribute('title', /Working folder/);
}

test('the chip starts on Smart and says in words what Smart does', async ({ page }) => {
  await open(page);
  await expect(page.locator('#mode-label')).toHaveText('Smart');
  await expect(page.locator('#mode-button')).toHaveAttribute('title', /runs in Auto in a git folder you trusted/);
  await page.locator('#mode-button').click();
  await expect(page.locator('#mode-menu [data-mode="smart"]')).toContainText('git folder you trusted');
});

test('the first message in a git folder shows the trust card once; yes lists it in Settings; Remove asks again; a plain folder never asks', async ({ page, request }) => {
  const repo = gitRepo();
  await open(page);
  await useFolder(page, repo);
  await page.locator('#input').fill('hello'); await page.locator('#send').click();
  const card = page.getByRole('group', { name: 'Trust this folder?' });
  await expect(card).toBeVisible();
  await expect(card).toContainText(repo.split(/[\\/]/).pop());
  await expect(card).toContainText("Commands and changes run without asking you, unless Bunny's check stops them or a rule asks.");
  await card.getByRole('button', { name: 'Trust this folder for Auto' }).click();
  await expect(card).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(`/api/folder-trust?folder=${encodeURIComponent(repo)}`)).json()).auto).toBe(true);
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });
  // answered: the next message does not ask again
  await page.locator('#input').fill('again'); await page.locator('#send').click();
  await expect(page.getByRole('group', { name: 'Trust this folder?' })).toHaveCount(0);
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });

  await page.goto('/src/ui/settings.html?embed=1&section=code');
  const list = page.locator('#trusted-folders');
  await expect(list).toContainText(repo.split(/[\\/]/).pop());
  await list.getByRole('button', { name: /Stop trusting/ }).first().click();
  await expect.poll(async () => (await (await request.get(`/api/folder-trust?folder=${encodeURIComponent(repo)}`)).json()).auto).toBe(null);

  // a plain folder is never asked
  const plain = mkdtempSync(join(tmpdir(), 'bunny-f12-e2e-plain-'));
  await open(page); await useFolder(page, plain);
  await page.locator('#input').fill('hello'); await page.locator('#send').click();
  await expect(page.getByRole('group', { name: 'Trust this folder?' })).toHaveCount(0);
});

test('Settings: Smart is the recommended default, the check is on, and the Trusted folders row explains itself', async ({ page }) => {
  await page.goto('/src/ui/settings.html?embed=1&section=code');
  await expect(page.locator('#default-permission')).toHaveValue('smart');
  await expect(page.locator('#auto-judge-row input')).toBeChecked();
  await expect(page.locator('#trusted-folders-row')).toContainText('Smart runs in Auto only in these git folders');
});

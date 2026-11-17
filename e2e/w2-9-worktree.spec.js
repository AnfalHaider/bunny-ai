import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resetProfile } from './helpers.js';

// W2-9: the Working folder card. A chat gets its own copy of an invented repository, the branch chip says so, Finish keeps the branch.
const env = { ...process.env, GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true }).trim();

test.beforeEach(async ({ request }) => { await resetProfile(request); });

test('the folder chip opens a card; the switch makes the chat its own copy, Finish keeps the branch', async ({ page, request }) => {
  const repo = mkdtempSync(join(tmpdir(), 'bunny-e2e-wt-'));
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(repo, 'a.txt'), 'a\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'first');
  await request.post('/api/folder/check', { data: { folder: repo } });
  const made = await (await request.post('/api/sessions', { data: { title: 'Tidy the greeter', folder: repo } })).json();
  await page.addInitScript(() => localStorage.setItem('bunny.workMode', 'code')); // the folder chip is shown in Code mode only
  await page.goto('/');
  await page.getByText('Tidy the greeter').first().click();
  await expect(page.locator('#folder-chip')).toBeVisible();
  await page.locator('#folder-chip').click();
  const card = page.getByRole('dialog', { name: 'Working folder' });
  await expect(card).toBeVisible();
  await expect(card.getByLabel('Give this chat its own copy of the project')).not.toBeChecked();
  await card.getByLabel('Give this chat its own copy of the project').check();
  await expect(card.getByRole('status')).toContainText('Branch bunny/tidy-the-greeter-');
  await expect(page.locator('#branch-text')).toContainText('own copy');
  const { worktree } = await (await request.get(`/api/sessions/${made.id}`)).json();
  expect(existsSync(worktree.path)).toBe(true);
  await card.getByRole('button', { name: 'Finish…' }).click();
  await expect(page.getByRole('dialog').getByText('Keep the branch')).toBeVisible();
  await page.getByRole('button', { name: 'Finish', exact: true }).click();
  await expect(page.locator('#branch-text')).not.toContainText('own copy');
  expect(existsSync(worktree.path)).toBe(false);
  expect(git(repo, 'branch', '--list', 'bunny/*')).toContain('bunny/tidy-the-greeter-');
});

test('a folder that is not a git project has the switch dimmed, with the reason', async ({ page, request }) => {
  const plain = mkdtempSync(join(tmpdir(), 'bunny-e2e-plain-'));
  await request.post('/api/folder/check', { data: { folder: plain } });
  await request.post('/api/sessions', { data: { title: 'Plain folder chat', folder: plain } });
  await page.addInitScript(() => localStorage.setItem('bunny.workMode', 'code'));
  await page.goto('/');
  await page.getByText('Plain folder chat').first().click();
  await expect(page.locator('#folder-chip')).toBeVisible();
  await page.locator('#folder-chip').click();
  const card = page.getByRole('dialog', { name: 'Working folder' });
  await expect(card.getByLabel('Give this chat its own copy of the project')).toBeDisabled();
  await expect(card).toContainText('not one');
});

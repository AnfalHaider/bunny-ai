import { test, expect } from '@playwright/test';
import { resetProfile } from './helpers.js';
import { heldProvider } from './pictures/held-provider.mjs';
import { startFake } from '../test/fake-mcp-oauth.js';

// AGENT-FLOW F5: the capability cards, in the real window. A scripted model asks for a capability; the card is answered by clicking; the sign-in of a stand-in OAuth connector completes
// (loopback stand-in, invented data) and its tools arrive in the SAME reply. A device's chat is told what it can't use.
let model;
let fake;
test.afterEach(async () => { await model?.close().catch(() => {}); await fake?.close().catch(() => {}); model = null; fake = null; });

async function connectModel(request, steps) {
  model = await heldProvider(steps);
  await request.post('/api/providers/custom', { data: { name: 'F5 model', baseUrl: model.url } });
  await request.put('/api/settings', { data: { displayName: 'Sam', theme: 'light', motion: 'reduced' } });
}
const ask = async (page, text) => { await page.locator('#input').fill(text); await page.locator('#send').click(); };
const toolNames = (body) => (body?.tools ?? []).map((d) => d.function.name);
const toolSaid = (body) => String(body?.messages?.filter((m) => m.role === 'tool').at(-1)?.content ?? '');

test('connector_sign_in: the card, the Sign in step, the stand-in sign-in completing, and the connector\'s tool arriving and running in the same reply', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  await resetProfile(request);
  fake = await startFake({ idToken: true }, baseURL);
  await request.post('/api/mcp', { data: { name: 'Fake docs', url: fake.server.url, enabled: true } });
  await connectModel(request, [
    { tool: ['request_capability', { capability: 'connector_sign_in', connector: 'Fake docs', reason: 'read your documents' }] },
    { tool: ['fake_docs__ping', {}] },
    { final: 'Signed in and pinged.' },
  ]);
  await page.goto('/');
  await ask(page, 'read my documents from Fake docs');
  const card = page.locator('.capability-card', { hasText: 'Sign in to Fake docs' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: /^Allow|Yes|Sign in/i }).first().click();
  // the same Sign in button a connector found at the start of a reply shows; the person's browser is played by this test
  const popup = page.waitForEvent('popup');
  await page.locator('.signin-step').getByRole('button', { name: 'Sign in' }).click();
  const opened = await popup;
  const { code, state } = fake.browse(opened.url());
  const back = await fetch(`${baseURL}/api/connectors/oauth/callback?${new URLSearchParams({ state, code })}`, { headers: { 'sec-fetch-site': 'cross-site' } });
  expect(back.status).toBe(200);
  // the new tool keeps its own card, as any connector tool does in Ask mode: the person allows it
  const toolCard = page.locator('.permission-prompt', { hasText: 'Fake docs' });
  await expect(toolCard).toBeVisible({ timeout: 40_000 });
  await toolCard.getByRole('button', { name: /^Allow/ }).first().click();
  await expect(page.getByText('Signed in and pinged.')).toBeVisible({ timeout: 40_000 });
  const [first, second, third] = model.requests;
  expect(toolNames(first)).toContain('request_capability');
  expect(toolNames(first), 'the connector had no tools before it was signed in').not.toContain('fake_docs__ping');
  expect(toolNames(second), 'the tool arrived in the SAME reply').toContain('fake_docs__ping');
  expect(toolSaid(second)).toMatch(/Fake docs is ready\. You now have its tools: fake_docs__ping/);
  expect(toolSaid(third)).toContain('pong');
});

test('sign_in: the card says Sign in to GitHub, and Allow opens Settings › Profile where the person signs in', async ({ page, request }) => {
  await resetProfile(request);
  await connectModel(request, [{ tool: ['request_capability', { capability: 'sign_in', service: 'github', reason: 'list your open issues' }] }]);
  await page.goto('/');
  await ask(page, 'list my open GitHub issues');
  const card = page.locator('.capability-card', { hasText: 'Sign in to GitHub' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Settings › Profile');
  await card.getByRole('button', { name: /^Allow|Yes|Sign in/i }).first().click();
  await expect(page.locator('#settings-frame')).toBeVisible();
  expect(await page.locator('#settings-frame').getAttribute('src')).toContain('settings.html');
});

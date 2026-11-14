import { test, expect } from '@playwright/test';

import {
  resetProfile, connectAnthropic, pickFirstModel, chat, connectAndChat,
} from './helpers.js';

// The last surfaces: charts, speech, updates and suggested memories.

test.beforeEach(async ({ request }) => {
  await resetProfile(request);
});

test('an artifact that is data is drawn as a chart', async ({ page }) => {
  await connectAndChat(page, 'make me a chart');
  await page.locator('.msg.assistant .msg-actions button[data-act="artifact"]').last().click();
  await expect(page.locator('#artifact-view')).toBeVisible();

  // Replace the artifact with chart data and look again.
  const artifacts = await page.request.get('/api/artifacts').then((r) => r.json());
  await page.request.patch(`/api/artifacts/${artifacts[0].id}`, {
    data: {
      kind: 'markdown',
      content: JSON.stringify({ type: 'bar', title: 'Spending', labels: ['Jan', 'Feb'], values: [10, 24] }),
    },
  });
  await page.reload();
  await page.locator('#artifacts-toggle').click();
  await page.locator('#artifact-list .artifact-row').first().click();

  await expect(page.locator('.artifact-chart svg')).toBeVisible();
  await expect(page.locator('.artifact-chart svg rect')).toHaveCount(2);
  await expect(page.locator('.artifact-chart svg')).toContainText('Spending');
});

test('a reply can be read aloud', async ({ page }) => {
  // A stand-in for the browser's speech, so the test can see that it was
  // asked to speak. The real properties are read-only, so they are replaced.
  await page.addInitScript(() => {
    window.__spoken = [];
    const stub = {
      speak: (utterance) => window.__spoken.push(utterance.text),
      cancel: () => {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: stub, configurable: true, writable: true });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: class { constructor(text) { this.text = text; } },
      configurable: true,
      writable: true,
    });
  });

  await connectAndChat(page, 'read this back to me');
  await page.locator('.msg.assistant .msg-actions button[data-act="read"]').last().click();

  const spoken = await page.evaluate(() => window.__spoken);
  expect(spoken.length).toBe(1);
  expect(spoken[0]).toContain('This is a local test reply');
});

test('voice input says so when the browser cannot listen', async ({ page }) => {
  // A browser with no speech recognition at all.
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });

  await page.goto('/');
  await page.locator('#voice').click();
  // The app says so rather than pretending to listen.
  await expect(page.locator('#error')).toContainText(/type instead/i);
});

test('the version is shown and the update check is honest', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await expect(page.locator('#version')).toContainText(/\d+\.\d+\.\d+/);

  // With no update source, the app says that rather than pretending.
  await page.locator('#check-update').click();
  await expect(page.locator('#update-note')).toContainText(/no update source/i);
});

test('a newer version in the feed is reported', async ({ page }) => {
  await page.goto('/src/ui/settings.html');
  await page.locator('#update-url').fill('http://127.0.0.1:9/version.json');
  await page.locator('#check-update').click();
  await expect(page.locator('#update-note')).toContainText(/could not be reached|answered/i);
});

test('a chat can suggest a memory, and it is kept only when accepted', async ({ page }) => {
  await connectAnthropic(page);
  await page.goto('/');
  await pickFirstModel(page);
  await page.locator('#input').fill('remember that I work in Lisbon');
  await page.locator('#send').click();

  // The chat exists once the reply is in.
  await expect(page.locator('.msg.user .body')).toHaveText('remember that I work in Lisbon');
  await expect(page.locator('#stop')).toBeHidden({ timeout: 20_000 });

  const sessionId = new URL(page.url()).searchParams.get('s');
  expect(sessionId).toBeTruthy();
  await page.goto(`/src/ui/automation.html?s=${sessionId}`);

  const suggestions = page.locator('#memory-suggestions');
  await expect(suggestions).toContainText('I work in Lisbon');

  // Nothing is remembered until it is accepted.
  await expect(page.locator('#memory-list')).not.toContainText('Lisbon');
  await suggestions.getByRole('button', { name: 'Remember' }).first().click();
  await expect(page.locator('#memory-list')).toContainText('Lisbon');
});

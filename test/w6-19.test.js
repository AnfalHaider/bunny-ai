import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectJob, rankModels, noEyesWarning, modelAbilities } from '../src/ui/model-abilities.js';

// W6-19: picture jobs (copy a site, compare pages) are "see" jobs: Auto picks a model that can see, and a model chosen by hand that cannot is warned about.
test('copying or comparing how a site, a page or a design looks is a see job, in chat and in Code mode', () => {
  for (const text of ['Copy this website exactly', 'clone the landing page of that site', 'Recreate this design in HTML', 'compare these two pages and tell me what differs', 'make my page match the layout of the screenshot', 'replicate the look of their site']) {
    assert.equal(detectJob(text), 'see', text);
    assert.equal(detectJob(text, { workMode: 'code' }), 'see', `${text} (Code mode)`);
  }
});

test('everything that is not about how something looks stays as it was', () => {
  assert.equal(detectJob('compare the prices of these laptops'), 'research');
  assert.equal(detectJob('copy this file to the backup folder', { workMode: 'code' }), 'code');
  assert.equal(detectJob('how do I match a regex against a string'), 'code');
  assert.equal(detectJob('hello'), 'chat');
  assert.equal(detectJob('what is on this', { hasImage: true }), 'see');
});

test('Auto, for a picture job, picks only models that can see', () => {
  const models = [{ providerId: 'p', id: 'tiny-text-8b' }, { providerId: 'p', id: 'gpt-4o' }, { providerId: 'q', id: 'llama-3.3-70b-instruct' }];
  const ranked = rankModels(models, detectJob('copy this website'));
  assert.ok(ranked.length >= 1);
  assert.ok(ranked.every((m) => modelAbilities(m).runs.has('see')), ranked.map((m) => m.id).join(', '));
  assert.ok(!ranked.some((m) => m.id === 'tiny-text-8b'));
});

test('a model chosen by hand that cannot see gets one plain warning on a picture job, and only then', () => {
  const warn = (extra) => noEyesWarning({ job: 'see', modelAuto: false, modelName: 'text-only', canSee: false, ...extra });
  assert.match(warn({}), /text-only cannot look at pictures/);
  assert.equal(warn({ modelAuto: true }), null, 'Auto picks a model that can see');
  assert.equal(warn({ canSee: true }), null);
  assert.equal(warn({ job: 'chat' }), null);
  assert.equal(warn({ job: 'code' }), null);
});

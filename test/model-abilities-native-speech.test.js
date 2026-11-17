import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelAbilities } from '../src/ui/model-abilities.js';

// W4-13: every chat model can have its answer read out by a Windows voice ("speech" in abilities), but only a model that makes sound itself
// is shown and filtered as Speech in the picker. The two are told apart by nativeSpeech.
test('a plain chat model has the speech ability but not native speech', () => {
  const a = modelAbilities({ id: 'falcon-flash', displayName: 'Falcon Flash' });
  assert.ok(a.abilities.has('speech'));
  assert.equal(a.nativeSpeech, false);
});

test('a model that outputs audio has native speech', () => {
  const a = modelAbilities({ id: 'echo-voice', outputModalities: ['audio'] });
  assert.ok(a.abilities.has('speech'));
  assert.equal(a.nativeSpeech, true);
});

test('a text-to-speech model by name has native speech; a utility model has none', () => {
  assert.equal(modelAbilities({ id: 'acme-tts-1' }).nativeSpeech, true);
  assert.equal(modelAbilities({ id: 'acme-embed-1' }).nativeSpeech, false);
});

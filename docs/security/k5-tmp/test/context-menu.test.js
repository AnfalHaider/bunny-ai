import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContextMenuTemplate } from '../electron/context-menu.js';

const allFlags = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const labels = (t) => t.map((i) => i.label || i.role || i.type);

test('misspelled word: suggestions, then Add to dictionary, then edit items', () => {
  const t = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the', 'tea'], editFlags: allFlags }, {});
  assert.deepEqual(labels(t), ['the', 'tea', 'Add to dictionary', 'separator', 'undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'selectAll']);
});

test('no suggestions gives a disabled item', () => {
  const t = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'zzqx', dictionarySuggestions: [], editFlags: allFlags }, {});
  assert.equal(t[0].label, 'No suggestions');
  assert.equal(t[0].enabled, false);
  assert.equal(t[1].label, 'Add to dictionary');
});

test('at most 5 suggestions', () => {
  const t = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'x', dictionarySuggestions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], editFlags: allFlags }, {});
  assert.deepEqual(labels(t).slice(0, 6), ['a', 'b', 'c', 'd', 'e', 'Add to dictionary']);
});

test('editFlags disable Cut/Copy/Paste', () => {
  const t = buildContextMenuTemplate({ isEditable: true, editFlags: { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: true, canSelectAll: true } }, {});
  const by = Object.fromEntries(t.filter((i) => i.role).map((i) => [i.role, i.enabled]));
  assert.equal(by.cut, false);
  assert.equal(by.copy, false);
  assert.equal(by.paste, true);
  assert.equal(by.undo, false);
  assert.equal(t[0].type, undefined);
});

test('non-editable with a selection gives only Copy', () => {
  const t = buildContextMenuTemplate({ isEditable: false, selectionText: 'hello', editFlags: { canCopy: true } }, {});
  assert.deepEqual(labels(t), ['copy']);
});

test('a link gives Copy link', () => {
  const t = buildContextMenuTemplate({ isEditable: false, linkURL: 'https://example.com/a' }, {});
  assert.deepEqual(labels(t), ['Copy link']);
});

test('nothing to offer gives an empty template', () => {
  assert.deepEqual(buildContextMenuTemplate({ isEditable: false, selectionText: '' }, {}), []);
  assert.deepEqual(buildContextMenuTemplate({}, {}), []);
});

test('clicks call the right action with the right argument', () => {
  const calls = [];
  const actions = {
    replaceMisspelling: (w) => calls.push(['replace', w]),
    addToDictionary: (w) => calls.push(['add', w]),
    copyLink: (u) => calls.push(['link', u]),
  };
  const t = buildContextMenuTemplate({ isEditable: true, misspelledWord: 'teh', dictionarySuggestions: ['the'], editFlags: allFlags }, actions);
  t.find((i) => i.label === 'the').click();
  t.find((i) => i.label === 'Add to dictionary').click();
  const l = buildContextMenuTemplate({ linkURL: 'https://example.com/x' }, actions);
  l[0].click();
  assert.deepEqual(calls, [['replace', 'the'], ['add', 'teh'], ['link', 'https://example.com/x']]);
});

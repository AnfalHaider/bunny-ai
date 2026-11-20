import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeSwitch, engineName } from '../src/ui/engine-switch.js';
import { blockNote, fileChip, lineDiff } from '../src/ui/folder-rules-ui.js';

// The words and the choices of the ENGINE-SWITCH card and the FOLDER-RULES block (Design's drawings v2 and v4), as plain functions of what the page knows. The screens are in e2e/engine-switch-ui.spec.js.

const followed = { enabled: true, chatSwitch: true, trusted: true, files: [{ name: 'AGENTS.md', state: 'in-use' }] };

test('the confirm card: its title, button, what the engine gets and which rules it follows, by variant', () => {
  const plain = describeSwitch({ to: 'codex', session: { messages: [] }, folder: 'C:\\Users\\Sam\\carrot-shop', view: followed });
  assert.equal(plain.title, 'Switch this chat to Codex CLI?');
  assert.equal(plain.button, 'Switch to Codex CLI');
  assert.deepEqual(plain.paragraphs, ['It carries on in C:\\Users\\Sam\\carrot-shop.', "Codex CLI follows Bunny's rules.", "It gets this chat's folder, its instruction files, a summary of the conversation and the list of files this chat changed."]);
  assert.deepEqual(plain.foot, ['Your files and Undo stay as they are.']);
  const own = describeSwitch({ to: 'codex', session: {}, folder: 'D:\\p', view: followed, useBunnyEngine: false });
  assert.match(own.paragraphs[1], /^Bunny's engine is off, so Codex follows its own rules: it asks you about every command and file change\.$/);
  const ownClaude = describeSwitch({ to: 'claude-code', session: {}, folder: 'D:\\p', view: followed, useBunnyEngine: false });
  assert.match(ownClaude.paragraphs[1], /Claude Code follows the rules you set for it in Settings → Engines: Allow runs with no question, Ask shows a card, Deny stops it\.$/);
  const restricted = describeSwitch({ to: 'claude-code', session: {}, folder: 'D:\\p', view: followed, restrictedAgain: true });
  assert.match(restricted.paragraphs[1], /^Claude Code runs restricted in this chat: Bunny's check failed for it earlier\./);
  assert.match(restricted.foot[0], /^If you switch away later, the other engine runs in full mode, and Claude Code stays restricted if you come back\.$/);
});

test('the card only promises what Bunny sends: instruction files only when followed, the PC-files note only when the chat has such answers', () => {
  const waiting = describeSwitch({ to: 'codex', session: {}, folder: 'D:\\p', view: { enabled: true, chatSwitch: true, trusted: false, files: [{ name: 'AGENTS.md', state: 'waiting' }] } });
  assert.doesNotMatch(waiting.paragraphs.join(' '), /its instruction files/);
  assert.match(waiting.paragraphs.join(' '), /Not followed yet: it will not get the folder's instruction files until you choose Follow them\./);
  const none = describeSwitch({ to: 'codex', session: {}, folder: 'D:\\p', view: { enabled: true, chatSwitch: true, trusted: false, files: [] } });
  assert.doesNotMatch(none.paragraphs.join(' '), /instruction files/, 'no files in the folder: nothing is promised or said');
  const off = describeSwitch({ to: 'codex', session: {}, folder: 'D:\\p', view: { ...followed, chatSwitch: false } });
  assert.doesNotMatch(off.paragraphs.join(' '), /instruction files/);
  const pc = describeSwitch({ to: 'codex', session: { messages: [{ role: 'assistant', pcSources: [{ n: 1 }] }] }, folder: 'D:\\p', view: followed });
  assert.match(pc.paragraphs.at(-1), /a summary of the conversation \(answers that used files from this PC are left out\)/);
  const bunny = describeSwitch({ to: 'bunny', session: {}, folder: '', view: null });
  assert.equal(bunny.title, 'Switch this chat to Bunny?');
  assert.match(bunny.paragraphs[0], /^Bunny's engine carries on from this chat's messages\./);
  assert.equal(engineName('codex'), 'Codex CLI');
});

test('the chips and the note of the Project instructions block, in the drawing\'s words', () => {
  assert.deepEqual(fileChip({ state: 'in-use', kind: 'main' }), { text: 'in use', tone: 'ok' });
  assert.deepEqual(fileChip({ state: 'in-use', kind: 'cursor' }), { text: 'added', tone: 'ok' });
  assert.equal(fileChip({ state: 'waiting', kind: 'main' }).text, 'waiting for you');
  assert.equal(fileChip({ state: 'changed', kind: 'main' }).text, 'changed since it was read');
  assert.equal(fileChip({ state: 'gone', kind: 'main' }).text, 'no longer on disk');
  assert.equal(fileChip({ state: 'off', kind: 'main' }).text, 'switched off');
  assert.equal(blockNote({ enabled: true, chatSwitch: true, trusted: false, files: [{ state: 'waiting' }] }), 'Not followed yet, so no engine gets them.');
  assert.match(blockNote({ enabled: true, chatSwitch: true, trusted: true, files: [{ state: 'changed' }] }), /Every engine still gets the text it was shown\. Read again to look at the change\./);
  assert.match(blockNote(followed, { engineId: 'codex' }), /Followed for this folder\. This chat runs on Codex CLI\. It gets the same text as Bunny and the other engine\./);
  assert.match(blockNote({ enabled: true, chatSwitch: false, trusted: true, files: [] }), /Switched off for this chat/);
});

test('the diff Read again shows: unchanged lines, removed lines and added lines', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nB\nc\nd'), [{ t: ' ', s: 'a' }, { t: '-', s: 'b' }, { t: '+', s: 'B' }, { t: ' ', s: 'c' }, { t: '+', s: 'd' }]);
  assert.deepEqual(lineDiff('same', 'same'), [{ t: ' ', s: 'same' }]);
});

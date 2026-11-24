import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pcWorld } from './support/pc-world.mjs';
import { post } from './helpers.js';

// AGENT-FLOW F8 and QUICK-ASK-JUST-WORKS (the owner: "Yes, finding only"): Search this PC is on by default for finding only, a first-search notice, and the pc_search card (Security F8-1 to F8-3).
const tax = { 'Documents/tax return 2025.txt': 'DOC-TEXT total income 104,250' };
const json = { 'content-type': 'application/json' };
const answerCards = (grant) => async (event, data, id, w) => { void w; void event; void data; void id; void grant; };

test('a new profile: search is on and reading shows what it found; neither key is written, and an unrelated Settings save writes neither', async (t) => {
  const w = await pcWorld(t, { files: tax, settings: {}, calls: [['search_pc', { terms: ['tax'] }]] });
  await fetch(`${w.base}/api/settings`, { method: 'PUT', headers: json, body: JSON.stringify({ theme: 'dark' }) });
  const saved = JSON.parse(await readFile(join(w.dirs.data, 'settings.json'), 'utf8'));
  assert.ok(!('pcSearchEnabled' in saved), 'the default is not written to the settings file');
  assert.ok(!('pcSearchAfter' in saved));
  const settings = await (await fetch(`${w.base}/api/settings`)).json();
  assert.equal(settings.pcSearchEnabled, undefined);
  await w.say('find my tax return');
  assert.ok(w.toolNames(w.requests[0]).includes('search_pc'), 'search is on with no value saved');
  const told = w.toolAnswers()[0];
  assert.match(told, /tax return 2025\.txt/);
  assert.ok(!/DOC-TEXT|104,250/.test(told), 'reading defaults to showing what it found: no file text reaches the model');
});

test('a saved false stays off; a saved true stays on', async (t) => {
  const off = await pcWorld(t, { files: tax, settings: { pcSearchEnabled: false }, calls: [] });
  await off.say('find my tax return');
  assert.ok(!off.toolNames(off.requests[0]).includes('search_pc'));
  const on = await pcWorld(t, { files: tax, settings: { pcSearchEnabled: true, pcSearchAfter: 'read' }, calls: [] });
  await on.say('find my tax return');
  assert.ok(on.toolNames(on.requests[0]).includes('search_pc'));
});

test('the first search shows one non-blocking notice (names and folders go to the model, where to turn it off), once, and never on a device', async (t) => {
  const w = await pcWorld(t, { files: tax, settings: {}, calls: [['search_pc', { terms: ['tax'] }], ['search_pc', { terms: ['return'] }]] });
  const first = await w.say('find my tax return');
  const notices = first.events.filter((e) => e.event === 'notice' && /Search this PC is on, for finding files only/.test(e.data.text));
  assert.equal(notices.length, 1, 'one notice, in the first search of the first reply');
  assert.match(notices[0].data.text, /File names and folders it finds go to the model/);
  assert.match(notices[0].data.text, /Turn it off in Settings › Capabilities\./);
  const saved = JSON.parse(await readFile(join(w.dirs.data, 'settings.json'), 'utf8'));
  assert.equal(saved.pcSearchNoticeShown, true);
  // a second search, and a second reply: no more notices
  assert.equal(first.events.filter((e) => e.event === 'notice' && /Search this PC is on/.test(e.data.text ?? '')).length, 1);
  const again = await pcWorld(t, { files: tax, settings: { pcSearchNoticeShown: true }, calls: [['search_pc', { terms: ['tax'] }]] });
  const second = await again.say('find my tax return');
  assert.equal(second.events.filter((e) => e.event === 'notice' && /Search this PC is on/.test(e.data.text ?? '')).length, 0, 'already shown: not again');
});

test('F8 card: with search off, a chat in the window asks; the fixed text comes first, the reason is quoted (cut at 200, cleaned); yes turns on finding only, pcSearchAfter is unchanged, and the tools arrive in the same reply', async (t) => {
  const reason = `to find your tax file\n${'x'.repeat(300)}\u0007 "quoted"`;
  const w = await pcWorld(t, { files: tax, settings: { pcSearchEnabled: false, pcSearchAfter: 'read' }, calls: [['request_capability', { capability: 'pc_search', reason }], ['search_pc', { terms: ['tax'] }]] });
  let card = null;
  await w.say('find my tax return', { onEvent: async (event, data, id) => { if (event === 'capability') { card = data; await post(w.base, `/api/sessions/${id}/capability/${data.id}`, { granted: true }); } } });
  assert.ok(card, 'the card was shown');
  assert.equal(card.capability, 'pc_search');
  assert.equal(card.title, 'Search this PC');
  assert.ok(card.reason.startsWith('File names and paths it finds, and the text of files it reads, go to the model'), 'the fixed text first');
  assert.match(card.reason, /It stays on until you turn it off in Settings › Capabilities\./);
  const why = /Why it asks: "([^"]*)"$/.exec(card.reason)?.[1] ?? '';
  assert.ok(why.length > 0 && why.length <= 200, `the reason is quoted and cut at 200 (${why.length})`);
  assert.ok(!/[\u0000-\u001f\u007f]/.test(card.reason.replace(/\n/g, '')), 'no control characters');
  const settings = await (await fetch(`${w.base}/api/settings`)).json();
  assert.equal(settings.pcSearchEnabled, true);
  assert.equal(settings.pcSearchAfter, 'read', 'finding only: the person\'s reading choice is unchanged');
  assert.ok(w.toolNames(w.requests[1]).includes('search_pc'), 'the PC tools arrived in the SAME reply');
  assert.match(w.toolAnswers()[0], /^Search this PC is on\. You now have search_pc and read_pc_file/);
  const { PC_SYSTEM_TEXT } = await import('../src/server/pcTools.js');
  assert.ok(w.toolAnswers()[0].includes(PC_SYSTEM_TEXT), 'its instructions arrived too, in the tool result');
});

test('F8 card: a no leaves it off and gives the fixed answer; already on says so; a device and a scheduled run get no card', async (t) => {
  const w = await pcWorld(t, { files: tax, settings: { pcSearchEnabled: false }, calls: [['request_capability', { capability: 'pc_search', reason: 'x' }]] });
  await w.say('find my tax return', { onEvent: async (event, data, id) => { if (event === 'capability') await post(w.base, `/api/sessions/${id}/capability/${data.id}`, { granted: false }); } });
  assert.match(w.toolAnswers()[0], /The person said no\. Do not ask for this again/);
  assert.equal((await (await fetch(`${w.base}/api/settings`)).json()).pcSearchEnabled, false);
  const on = await pcWorld(t, { files: tax, settings: { pcSearchEnabled: true }, calls: [['request_capability', { capability: 'pc_search', reason: 'x' }]] });
  const r = await on.say('find my tax return');
  assert.equal(r.events.filter((e) => e.event === 'capability').length, 0);
  assert.match(on.toolAnswers()[0], /Search this PC is already on/);
});

test('F8: pc_search is never offered to helpers, the quick bar or devices (structure of the server and the capability map)', () => {
  const src = readFileSync(new URL('../src/server/app.js', import.meta.url), 'utf8');
  const never = src.slice(src.indexOf('const HELPER_NEVER'), src.indexOf('\n', src.indexOf('const HELPER_NEVER')));
  assert.ok(never.includes("'pc_search'"), 'a helper can never ask for it');
  assert.match(src, /Search this PC can be turned on only on the PC\./);
  assert.match(src, /if \(textOnly \|\| scheduledTask\) return 'Search this PC can be turned on only from a chat in Bunny/);
  void answerCards;
});

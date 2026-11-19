import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge, keyFolders, mapClaudeCall, mapCodexChanges, mapCodexCommand, placeOf } from '../src/server/engines/bridge.js';
import { checkRule, rulesFor } from '../src/server/permissionRules.js';

// CLI-ENGINES §3.1, §5.2: every mode x every rule effect x every mapped tool kind gives the same decision as Bunny's own engine for the same call.
// The oracle below restates app.js's order (Plan mode, deny, ask / the mode's question, allow) for calls INSIDE the folder.

const rule = (r) => checkRule(r).rule;
async function world() {
  const base = await mkdtemp(join(tmpdir(), 'bunny-bridge-'));
  const root = join(base, 'proj'); const data = join(base, 'data'); const home = join(base, 'home');
  for (const d of [root, join(root, 'src'), data, join(data, 'engines', 'claude-code'), join(home, '.ssh'), join(home, '.claude'), join(base, 'elsewhere')]) await mkdir(d, { recursive: true });
  await writeFile(join(root, 'a.txt'), 'a'); await writeFile(join(root, 'src', 'b.js'), 'b'); await writeFile(join(base, 'elsewhere', 'o.txt'), 'o'); await writeFile(join(data, 'secret.json'), '{}'); await writeFile(join(home, '.ssh', 'id'), 'k');
  return { base, root, data, home, other: join(base, 'elsewhere') };
}

function bridgeFor(w, { mode = 'ask', rules = [], answer = true, asks = [] } = {}) {
  return createBridge({
    mode, rules, root: w.root, protect: [w.data], keyFolders: keyFolders({ home: w.home, appData: join(w.base, 'AppData', 'Roaming'), localAppData: join(w.base, 'AppData', 'Local') }),
    ask: async (summary, detail) => { asks.push({ summary, detail }); return typeof answer === 'function' ? answer(summary) : answer; },
  });
}

/** What Bunny's own engine does for a call inside the folder: the same order as app.js. */
function oracle({ mode, risk, effect }) {
  if (mode === 'plan' && (risk === 'edit' || risk === 'run')) return 'refuse';
  if (effect === 'deny') return 'refuse';
  const needsOk = (mode === 'ask' && (risk === 'edit' || risk === 'run')) || (mode === 'accept' && risk === 'run');
  if (effect === 'ask' || (needsOk && effect !== 'allow')) return 'ask';
  return 'allow';
}

const KINDS = [
  { label: 'read_file', call: (w) => ({ tool: 'Read', input: { file_path: join(w.root, 'a.txt') } }), risk: 'read', pathRule: (e) => rule({ kind: 'path', ops: 'reads', pattern: 'a.txt', effect: e }) },
  { label: 'find_files', call: (w) => ({ tool: 'Glob', input: { path: join(w.root, 'src') } }), risk: 'read', pathRule: (e) => rule({ kind: 'path', ops: 'reads', pattern: 'src', effect: e }) },
  { label: 'search_files', call: (w) => ({ tool: 'Grep', input: { path: join(w.root, 'src') } }), risk: 'read', pathRule: (e) => rule({ kind: 'path', ops: 'reads', pattern: 'src', effect: e }) },
  { label: 'write_file', call: (w) => ({ tool: 'Write', input: { file_path: join(w.root, 'new.txt'), content: 'x' } }), risk: 'edit', pathRule: (e) => rule({ kind: 'path', ops: 'edits', pattern: 'new.txt', effect: e }) },
  { label: 'edit_file', call: (w) => ({ tool: 'Edit', input: { file_path: join(w.root, 'a.txt'), old_string: 'a', new_string: 'b' } }), risk: 'edit', pathRule: (e) => rule({ kind: 'path', ops: 'edits', pattern: 'a.txt', effect: e }) },
  { label: 'run_command', call: () => ({ tool: 'Bash', input: { command: 'git push origin main' } }), risk: 'run', pathRule: (e) => rule({ kind: 'command', pattern: 'git push*', effect: e }) },
];

for (const mode of ['ask', 'accept', 'auto', 'plan']) {
  test(`the table, mode ${mode}: every rule effect x every tool kind decides as Bunny's own engine does`, async () => {
    const w = await world();
    for (const k of KINDS) {
      for (const effect of [null, 'allow', 'ask', 'deny']) {
        const asks = [];
        const rules = effect ? [k.pathRule(effect)] : [];
        const b = bridgeFor(w, { mode, rules, answer: true, asks });
        const got = await b.claude(k.call(w));
        const want = oracle({ mode, risk: k.risk, effect });
        const label = `${mode} ${k.label} rule=${effect}`;
        if (want === 'refuse') { assert.equal(got.allow, false, label); assert.equal(asks.length, 0, `${label}: no question for a refusal`); }
        else if (want === 'ask') { assert.equal(got.allow, true, label); assert.equal(asks.length, 1, `${label}: asked once`); assert.equal(got.asked, true); }
        else { assert.equal(got.allow, true, label); assert.equal(asks.length, 0, `${label}: not asked`); }
        // and a "no" from the person is a refusal
        if (want === 'ask') { const no = await bridgeFor(w, { mode, rules, answer: false }).claude(k.call(w)); assert.equal(no.allow, false, `${label}: no means no`); }
      }
    }
  });
}

test('Plan mode gives the same wording as Bunny\'s own engine for a refused edit or command', async () => {
  const w = await world();
  const b = bridgeFor(w, { mode: 'plan' });
  const r = await b.claude({ tool: 'Bash', input: { command: 'echo hi' } });
  assert.equal(r.allow, false);
  assert.match(r.reason, /^Plan mode is read-only, so the command was not run\. Propose what you would do and let the person switch mode\.$/);
  assert.equal((await b.claude({ tool: 'Read', input: { file_path: join(w.root, 'a.txt') } })).allow, true, 'reading is fine in Plan mode');
});

test('protected places are always refused, in every mode, even with an allow rule: the data folder, the engine home, the person\'s key folders and app data', async () => {
  const w = await world();
  const allowAll = [rule({ kind: 'path', ops: 'reads', pattern: '**', effect: 'allow' })];
  for (const mode of ['ask', 'accept', 'auto', 'plan']) {
    const b = bridgeFor(w, { mode, rules: allowAll, answer: true });
    for (const p of [join(w.data, 'secret.json'), join(w.data, 'engines', 'claude-code', 'x'), join(w.home, '.ssh', 'id'), join(w.home, '.claude', 'settings.json'), join(w.base, 'AppData', 'Roaming', 'x'), join(w.base, 'AppData', 'Local', 'BunnyAI', 'y')]) {
      for (const tool of ['Read', 'Write', 'Edit']) {
        const r = await b.claude({ tool, input: { file_path: p } });
        assert.equal(r.allow, false, `${mode} ${tool} ${p}`);
      }
    }
    // a command that names the private folder
    assert.equal((await b.claude({ tool: 'Bash', input: { command: `type ${join(w.data, 'secret.json')}` } })).allow, false, `${mode} command naming the data folder`);
  }
});

test('outside the workspace: a read is an Ask in EVERY mode, Auto included (and "no" is a refusal); a write is refused', async () => {
  const w = await world();
  for (const mode of ['ask', 'accept', 'auto', 'plan']) {
    const asks = [];
    const b = bridgeFor(w, { mode, answer: true, asks });
    const read = await b.claude({ tool: 'Read', input: { file_path: join(w.other, 'o.txt') } });
    assert.equal(read.allow, true, mode); assert.equal(asks.length, 1, `${mode}: asked`); assert.match(asks[0].detail, /outside the workspace folder/);
    const no = await bridgeFor(w, { mode, answer: false }).claude({ tool: 'Read', input: { file_path: join(w.other, 'o.txt') } });
    assert.equal(no.allow, false, `${mode}: no`);
    const write = await b.claude({ tool: 'Write', input: { file_path: join(w.other, 'new.txt'), content: 'x' } });
    assert.equal(write.allow, false, `${mode}: a write outside is refused`);
    assert.match(write.reason, mode === 'plan' ? /Plan mode is read-only/ : /outside the workspace/);
  }
});

test('paths are canonicalised: "..", mixed case, and a junction out of the folder are judged by where they really lead', async () => {
  const w = await world();
  const asks = [];
  const b = bridgeFor(w, { mode: 'auto', answer: false, asks });
  // ".." that leaves the folder
  assert.equal((await b.claude({ tool: 'Read', input: { file_path: join(w.root, '..', 'elsewhere', 'o.txt') } })).allow, false);
  assert.equal(asks.length, 1, 'treated as outside: asked');
  // a path through "src/../a.txt" is inside
  const inside = await bridgeFor(w, { mode: 'auto' }).claude({ tool: 'Read', input: { file_path: join(w.root, 'src', '..', 'a.txt') } });
  assert.equal(inside.allow, true);
  // a deny rule on "a.txt" applies to the same file spelled differently, and in another case
  const denyA = [rule({ kind: 'path', ops: 'reads', pattern: 'a.txt', effect: 'deny' })];
  for (const spelled of [join(w.root, 'src', '..', 'a.txt'), join(w.root, 'a.txt').toUpperCase().replace(/^[A-Z]:/, (m) => m.toLowerCase())]) {
    assert.equal((await bridgeFor(w, { mode: 'auto', rules: denyA }).claude({ tool: 'Read', input: { file_path: spelled } })).allow, false, spelled);
  }
  // a junction inside the folder that leads to the data folder
  try {
    await symlink(w.data, join(w.root, 'link'), 'junction');
    const r = await bridgeFor(w, { mode: 'auto', answer: true }).claude({ tool: 'Read', input: { file_path: join(w.root, 'link', 'secret.json') } });
    assert.equal(r.allow, false, 'a junction to the data folder is no way in');
    assert.match(r.reason, /keeps private/);
    await symlink(w.other, join(w.root, 'out'), 'junction');
    const asks2 = [];
    const o = await bridgeFor(w, { mode: 'auto', answer: false, asks: asks2 }).claude({ tool: 'Read', input: { file_path: join(w.root, 'out', 'o.txt') } });
    assert.equal(o.allow, false); assert.equal(asks2.length, 1, 'a junction out of the folder counts as outside');
  } catch (err) { if (!/EPERM|EACCES|ENOSYS/.test(String(err?.code))) throw err; }
  assert.deepEqual((await placeOf('a\0b', w.root)), { unresolved: true });
});

test('an unknown tool (MCP, subagent, WebFetch, a new tool) is judged as a command: Ask in Ask and Accept-edits... see the table; refused in Plan; unreadable input is refused', async () => {
  const w = await world();
  for (const tool of ['mcp__x__do', 'Agent', 'Task', 'WebFetch', 'SomethingNew']) {
    const mapped = mapClaudeCall(tool, { anything: 1 });
    assert.deepEqual([mapped.name, mapped.unknown], ['run_command', true], tool);
    const asks = []; const ask = await bridgeFor(w, { mode: 'ask', asks }).claude({ tool, input: { a: 1 } });
    assert.equal(ask.allow, true); assert.equal(asks.length, 1, `${tool} asks in Ask mode`);
    assert.equal((await bridgeFor(w, { mode: 'plan' }).claude({ tool, input: {} })).allow, false, `${tool} refused in Plan`);
    const acc = []; await bridgeFor(w, { mode: 'accept', asks: acc }).claude({ tool, input: {} }); assert.equal(acc.length, 1, `${tool} asks in Accept edits (it is a command)`);
    const auto = []; await bridgeFor(w, { mode: 'auto', asks: auto }).claude({ tool, input: {} }); assert.equal(auto.length, 0, `${tool} does not ask in Auto`);
  }
  for (const bad of [{ tool: 'Read', input: null }, { tool: 'Read', input: {} }, { tool: 'Read', input: { file_path: 12 } }, { tool: 'Bash', input: { command: '' } }, { tool: 'Bash', input: [] }, { tool: 'Write', input: 'x' }]) {
    const r = await bridgeFor(w, { mode: 'auto' }).claude(bad);
    assert.equal(r.allow, false, JSON.stringify(bad));
  }
});

test('no answer means no: a question that never resolves to true, or that throws, is a refusal; the bridge never throws', async () => {
  const w = await world();
  const throwing = createBridge({ mode: 'ask', rules: [], root: w.root, protect: [w.data], keyFolders: [], ask: async () => { throw new Error('window closed'); } });
  const r = await throwing.claude({ tool: 'Bash', input: { command: 'echo hi' } });
  assert.equal(r.allow, false);
  const odd = createBridge({ mode: 'ask', rules: [], root: w.root, protect: [], keyFolders: [], ask: async () => 'yes' }); // only a real true counts
  assert.equal((await odd.claude({ tool: 'Bash', input: { command: 'echo hi' } })).allow, false);
  const broken = createBridge({ mode: 'ask', rules: () => { throw new Error('boom'); }, root: w.root, protect: [], keyFolders: [], ask: async () => true });
  const b = await broken.claude({ tool: 'Bash', input: { command: 'echo hi' } });
  assert.equal(b.allow, false); assert.match(b.reason, /could not judge/);
});

test('no decision is remembered: the same call asks again, and a changed rule applies at once', async () => {
  const w = await world();
  const asks = [];
  let rules = [];
  const b = createBridge({ mode: 'ask', rules: () => rules, root: w.root, protect: [], keyFolders: [], ask: async (s) => { asks.push(s); return true; } });
  const call = { tool: 'Bash', input: { command: 'git push' } };
  await b.claude(call); await b.claude(call);
  assert.equal(asks.length, 2);
  rules = [rule({ kind: 'command', pattern: 'git push*', effect: 'deny' })];
  assert.equal((await b.claude(call)).allow, false);
});

test('Codex: a command is judged on its text; a file change is judged per path (add and delete are writes, update and move are edits, a move names both paths); outside, protected or unreadable is refused', async () => {
  const w = await world();
  const b = bridgeFor(w, { mode: 'auto', answer: true });
  assert.equal((await b.codexCommand({ command: 'ls' })).allow, true);
  assert.equal((await b.codexCommand({ command: null })).allow, false);
  assert.equal((await b.codexCommand({})).allow, false);
  assert.deepEqual(mapCodexCommand({ command: 'ls' }), { name: 'run_command', command: 'ls', engineTool: 'commandExecution' });
  const ok = await b.codexChanges([{ path: join(w.root, 'new.txt'), kind: { type: 'add' }, diff: '' }, { path: join(w.root, 'a.txt'), kind: { type: 'update', move_path: null }, diff: '' }]);
  assert.equal(ok.allow, true);
  assert.equal((await b.codexChanges([{ path: join(w.root, 'new.txt'), kind: { type: 'add' } }, { path: join(w.other, 'x.txt'), kind: { type: 'add' } }])).allow, false, 'one bad path refuses the whole change');
  assert.equal((await b.codexChanges([{ path: join(w.data, 'secret.json'), kind: { type: 'update', move_path: null } }])).allow, false);
  assert.equal((await b.codexChanges([{ path: join(w.root, 'a.txt'), kind: { type: 'update', move_path: join(w.other, 'moved.txt') } }])).allow, false, 'a move out of the folder');
  assert.equal((await b.codexChanges([{ path: join(w.root, 'a.txt'), kind: { type: 'delete' } }])).allow, true);
  for (const bad of [undefined, [], [{}], [{ path: 5, kind: { type: 'add' } }], [{ path: join(w.root, 'x'), kind: { type: 'chmod' } }]]) assert.equal((await b.codexChanges(bad)).allow, false, JSON.stringify(bad));
  assert.deepEqual(mapCodexChanges([{ path: 'a', kind: { type: 'update', move_path: 'b' } }]).map((c) => [c.name, c.path]), [['edit_file', 'a'], ['write_file', 'b']]);
  assert.equal((await bridgeFor(w, { mode: 'plan' }).codexChanges([{ path: join(w.root, 'n.txt'), kind: { type: 'add' } }])).allow, false, 'Plan mode keeps nothing');
  const rules = rulesFor({ global: [rule({ kind: 'path', ops: 'edits', pattern: 'src/**', effect: 'deny' })], folders: {} }, w.root);
  assert.equal((await bridgeFor(w, { mode: 'auto', rules }).codexChanges([{ path: join(w.root, 'src', 'b.js'), kind: { type: 'update', move_path: null } }])).allow, false, 'a deny rule applies to a Codex patch');
});

test('keyFolders lists the private folders of the person (CE-1.6)', () => {
  const list = keyFolders({ home: 'C:\\Users\\p', appData: 'C:\\Users\\p\\AppData\\Roaming', localAppData: 'C:\\Users\\p\\AppData\\Local' }).map((p) => p.replace(/\\/g, '/'));
  for (const want of ['.claude', '.codex', '.cline', '.aider', '.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker', '.config/gh']) assert.ok(list.some((p) => p.endsWith(`/${want}`)), want);
  assert.ok(list.includes('C:/Users/p/AppData/Roaming') && list.includes('C:/Users/p/AppData/Local'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bunnyText, SKILL_NAMING_NOTE } from '../src/server/bunnyText.js';
import { createSkillStore } from '../src/server/skills.js';
import { createAppTools, appToolDefinitions } from '../src/server/appTools.js';
import { readGithubPlugin, searchPlugins } from '../src/server/pluginImport.js';

// BRAND-BUNNY (v0.1.14; the owner: "...they are all supposed to be bunny and function for bunny properly"). A skill, command or plugin written for another app is imported as it is
// and said in Bunny's words when it is read: the assistant is Bunny, the instructions file is Bunny's instructions, the places it names are Customize in Settings.

test('bunnyText: in prose the assistant is Bunny; CLAUDE.md, SKILL.md and the other app\'s folders are said in Bunny\'s words', () => {
  const said = bunnyText('You are Claude, running in Claude Code. Claude should keep notes in CLAUDE.md. Save this skill as SKILL.md under ~/.claude/skills/tidy or .claude/commands/tidy.md.');
  assert.doesNotMatch(said, /claude|SKILL\.md/i, said);
  assert.match(said, /You are Bunny, running in Bunny\./);
  assert.match(said, /Bunny should keep notes in Bunny's instructions\./);
  assert.match(said, /Bunny's Customize \(Settings\)/);
  assert.equal(bunnyText('Nothing to change here.'), 'Nothing to change here.');
  assert.equal(bunnyText(null), '');
});

test('BB-1: code is never rewritten (fenced blocks and inline code keep their commands and names); $ARGUMENTS and ${CLAUDE_PLUGIN_ROOT} stay where they stand and one fixed note explains them', () => {
  const fenced = '```sh\nrm -rf build/$ARGUMENTS\n```';
  const inline = 'Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/fix.js` first.';
  const sample = '```js\nconst Claude = require("x"); Claude.run();\n```';
  const out = (t) => bunnyText(t).split('\n\n').slice(1).join('\n\n') || bunnyText(t); // what follows the note, if there is one
  assert.ok(bunnyText(fenced).endsWith(fenced), bunnyText(fenced));
  assert.match(bunnyText(fenced), /^In this skill \$ARGUMENTS stands for what the person typed after the command\./);
  assert.doesNotMatch(bunnyText(fenced).split('\n\n').slice(1).join(''), /what the person typed/);
  assert.ok(bunnyText(inline).endsWith(inline), bunnyText(inline));
  assert.match(bunnyText(inline), /^In this skill \$\{CLAUDE_PLUGIN_ROOT\} is the plugin's own folder, which Bunny does not provide\./);
  assert.equal(bunnyText(sample), sample); // Claude.run() stays Claude.run()
  assert.equal(out('Nothing here.'), 'Nothing here.');
  // prose around code is still said in Bunny's words, the code inside it is not
  assert.equal(bunnyText('Claude, run `Claude.run()` now.'), 'Bunny, run `Claude.run()` now.');
  // both tokens: both notes, in a fixed order
  assert.match(bunnyText('Use $ARGUMENTS with ${CLAUDE_PLUGIN_ROOT}/x'), /^In this skill \$ARGUMENTS stands for[^\n]*In this skill \$\{CLAUDE_PLUGIN_ROOT\} is the plugin's own folder[^\n]*\n\nUse \$ARGUMENTS with \$\{CLAUDE_PLUGIN_ROOT\}\/x$/);
});

test('BB-2: a NUL character in a skill is dropped, so it can never pass for one of the rewrite\'s own placeholders', () => {
  const said = bunnyText('Visit https://example.com/a and \u00000\u0000 and \u00009\u0000. Claude rocks.');
  assert.equal(said, 'Visit https://example.com/a and 0 and 9. Bunny rocks.');
  assert.ok(!said.includes('\u0000'));
});

test('BB-3: an address with no scheme is kept like one with a scheme', () => {
  for (const text of ['See github.com/acme/Claude/tree/main for it.', 'Raw: raw.githubusercontent.com/acme/Claude/main/SKILL.md', 'Docs at docs.claude.com/en/x']) assert.equal(bunnyText(text), text);
});

test('bunnyText never touches a model id, a model\'s own name, a web address or a domain', () => {
  const keep = [
    'Use claude-sonnet-4 or claude-3-5-haiku-latest for this.',
    'Claude 3.5 Sonnet and Claude Opus 4 are models of that company.',
    'See https://github.com/someone/claude-skills and https://docs.claude.com/en/docs/overview?x=1 for details.',
    'Models: anthropic/claude-opus-4, platform.claude.com/docs, console.anthropic.com.',
    'The manifest is .claude-plugin/plugin.json.',
    'Run `claude mcp add` in a terminal.',
  ];
  for (const text of keep) assert.equal(bunnyText(text), text);
  // mixed: the model id and address survive while the assistant's name changes
  assert.equal(bunnyText('Claude says: ask claude-sonnet-4 at https://github.com/anthropics/claude-code'), 'Bunny says: ask claude-sonnet-4 at https://github.com/anthropics/claude-code');
});

/** A stand-in GitHub holding one plugin repository, in the layout other apps use. */
function fakeGithub(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) return new Response(JSON.stringify({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }), { status: 200 });
    const m = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/(.*)$/.exec(url);
    if (m && files[m[1]] !== undefined) return new Response(files[m[1]], { status: 200 });
    if (url.includes('api.github.com/search/repositories')) return new Response(JSON.stringify({ items: [{ full_name: 'someone/claude-skills', stargazers_count: 9, description: 'Skills for Claude Code that keep CLAUDE.md tidy' }] }), { status: 200 });
    if (url.includes('registry.modelcontextprotocol.io')) return new Response(JSON.stringify({ servers: [] }), { status: 200 });
    return new Response('not found', { status: 404 });
  };
}
const REPO = {
  '.claude-plugin/plugin.json': JSON.stringify({ name: 'tidy-desk', description: 'A Claude Code plugin that tidies a desk', version: '1.0.0' }),
  'skills/tidy/SKILL.md': '---\nname: tidy\ndescription: Tidy a desk, as Claude does it\n---\nYou are Claude. Put new notes in ~/.claude/notes and read CLAUDE.md first. Use https://github.com/someone/claude-skills for ideas.',
  'skills/tidy/references/rules.md': 'Claude should keep the desk clear.',
  'commands/sweep.md': '---\ndescription: Sweep the desk\n---\nSweep the desk for: $ARGUMENTS',
  'agents/helper.md': '---\ndescription: A desk helper\n---\nYou are a Claude agent that helps with the desk.',
  'CLAUDE.md': 'Project rules: Claude must be polite.',
  'hooks/hooks.json': '{}',
  'scripts/run.sh': 'echo hi',
  '.mcp.json': JSON.stringify({ mcpServers: { weather: { url: 'https://weather.example.com/mcp' } } }),
};

test('a plugin written for another app is installed on an invented profile and used: its text is Bunny\'s when read, its original is kept, hooks and scripts are said plainly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bunny-brand-'));
  const skills = createSkillStore({ file: join(dir, 'skills.json') });
  let settings = {};
  const connectors = [];
  const tools = createAppTools({
    skills,
    mcp: { add: async (c) => { connectors.push(c); return { id: `c${connectors.length}`, name: c.name }; } },
    getSettings: () => settings,
    saveSettings: async (patch) => { settings = { ...settings, ...patch }; return settings; },
    fetchImpl: fakeGithub(REPO),
  });
  const installed = await tools.run('install_plugin', { url: 'https://github.com/someone/tidy-desk' });
  assert.match(installed, /Installed tidy-desk: 4 skill\(s\) \[tidy, tidy-desk:instructions, tidy-desk:sweep, agent:tidy-desk:helper\]/);
  assert.match(installed, /Not imported: hooks and scripts made for other apps\. They don't run in Bunny yet/);
  assert.doesNotMatch(installed, /SKILL\.md|\.mcp\.json|hooks file/);

  // switched on by the person, then used: what the model is handed and what read_skill returns
  for (const s of await skills.list()) await skills.update(s.id, { enabled: true });
  const context = await skills.context();
  assert.ok(context.includes(SKILL_NAMING_NOTE));
  assert.doesNotMatch(context.replace(/https:\/\/\S+/g, ''), /claude/i, context);
  const read = await tools.run('read_skill', { name: 'tidy' }, {});
  assert.match(read, /You are Bunny\. Put new notes in Bunny's Customize \(Settings\)/);
  assert.match(read, /read Bunny's instructions first/);
  assert.match(read, /Reference: rules/);
  assert.match(read, /Bunny should keep the desk clear\./);
  assert.ok(read.includes('https://github.com/someone/claude-skills'), 'a web address is left as it is');
  const command = await tools.run('read_skill', { name: 'tidy-desk:sweep' }, {});
  assert.match(command, /^In this skill \$ARGUMENTS stands for what the person typed after the command\.\n\n[\s\S]*Sweep the desk for: \$ARGUMENTS/); // not replaced where it stands: a note says what it means
  const brief = await tools.run('read_skill', { name: 'agent:tidy-desk:helper' }, {});
  assert.match(brief, /You are a Bunny agent that helps with the desk\./);
  const rules = await tools.run('read_skill', { name: 'tidy-desk:instructions' }, {});
  assert.match(rules, /Project rules: Bunny must be polite\./);

  // the stored original is untouched
  const stored = JSON.parse(await readFile(join(dir, 'skills.json'), 'utf8'));
  assert.match(stored.find((s) => s.name === 'tidy').instructions, /You are Claude\. Put new notes in ~\/\.claude\/notes and read CLAUDE\.md first\./);
  assert.ok((await readdir(dir)).includes('skills.json'));
});

test('what the person is shown before installing, and what the search returns, is said in Bunny\'s words', async () => {
  const preview = await createAppTools({ skills: {}, mcp: {}, getSettings: () => ({}), saveSettings: async () => ({}), fetchImpl: fakeGithub(REPO) }).previewPlugin('https://github.com/someone/tidy-desk');
  assert.match(preview, /Plugin tidy-desk: A Bunny plugin that tidies a desk/);
  assert.match(preview, /Skill tidy \(\d+ characters of instructions\): Tidy a desk, as Bunny does it/);
  assert.doesNotMatch(preview, /claude/i, preview);
  const found = await searchPlugins('tidy desk', { fetchImpl: fakeGithub(REPO) });
  assert.match(found, /someone\/claude-skills \(★9\) https:\/\/github\.com\/someone\/claude-skills — Skills for Bunny that keep Bunny's instructions tidy/);
  assert.match(found, /may mention another app, its skills still work in Bunny/);
  const plugin = await readGithubPlugin('https://github.com/someone/tidy-desk', { fetchImpl: fakeGithub(REPO) });
  assert.ok(plugin.skipped.some((s) => /^hooks and scripts made for other apps\. They don't run in Bunny yet$/.test(s)), plugin.skipped.join(' | '));
});

test('Bunny\'s own strings never say Claude or name a raw file format: tool descriptions, the install result and errors, the Customize help', async () => {
  const defs = JSON.stringify(appToolDefinitions(['read', 'edit', 'build']));
  assert.doesNotMatch(defs, /claude|SKILL\.md|CLAUDE\.md/i, 'the model-facing tool descriptions');
  assert.doesNotMatch(SKILL_NAMING_NOTE, /claude/i);
  await assert.rejects(readGithubPlugin('https://github.com/bunny/empty', { fetchImpl: fakeGithub({ 'README.md': 'hi' }) }), (err) => { assert.doesNotMatch(err.message, /claude|SKILL\.md|\.mcp\.json/i); assert.match(err.message, /no skills or remote connectors Bunny can use/); return true; });
  const customize = await readFile(new URL('../src/ui/customize.html', import.meta.url), 'utf8');
  const help = /<span class="field-help">(Skills \([^<]*)<\/span>/.exec(customize)?.[1] ?? '';
  assert.match(help, /don't run in Bunny yet/);
  assert.doesNotMatch(help, /SKILL\.md|\.mcp\.json|claude/i);
});

test('the skills list the Customize page shows carries a description in Bunny\'s words (shownDescription) and keeps the stored one', async (t) => {
  const { startApp } = await import('./helpers.js');
  const { base } = await startApp(t);
  const made = await fetch(`${base}/api/skills`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'tidy', description: 'Works like Claude Code, see CLAUDE.md', instructions: 'Keep it tidy.' }) });
  assert.equal(made.status, 200);
  const list = await (await fetch(`${base}/api/skills`)).json();
  assert.equal(list[0].description, 'Works like Claude Code, see CLAUDE.md');
  assert.equal(list[0].shownDescription, "Works like Bunny, see Bunny's instructions");
});

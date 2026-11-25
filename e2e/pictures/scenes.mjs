// PICTURE-CHECK: the scenes. One per help picture (docs/images/pictures.json names it). A scene brings the INVENTED profile to the screen the picture shows, through the API where it can
// (seeded chats and settings), so every run draws the same screen. What is fixed for every scene (see begin() in e2e/pictures.spec.js): the profile name Sam, the clock (2026-01-15 14:12),
// the bundled interface and reply fonts, reduced motion, the theme and size from the manifest entry. A scene may add only what its own screen needs.
//
// A scene is `async (page, api, entry) => {}` where api = { request, base, seed, open }:
//   api.request        Playwright's request fixture (the e2e server, token already sent)
//   api.seed(chat)     create a chat with messages (and, for helpers, a parent): returns the chat
//   api.open(url)      go to a page of the app and wait for the fonts
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { heldProvider } from './held-provider.mjs';

export const FIXED_TIME = '2026-01-15T14:12:00';
const AT = (minute) => `2026-01-15T14:${String(minute).padStart(2, '0')}:00.000Z`;
export { AT };

const user = (text, minute) => ({ role: 'user', content: text, at: AT(minute) });
const assistant = (text, minute, extra = {}) => ({ role: 'assistant', content: text, model: 'Auto', at: AT(minute), ...extra });
const step = (tool, minute, extra = {}) => ({ role: 'assistant', kind: 'tool_call', tool, status: 'done', content: '', at: AT(minute), ...extra });

/** A chat page with one seeded chat open and the connected-provider look (a model chip that says Auto). */
async function chat(page, api, seed) {
  await api.request.post('/api/providers/anthropic/connect', { data: { apiKey: 'sk-test-000000000000' } });
  const made = await api.seed(seed);
  await api.open(`/?s=${made.id}`);
  await page.waitForSelector('.msg');
  return made;
}

/**
 * A LIVE screen: the model stand-in (e2e/pictures/held-provider.mjs) plays `steps` for a real request from the page, so the app draws exactly what it draws for a person, and the stream is held
 * at the point the picture shows. The stand-in is connected as a custom provider and removed when the scene is over.
 */
async function live(api, steps) {
  const provider = await heldProvider(steps);
  const made = await api.request.post('/api/providers/custom', { data: { name: 'Picture model', baseUrl: provider.url } });
  if (!made.ok()) throw new Error(`the stand-in provider was not accepted: ${await made.text()}`);
  api.cleanup(async () => { await api.request.delete('/api/providers/custom-picture-model').catch(() => {}); await provider.close(); });
  return provider;
}

/** The folder every invented project lives under: a fixed place that does not depend on the user name or on TEMP (a picture draws the folder's path), the system drive's root. */
const PICTURE_ROOT = join(`${process.env.SystemDrive ?? 'C:'}${sep}`, 'bunny-pictures');

/** An invented project folder with a fixed path (so the page shows the same words on every PC), made again each time. */
function project(name, files) {
  const root = join(PICTURE_ROOT, name);
  // a fixed folder at the drive's root could have been made beforehand (or be a link) by someone else on this PC: never write or delete through a link
  for (const dir of [PICTURE_ROOT, root]) { try { if (lstatSync(dir).isSymbolicLink()) throw new Error(`${dir} is a link: remove it before drawing the pictures`); } catch (err) { if (err?.code !== 'ENOENT') throw err; } }
  rmSync(root, { recursive: true, force: true });
  for (const [rel, text] of Object.entries(files)) { const f = join(root, rel); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, text); }
  return root;
}

/** Send a message from the page, as a person does. */
async function ask(page, text) {
  await page.locator('#input').fill(text);
  await page.locator('#send').click();
}

/** A Code chat in an invented project, on Auto, ready to send. */
async function codeChat(page, api, name, files, title, extra = {}) {
  const folder = project(name, files);
  await api.request.put('/api/settings', { data: { autoJudgeEnabled: false } }); // these pictures show Auto running on its own; the check (on by default) would put a card in the way. begin() resets the profile for the next scene.
  await api.request.post('/api/folder/check', { data: { folder } });
  const made = await api.seed({ title, workMode: 'code', folder, permissionMode: 'auto', ...extra });
  await page.addInitScript(() => { try { localStorage.setItem('bunny.workMode', 'code'); } catch { /* storage blocked */ } });
  await api.open(`/?s=${made.id}`);
  await page.waitForSelector('#input');
  return { id: made.id, folder };
}

const NOTES_APP = {
  'src/add.js': 'export const add = (a, b) => a - b;\n',
  'test.js': "import { add } from './src/add.js';\nif (add(2, 3) !== 5) { console.log(`FAIL: add(2, 3) returned ${add(2, 3)}`); process.exit(1); }\nconsole.log('ok: 1 test passed');\n",
  'package.json': '{ "name": "notes-app", "type": "module" }\n',
};

/** A long invented script, so the same lines fold the same way every time. */
const script = (lines) => Array.from({ length: lines }, (_, i) => (i === 0 ? '#!/usr/bin/env python3' : i % 20 === 1 ? `# --- part ${Math.ceil(i / 20)} ---` : `step_${i} = backup_notes("notes/folder_${i % 7}", keep=${(i % 5) + 1})`)).join('\n');

/** An invented project that is also a git folder (so Smart may offer Auto there). */
function gitProject(name, files) {
  const root = project(name, files);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  return root;
}

const RULES = { 'AGENTS.md': 'Use tabs.\nSay hello.\n', 'CLAUDE.md': 'A different rule.\n', 'src/add.js': 'export const add = (a, b) => a + b;\n' };

/** A Code chat with a few seeded messages in an invented folder, on the chosen mode, opened; nothing sent. */
async function codeChatWith(page, api, folder, { mode = 'ask', title = 'Instructions' } = {}) {
  await api.request.post('/api/folder/check', { data: { folder } });
  const made = await api.seed({ title, workMode: 'code', folder, permissionMode: mode, messages: [user('What does this project do?', 10), assistant('It adds two numbers. The one function is in src/add.js.', 11)] });
  await page.addInitScript(() => { try { localStorage.setItem('bunny.workMode', 'code'); } catch { /* storage blocked */ } });
  await api.open(`/?s=${made.id}`);
  await page.waitForSelector('.msg');
  return made;
}

/** The stand-in Codex CLI downloaded, so the engine chip shows; taken away again when the scene is over. */
async function withEngines(api) {
  await api.request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true, folderRulesEnabled: true, folderRulesTrusted: [] } });
  await api.request.post('/api/engines/codex/download', { data: {} });
  for (let i = 0; i < 60; i += 1) { if ((await (await api.request.get('/api/engines')).json()).engines.find((e) => e.id === 'codex')?.downloaded) break; await new Promise((r) => setTimeout(r, 250)); }
  api.cleanup(async () => { await api.request.delete('/api/engines/codex').catch(() => {}); await api.request.put('/api/settings', { data: { engine: 'bunny', useBunnyEngine: true, folderRulesTrusted: [] } }).catch(() => {}); });
}

/** The scenes by name. */
export const scenes = {
  'settings-wait': async (page, api) => {
    await api.open('/src/ui/settings.html');
    await page.waitForSelector('#wait-select');
    await page.locator('.group:has(#wait-row)').scrollIntoViewIfNeeded();
  },

  providers: async (page, api) => {
    await api.open('/src/ui/providers.html');
    await page.waitForSelector('#available .row');
  },

  'custom-provider': async (page, api) => {
    await api.open('/src/ui/providers.html');
    await page.waitForSelector('#custom-form');
    await page.locator('#custom-form').scrollIntoViewIfNeeded();
    await page.locator('#custom-name').fill('Company gateway');
    await page.locator('#custom-url').fill('http://localhost:8000/v1');
  },

  'sign-in': async (page, api) => {
    await api.open('/src/ui/settings.html?section=profile');
    await page.getByText('GitHub', { exact: true }).first().waitFor({ timeout: 10_000 });
    await page.getByText('GitHub', { exact: true }).first().scrollIntoViewIfNeeded();
  },

  'permission-rules': async (page, api) => {
    await api.request.put('/api/permission-rules', { data: { global: [
      { id: 'r_deny_force', kind: 'command', pattern: 'git push --force*', effect: 'deny' },
      { id: 'r_deny_secrets', kind: 'path', pattern: 'secrets/**', effect: 'deny', ops: 'edits' },
      { id: 'r_ask_push', kind: 'command', pattern: 'git push*', effect: 'ask' },
      { id: 'r_allow_test', kind: 'command', pattern: 'npm test*', effect: 'allow' },
      { id: 'r_allow_lint', kind: 'command', pattern: 'npm run lint*', effect: 'allow' },
    ], folders: {} } });
    await api.open('/src/ui/settings.html?section=permissions'); // after the Settings overhaul the rules live in Permissions, not Code
    await page.waitForSelector('section[data-section="permissions"] #perm-rules');
    await page.locator('#perm-rules').scrollIntoViewIfNeeded();
  },

  'folded-code': async (page, api) => {
    await chat(page, api, { title: 'Back up my notes', workMode: 'chat', messages: [
      user('Write me a script that backs up my notes folders', 10),
      assistant(`Here is the whole script. It is long, so Bunny folds it:\n\n\`\`\`python\n${script(253)}\n\`\`\`\n\nRun it from the folder that holds your notes.`, 11),
    ] });
    await page.waitForSelector('pre.is-foldable');
  },

  helpers: async (page, api) => {
    const parent = await chat(page, api, { title: 'Review the notes app', workMode: 'chat', messages: [
      user('Have two helpers review the code and write a product blurb, then combine what they found.', 8),
      step('Helper: Code reviewer', 9),
      step('Helper: Copywriter', 9),
      assistant('Both helpers are done. The reviewer found two small bugs in the sync code and the copywriter wrote a three-line blurb. Their chats are nested under this one in the sidebar.', 12),
    ] });
    for (const [title, text, minute] of [['Helper: Code reviewer', 'Two small bugs in the sync code: a missing await and a wrong date format.', 10], ['Helper: Copywriter', 'Notes that find themselves. A calm place for everything you want to remember.', 11]]) {
      await api.seed({ title, workMode: 'chat', parentId: parent.id, agent: 'helper', agentStatus: 'done', messages: [user(`Task: ${title}`, minute), assistant(text, minute + 1)] });
    }
    await api.open(`/?s=${parent.id}`);
    await page.waitForSelector('.msg');
  },

  'plan-undo': async (page, api) => {
    await chat(page, api, { title: 'Fix the failing sync test', workMode: 'chat', messages: [
      user('The sync test fails. Fix it and keep going until the tests pass.', 5),
      step('Read src/sync.js', 6),
      step('Edit src/sync.js', 7),
      step('Run npm test', 8, { result: '12 passed' }),
      assistant('The test passed after I awaited the save call.\n\nI changed one file: `src/sync.js`.', 9, {
        tasks: [{ text: 'Read the failing test', done: true }, { text: 'Find the missing await', done: true }, { text: 'Fix src/sync.js', done: true }, { text: 'Run the tests', done: true }],
        checkpoint: { id: 'cp-picture', files: 1 },
      }),
    ] });
    await page.waitForSelector('.undo-bar');
  },

  artifact: async (page, api) => {
    const made = await (await api.request.post('/api/artifacts', { data: { title: 'Carrot Tasks', kind: 'html', content: '<!doctype html><html><body style="margin:0;font-family:sans-serif;background:#fff3e6;text-align:center;padding:48px"><h1 style="color:#e8590c">Carrot Tasks</h1><p>Stay rooted, get things done!</p><div style="display:flex;gap:12px;justify-content:center"><b>0 total</b><b>0 active</b><b>0 done</b></div></body></html>' } })).json();
    await chat(page, api, { title: 'Make me a cheerful carrot to-do app', workMode: 'chat', messages: [
      user('Make me a cheerful carrot-themed to-do app.', 1),
      step('Create artifact: Carrot Tasks', 2, { artifact: { id: made.id, title: 'Carrot Tasks', kind: 'html' } }),
      assistant('I made **Carrot Tasks** and opened it beside the chat.\n\n- Add a task with the plus button\n- Mark a task done with a click\n- Filter by All, Active or Completed', 3),
    ] });
    await page.locator('.artifact-card').first().getByText('Open', { exact: true }).click();
    await page.locator('iframe.artifact-frame').first().waitFor({ state: 'visible' }); // the artifact opens beside the chat
    await page.waitForTimeout(600); // the page inside the frame draws itself
  },

  'working-line': async (page, api) => {
    await live(api, [{ think: 'The person wants two days in Lisbon. Day one: the old town in the morning, a tram to the castle, fish for dinner. Day two: Belem, then the river.' }]);
    await api.open('/');
    await ask(page, 'Plan a two-day trip to Lisbon.');
    const line = page.locator('.bunny-working .bunny-line:not([disabled])');
    await line.waitFor();
    await page.clock.setFixedTime(new Date(new Date(FIXED_TIME).getTime() + 1000)); // one second of thinking
    await page.waitForFunction(() => /1s/.test(document.querySelector('.bunny-time')?.textContent ?? ''));
    await line.click(); // opened to show the thinking
    await page.locator('.bunny-thinking').waitFor({ state: 'visible' });
  },

  capability: async (page, api) => {
    await live(api, [{ tool: ['request_capability', { capability: 'code_mode', reason: 'I need to read the project folder to see what the tests expect.' }] }]);
    await api.open('/');
    await ask(page, 'Why is my sync test failing?');
    await page.locator('.capability-card, .cap-card, [data-capability]').first().waitFor({ timeout: 10_000 });
  },

  'blocked-asked': async (page, api) => {
    await api.request.put('/api/permission-rules', { data: { global: [
      { id: 'r_deny_force', kind: 'command', pattern: 'git push --force*', effect: 'deny' },
      { id: 'r_ask_push', kind: 'command', pattern: 'git push*', effect: 'ask' },
    ], folders: {} } });
    api.cleanup(() => api.request.put('/api/permission-rules', { data: { global: [], folders: {} } }));
    await live(api, [{ tool: ['run_command', { command: 'git push --force origin main' }] }, { tool: ['run_command', { command: 'git push origin main' }] }]);
    await codeChat(page, api, 'notes-app', NOTES_APP, 'Publish the fix');
    await ask(page, 'Publish the fix to main.');
    await page.getByText(/Asked because of your rule/).first().waitFor({ timeout: 10_000 });
  },

  'keep-going': async (page, api) => {
    const read = (path) => ({ tool: ['read_file', { path }] });
    const run = (command) => ({ tool: ['run_command', { command }] });
    const tasks = (done) => ({ tool: ['update_tasks', { tasks: ['Read the failing test', 'Find the cause', 'Fix src/add.js', 'Run the tests again'].map((text, i) => ({ text, done: i < done })) }] });
    await live(api, [tasks(0), { tool: ['list_files', {}] }, read('test.js'), run('node test.js'), tasks(1), read('src/add.js'), tasks(2), { tool: ['edit_file', { path: 'src/add.js', old_text: 'a - b', new_text: 'a + b' }] }, tasks(3), run('node test.js'), tasks(4), run('node test.js'), { say: 'All four steps are done. Running the whole suite one more time.' }]);
    await codeChat(page, api, 'notes-app', NOTES_APP, 'Fix the failing test', { effort: 'low' }); // a low effort allows 12 steps: the 13th says "Still working"
    await ask(page, 'The test fails. Fix it and keep going until it passes.');
    await page.locator('#status').filter({ hasText: 'Still working · step 13' }).waitFor({ timeout: 90_000 }); // an event wait: it returns the moment the line shows; the long limit is only for a busy PC
  },

  terminal: async (page, api) => {
    const server = "console.log('Preview server ready: http://localhost:5173/'); for (let i = 0; i < 3; i++) console.log('GET / 200'); setInterval(() => {}, 60000); // the same lines every run\n";
    await live(api, [{ tool: ['start_process', { command: 'node server.js' }] }, { say: 'The preview server is running. Open http://localhost:5173/ to see the page.' }]);
    const { id } = await codeChat(page, api, 'notes-preview', { 'server.js': server, 'package.json': '{ "name": "notes-preview" }\n' }, 'Start the preview');
    api.cleanup(async () => { for (const p of await (await api.request.get('/api/processes')).json()) await api.request.post(`/api/processes/${p.id}/stop`).catch(() => {}); });
    await ask(page, 'Start a preview server for me.');
    await page.getByText('The preview server is running.').first().waitFor({ timeout: 10_000 });
    await page.locator('[aria-label*="Terminal"], #toggle-terminal, button[title*="Terminal"]').first().click();
    await page.getByText('AI: node server.js').click(); // the program's own tab: the Shell tab shows this PC's folder names
    await page.locator('text=Preview server ready >> visible=true').first().waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500); // the three request lines
    void id;
  },

  // ---- v0.1.15 ----
  // folder-trust.png: the card "Trust this folder?" above the message box: question 1 (instruction files) and question 2 (Auto). Locator: #fr-trust-card ([aria-label="Trust this folder?"]).
  'folder-trust': async (page, api) => {
    await api.request.put('/api/settings', { data: { folderRulesEnabled: true, folderRulesTrusted: [], autoJudgeEnabled: true } });
    const folder = gitProject('notes-app-trust', RULES);
    await api.request.delete('/api/folder-trust', { data: { folder } }).catch(() => {});
    await api.request.post('/api/providers/anthropic/connect', { data: { apiKey: 'sk-test-000000000000' } });
    await api.request.post('/api/folder/check', { data: { folder } });
    const made = await api.seed({ title: 'Notes app', workMode: 'code', folder, permissionMode: 'smart', messages: [user('Hello', 10), assistant('Hello! Ask me anything about this project.', 11)] });
    await page.addInitScript(() => { try { localStorage.setItem('bunny.workMode', 'code'); } catch { /* storage blocked */ } });
    await api.open(`/?s=${made.id}`);
    await page.locator('#fr-trust-card').waitFor({ state: 'visible', timeout: 15_000 });
  },

  // engine-switch-menu.png: the engine chip's menu "Switch this chat to…" with the reasons. Locator: #engine-menu (opened from #engine-chip).
  'engine-switch-menu': async (page, api) => {
    await withEngines(api);
    await api.request.post('/api/providers/anthropic/connect', { data: { apiKey: 'sk-test-000000000000' } });
    await codeChatWith(page, api, project('notes-app-engines', RULES));
    await page.locator('#engine-chip').waitFor({ state: 'visible' });
    await page.locator('#engine-chip').click();
    await page.locator('#engine-menu').waitFor({ state: 'visible' });
  },

  // engine-switch-confirm.png: the confirm card "Switch this chat to Codex CLI?". Locator: .engine-switch-card.
  'engine-switch-confirm': async (page, api) => {
    await withEngines(api);
    await api.request.post('/api/providers/anthropic/connect', { data: { apiKey: 'sk-test-000000000000' } });
    await codeChatWith(page, api, project('notes-app-engines', RULES));
    await page.locator('#engine-chip').click();
    await page.locator('#engine-menu .es-row', { hasText: 'Codex CLI' }).getByRole('button', { name: 'Switch' }).click();
    await page.locator('.engine-switch-card').waitFor({ state: 'visible' });
  },

  // project-instructions-changed.png: the Working folder card's "Project instructions" block with AGENTS.md "changed since it was read". Locator: .modal[aria-label="Working folder"] .fr-block:not(#confine-block).
  'project-instructions-changed': async (page, api) => {
    await api.request.put('/api/settings', { data: { folderRulesEnabled: true, folderRulesTrusted: [] } });
    const folder = project('notes-app-rules', RULES);
    await api.request.post('/api/providers/anthropic/connect', { data: { apiKey: 'sk-test-000000000000' } });
    const made = await codeChatWith(page, api, folder);
    const diff = await (await api.request.get(`/api/sessions/${made.id}/folder-rules/diff`)).json();
    const shas = Object.fromEntries(diff.added.filter((f) => f.name === 'AGENTS.md').map((f) => [f.name, f.sha256]));
    const followed = await api.request.post(`/api/sessions/${made.id}/folder-rules/follow`, { data: { names: ['AGENTS.md'], shas } });
    if (!followed.ok()) throw new Error(`Follow was refused: ${await followed.text()}`);
    writeFileSync(join(folder, 'AGENTS.md'), 'Use tabs.\nSay goodbye.\n'); // somebody changed the file after it was followed
    await page.locator('#folder-chip').click();
    const card = page.locator('.modal[aria-label="Working folder"]');
    await card.locator('.fr-row:has(.fr-n:text-is("AGENTS.md"))', { hasText: 'changed since it was read' }).waitFor({ timeout: 10_000 });
  },
};

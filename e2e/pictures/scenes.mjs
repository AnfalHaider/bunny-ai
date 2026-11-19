// PICTURE-CHECK: the scenes. One per help picture (docs/images/pictures.json names it). A scene brings the INVENTED profile to the screen the picture shows, through the API where it can
// (seeded chats and settings), so every run draws the same screen. What is fixed for every scene (see begin() in e2e/pictures.spec.js): the profile name Sam, the clock (2026-01-15 14:12),
// the bundled interface and reply fonts, reduced motion, the theme and size from the manifest entry. A scene may add only what its own screen needs.
//
// A scene is `async (page, api, entry) => {}` where api = { request, base, seed, open }:
//   api.request        Playwright's request fixture (the e2e server, token already sent)
//   api.seed(chat)     create a chat with messages (and, for helpers, a parent): returns the chat
//   api.open(url)      go to a page of the app and wait for the fonts
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

/** A long invented script, so the same lines fold the same way every time. */
const script = (lines) => Array.from({ length: lines }, (_, i) => (i === 0 ? '#!/usr/bin/env python3' : i % 20 === 1 ? `# --- part ${Math.ceil(i / 20)} ---` : `step_${i} = backup_notes("notes/folder_${i % 7}", keep=${(i % 5) + 1})`)).join('\n');

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
    await page.getByText('GitHub', { exact: true }).first().waitFor();
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
    await api.open('/src/ui/settings.html?section=code');
    await page.waitForSelector('#perm-rules');
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
};

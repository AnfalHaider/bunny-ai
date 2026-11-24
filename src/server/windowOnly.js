/**
 * W27-3 / W5-7: security-relevant writes that only Bunny's own window may make.
 *
 * Every page of the app carries the launch token, so any program on this computer that can read a page (or a model that can run a command)
 * could drive the whole local API with it. In the desktop app (folderPickerOnly) these writes therefore need a second secret that only the
 * Electron main process knows: the window asks main through preload and IPC, and main makes the request. Over plain HTTP they get
 * 403 "Change this in Bunny's window." The plain-browser dev mode (no main process) keeps HTTP.
 *
 * What is covered: what Bunny may do without asking (the permission mode and rules, the model allowlist, computer use, building tools),
 * what it may run (connectors, schedules, hooks, plugins, skills, custom tools, the terminal, driving the computer), where its traffic
 * goes (providers, accounts), and answering a prompt for any of it (permission and capability prompts).
 *
 * src/ui/api.js carries a copy of this file's lists and matcher (the browser cannot import it); test/window-only.test.js keeps the two equal.
 */

/** Settings keys that decide what Bunny may do or where it may go. */
export const WINDOW_ONLY_SETTING_KEYS = ['permissionRules', 'defaultPermissionMode', 'aiComputerUse', 'computerUseEnabled', 'pcSearchEnabled', 'pcSearchAfter', 'pcSearchExcluded', 'pcSearchBarAuto', 'customToolsEnabled', 'allowlist', 'aliases', 'connectorsEnabled', 'plugins', 'instructions', 'skillsEnabled', 'updateUrl', 'githubClientId', 'googleClientId', 'googleClientSecret', 'googleWorkspace', 'autoContinueSteps', 'autoContinueMinutes', 'autoContinueTokens', 'scheduledContinueSteps', 'scheduledContinueMinutes', 'scheduledContinueTokens', 'maxTokens', 'helpersEnabled', 'modelFilter', 'autoUpdate', 'fallbackWhenBusy', 'quickAskEnabled', 'quickAskShortcut', 'engine', 'engines', 'useBunnyEngine', 'braveKeySet', 'folderRulesEnabled', 'folderRulesTrusted'];

/** A session setting that decides the same. */
export const WINDOW_ONLY_SESSION_SETTINGS = ['permissionMode', 'engine', 'folderRules'];

const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
const UUID = '[a-f0-9-]{36}';
/** Routes that are window-only whatever their body says: [methods, path pattern]. */
export const WINDOW_ONLY_ROUTES = [
  [WRITES, `^/api/mcp(/${UUID}(/call|/key)?)?$`],           // connectors: add, enable, change, remove, call, key
  [WRITES, `^/api/connectors(/.*)?$`],                      // connector sign-in (W3-6)
  [WRITES, `^/api/schedules(/${UUID})?$`],                  // schedules
  [WRITES, `^/api/hooks(/${UUID})?$`],                      // hooks run commands
  [WRITES, `^/api/skills(/${UUID})?$`],                     // skills are instructions the model follows
  [['POST'], '^/api/plugins/install$'],
  [['POST'], '^/api/plugins$'],                            // a plugin from the catalog or a file (W4-10)
  [['POST'], `^/api/plugins/${UUID}/update$`],             // update a plugin from its source (W4-11 P-4)
  [['DELETE', 'PATCH'], `^/api/plugins/${UUID}$`],         // uninstall a plugin (W4-10), switch one on or off as a whole (W4-11 P-5)
  [['DELETE'], '^/api/tools/[a-z][a-z0-9_]{1,39}$'],        // custom tools
  [['POST', 'DELETE'], `^/api/sessions/${UUID}/worktree(/finish)?$`], // a chat's own copy of its project (W2-9): it makes and removes folders and branches
  [['POST'], '^/api/worktrees/remove$'],                    // removing a leftover copy (W2-9)
  [['POST'], `^/api/sessions/${UUID}/engine$`],             // ENGINE-SWITCH: moving a chat to another engine
  [['POST'], `^/api/sessions/${UUID}/folder-rules/(follow|read-again|ask-again)$`], // FOLDER-RULES (FR-2): the trust answer and its changes are the window's
  [['POST'], `^/api/sessions/${UUID}/permission/${UUID}$`], // answering a permission prompt
  [['POST'], `^/api/sessions/${UUID}/capability/${UUID}$`], // answering a capability prompt (computer use, building tools)
  [['POST'], `^/api/sessions/${UUID}/question/${UUID}$`],   // answering a question card ("Keep going?")
  [['POST'], '^/api/computer/.*$'],                         // driving the computer
  [['POST'], '^/api/terminal/(create|write|resize|kill)$'], // a terminal runs commands
  [['POST'], '^/api/providers/custom$'],                    // where model traffic goes
  [['DELETE'], '^/api/providers/custom-[a-z0-9-]+$'],
  [['POST'], '^/api/providers/[a-z0-9-]+/(connect|disconnect)$'],
  [WRITES, '^/api/account/(github|google)(/.*)?$'],         // sign-ins and sign-outs
  [['POST'], '^/api/oauth/[a-z0-9-]+/(start|finish)$'],     // provider sign-in
  [['GET'], '^/api/remote/log$'],                           // DEVICE-FULL R-DF2: what devices did; read only in Bunny's window
  [WRITES, '^/api/engines(/.*)?$'],                         // CLI-ENGINES: download, update, switch, roll back, remove, sign in and out of an engine
  [WRITES, '^/api/web-search(/.*)?$'],                      // F6: the Brave Search key is the window's alone
  [WRITES, '^/api/remote(/.*)?$'],                          // BROWSER step 2: opening Bunny to other devices, and ending their sessions
];

/** Is this request one only the window may make? `body` is the parsed JSON body (some writes are judged by what they change). */
export function isWindowOnlyRoute(method, path, body = null) {
  const m = String(method).toUpperCase();
  if (WINDOW_ONLY_ROUTES.some(([methods, re]) => methods.includes(m) && new RegExp(re).test(path))) return true;
  const has = (...keys) => Boolean(body) && typeof body === 'object' && keys.some((k) => Object.hasOwn(body, k));
  if (path === '/api/permission-rules' && m === 'PUT') return true;
  if (path === '/api/settings' && m === 'PUT') return has(...WINDOW_ONLY_SETTING_KEYS);
  if (path === '/api/sessions' && m === 'POST') return has('permissionMode', 'engine');
  if (new RegExp(`^/api/sessions/${UUID}$`).test(path) && m === 'PATCH') return has('permissionMode', 'engine', 'folderRules');
  // a project's instructions steer the model in every chat that uses it
  if (path === '/api/projects' && m === 'POST') return has('instructions');
  if (new RegExp(`^/api/projects/${UUID}$`).test(path) && m === 'PATCH') return has('instructions');
  const session = new RegExp(`^/api/sessions/${UUID}/setting/([A-Za-z-]+)$`).exec(path);
  if (session && m === 'PATCH') return WINDOW_ONLY_SESSION_SETTINGS.includes(session[1]);
  return false;
}

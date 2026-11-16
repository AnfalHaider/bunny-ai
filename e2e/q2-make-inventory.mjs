/**
 * Q-2: turns the live control inventory (e2e/q2-inventory.mjs) plus the audit verdicts into
 * docs/plans/audit-q2-inventory.md, one row per control.
 *   node e2e/q2-make-inventory.mjs <inventory.json> > docs/plans/audit-q2-inventory.md
 */
import { readFileSync } from 'node:fs';

const inv = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const P = 'PASS', F = 'FAIL', U = 'UNKNOWN';
// [page, regex on "id key name", what it should do, verdict, check / defect]
const R = [
  ['/', /^mode-chat|^mode-code/, 'switch Chat / Code (composer changes, remembered)', P, 'N1 (e2e/q2-controls.mjs)'],
  ['/', /^new-chat/, 'start an empty chat with the greeting', P, 'N4'],
  ['/', /^incognito/, 'start a chat that is never saved', P, 'N10'],
  ['/', /^artifacts-toggle|^artifacts-close/, 'open / close the Artifacts panel', P, 'N15, PN7'],
  ['/', /^search /, 'filter the chat list as you type', P, 'N6'],
  ['/', /^project-filter/, 'show one project chats', P, 'N12'],
  ['/', /^new-project/, 'ask for a name and create a project', P, 'N11'],
  ['/', /^import /, 'open the import dialog', P, 'N13'],
  ['/', /^import-(run|cancel|choose|text|file)/, 'import a transcript: heading format works, one-line "User:" labels do not', F, 'N13 PASS, N13b FAIL: Q2-16'],
  ['/', /^archived-toggle/, 'list archived chats; restore', P, 'N9'],
  ['/', /^account-button/, 'open the account menu', P, 'M1'],
  ['/', /^settings-open|^settings-close/, 'open / close the Settings window (also Ctrl+, and Esc)', P, 'M4, M6'],
  ['/', /Command palette|^palette-input/, 'open the palette; search commands and chats', F, 'K1 click works; keyboard FAILS Q2-14; Settings/Providers commands leave the chat Q2-15'],
  ['/', /Settings Ctrl|profile Settings|^ usage|^ language|providers Provid|about About|usage Usage|language Language/, 'open that Settings section', P, 'M1'],
  ['/', /^zoom-/, 'zoom out / reset / in (also Ctrl+- 0 +)', P, '0.1.4 walk Z-* (docs/qa/2026-11-16-0.1.4-walk.md)'],
  ['/', /Check for updates|about Check/, 'check the update source and show the result', P, 'M3, S-about'],
  ['/', /Quit Bunny/, 'quit the desktop app (hidden in the browser build)', U, 'M2: hidden in a browser; Electron not run'],
  ['/', /^update-(install|later)/, 'restart to update / dismiss the banner', U, 'needs an update to be available'],
  ['/', /^sidebar-toggle/, 'phone: show / hide the chat list', P, '0.1.4 walk Z-phone-*'],
  ['/', /^sidebar-collapse/, 'hide / show the sidebar (Ctrl+B)', P, 'N14'],
  ['/', /^export/, 'download the chat as Markdown', P, 'T1'],
  ['/', /^rail-toggle|overview/, 'open the Session pane with useful details', F, 'T3-overview opens it; the content is thin: Q2-6'],
  ['/', /^terminal-new/, 'open another shell', F, 'PN1b: does nothing once a shell exists: Q2-18'],
  ['/', /^terminal-input|^tab-terminal|terminal Terminal/, 'open a shell, run a command, show the output', P, 'T3-terminal, PN1'],
  ['/', /^pane-diff-refresh|^tab-diff|diff Changes/, 'list what Bunny changed, with diffs', F, 'CM2: nothing is wired: Q2-4'],
  ['/', /^tab-file|file Files/, 'list the folder and read a file', F, 'CM3: nothing is wired: Q2-5'],
  ['/', /^tab-plan/, 'show the plan', F, 'tab is not visible and the pane is never filled: Q2-7'],
  ['/', /^tab-tasks|tasks Tasks/, 'show the plan as a checklist', P, 'T3-tasks, PN6'],
  ['/', /^tab-(browser|artifacts)/, 'switch the tool pane tab', U, 'the toolbar drives the panes; the tab strip was not clicked'],
  ['/', /^devserver-use/, 'run the folder dev server and open it', P, 'PN5 (fixed 4 s wait: Q2-9)'],
  ['/', /^browser-blocked-open/, 'open a page that refuses framing in your own browser', U, 'needs a site that sends X-Frame-Options'],
  ['/', /browser|Open in your browser|Copy URL|Open HTML file|Clear this tab|New tab|Close tab/i, 'browse pages, history, tabs and the menu', P, 'PN2, PN3 (unreachable page: PN4 FAIL Q2-9)'],
  ['/', /^popout/, 'open this chat in its own window', P, 'T2'],
  ['/', /^input /, 'type a message; Enter sends, Shift+Enter adds a line', P, 'N2'],
  ['/', /^send/, 'send; ignored when empty', P, 'N2, N3'],
  ['/', /^stop/, 'stop a reply and keep what arrived', P, 'C7 (see Q2-19 note)'],
  ['/', /^attach|^file-input/, 'attach files; chip with x to remove', P, 'C1'],
  ['/', /^voice/, 'hold to talk', U, 'C2: no microphone in the test browser; nothing is shown either'],
  ['/', /^folder-chip|^branch-chip/, 'choose the working folder; read its git branch', F, 'CM1 display PASS; touching it reverts the mode: Q2-2'],
  ['/', /^mode-button|^permission-mode|Permission mode|Auto.?Bunny decides|Manual.?Always|Accept edits|Plan.?Agree/, 'Auto / Manual / Accept edits / Plan (keys 1-4), saved to the chat, enforced', F, 'C3, CM6, CM8 PASS; Plan not enforced Q2-1; before first message Q2-2, Q2-3'],
  ['/', /^effort-level/, 'Low / Medium / High / Max', P, 'C4 (before the first message: Q2-3)'],
  ['/', /^job-button/, 'pick the kind of job', P, 'C5'],
  ['/', /^picker-button/, 'pick a model or Auto', P, 'C6 (fallback behaviour: Q2-10 to Q2-13)'],
  ['/', /Side by side|Open in new window/, 'side by side / new window layout', U, 'not driven'],
  ['/', /Panel layout|Dock (left|right|bottom)|Fill the chat/, 'dock the pane left / right / bottom, or fill the chat', P, 'T4'],
  ['/', /^settings-search/, 'filter the Settings sections', P, 'M5'],
  ['/', /./, 'Settings section row, Providers link', P, 'M1, M4'],
  ['settings', /github|google|Sign in|token|Paste a token|Make a token/i, 'sign in to GitHub / Google', U, 'external sign-in; not run (no real accounts)'],
  ['settings', /photo-|display-name|call-name/, 'profile photo, full name, call-me name', P, '0.1.4 walk P1-P6'],
  ['settings', /theme|interfaceFont|responseFont|transcript(Size|Width)|motion|code-theme|codeFont|codeThemeLight|codeThemeDark|open-appearance/, 'appearance choices apply and persist', P, '0.1.4 walk A-*; Q-2 A-apply'],
  ['settings', /language/, 'change the language', P, 'S-language'],
  ['settings', /notifications/, 'reply-ready notification switch', P, 'S-notif'],
  ['settings', /instructions|memoryEnabled|searchChats|autoMemory|memorySensitive|manage-memory|start-import|import-answer|run-memory-import|copy-import-prompt/, 'My Dear Bunny: instructions, memory, import', P, '0.1.4 walk B1-B4'],
  ['settings', /speech-voice/, 'choose a speech voice', P, 'S-speech'],
  ['settings', /model-filter|max-tokens|allowlist|aliases|save-models/, 'model filter, limits, allowlist, aliases', P, 'S-models'],
  ['settings', /default-permission|default-effort|branchPrefix|statusLabels|transcriptView|helpersEnabled|promptSuggestions|summaryNextSteps|unrelatedTask/, 'Code defaults persist and reach a new chat', P, '0.1.4 walk C1-C4'],
  ['settings', /check-update/, 'check for updates', P, 'S-about'],
  ['settings', /restart-update|launch-at-login|close-to-tray|desktop/, 'desktop-only options', U, 'hidden in the browser build; Electron not run'],
  ['settings', /./, 'section content', P, 'S-* and 0.1.4 walk S-*'],
  ['providers', /OpenCode|Copilot|I have signed in|Or paste a token|Get a key|opencode-go-token|github-copilot-token/, 'sign in through the provider own page', U, 'external sign-in; not run'],
  ['providers', /Ollama|f-ollama/, 'connect a local Ollama', U, 'no Ollama server here'],
  ['providers', /custom-/, 'add a custom OpenAI-compatible provider', P, 'PV3 (an unreachable test URL is accepted and listed)'],
  ['providers', /Connect|Cancel|Paste your key|f-.*-(apiKey|baseUrl)|^ /, 'connect with a key; an empty key is refused with a message', P, 'PV1 (Anthropic), PV2; every provider uses the same form'],
  ['providers', /./, 'link', P, 'PV*'],
  ['automation', /mcp-local|local connector/i, 'add a local connector (runs a program)', U, 'would run a program; not run'],
  ['automation', /mcp-name|mcp-url|Add server/, 'add a remote MCP server (a bad address is refused)', P, 'AU2'],
  ['automation', /memory|Remember/i, 'add / delete memory', P, 'AU1'],
  ['automation', /schedule|Add schedule/i, 'add a schedule', P, 'AU3'],
  ['automation', /hook/i, 'add a hook', P, 'AU4'],
  ['automation', /skill/i, 'add a skill', P, 'AU5'],
  ['automation', /./, 'link', P, 'AU*'],
  ['customize', /Connector name|Connector address|Add connector|Plugin|Install|cz-plugin-file|GitHub repository/, 'add a connector / plugin from GitHub or a file', U, 'needs an external server or repository'],
  ['customize', /Skill|Turn on|Turn off|Remove|Clear/, 'skill lifecycle', P, 'CZ2'],
  ['customize', /./, 'tabs, search, Add menu, links', P, 'CZ1'],
];
const pageKey = (u) => (u === '/' ? '/' : u.includes('settings') ? 'settings' : u.includes('providers') ? 'providers' : u.includes('automation') ? 'automation' : 'customize');
const rows = [];
for (const [url, list] of Object.entries(inv)) {
  for (const c of list) {
    const label = [c.id, c.key, c.name].filter(Boolean).join(' ');
    const key = pageKey(url);
    const m = R.find(([pg, re]) => pg === key && re.test(label)) ?? [key, null, 'not driven', U, 'not driven'];
    rows.push({ url, section: c.sect || '', ctl: `${c.tag}${c.id ? '#' + c.id : ''}${c.key ? ' [' + c.key + ']' : ''} "${c.name}"`.slice(0, 90), should: m[2], verdict: m[3], ev: m[4] });
  }
}
const n = (v) => rows.filter((r) => r.verdict === v).length;
console.log('# Q-2 control inventory (one row per control)\n');
console.log(`Generated by \`e2e/q2-make-inventory.mjs\` from the live DOM (\`e2e/q2-inventory.mjs\`) on an invented profile, 2026-11-16. ${rows.length} controls: ${n(P)} PASS, ${n(F)} FAIL, ${n(U)} UNKNOWN.`);
console.log('The verdict comes from the check named in the last column (see docs/plans/audit-q2.md and the scripts e2e/q2-*.mjs). UNKNOWN means not driven: external sign-in, needs the Electron app, needs an update, or would run a program. Controls that share one form (for example the Connect buttons) share one check.\n');
for (const pg of Object.keys(inv)) {
  console.log(`\n## ${pg === '/' ? 'Chat shell (/)' : pg}\n`);
  console.log('| Control | Section | Should | Verdict | Check |\n|---|---|---|---|---|');
  for (const r of rows.filter((x) => x.url === pg)) console.log(`| ${r.ctl.replace(/\|/g, '/')} | ${r.section} | ${r.should} | ${r.verdict} | ${r.ev} |`);
}

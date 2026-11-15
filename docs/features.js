/** The feature tally, in machine-readable form.
 *
 * `docs/FEATURE-TALLY.md` is the readable version; this module is the one the
 * tests check. A row may only be status 'D' when `test` names a test that
 * exists in `test/` or `e2e/`. `test/tally.test.js` enforces that, so the
 * matrix cannot quietly claim more than the code does.
 *
 * `scope` keeps the tally honest about what parity means:
 *   core       - a conversation can be had without it
 *   app        - a surface a desktop AI app is known for
 *   platform   - desktop/OS integration
 *   enterprise - org administration and vendor-specific hardware/cloud
 */

/** @typedef {{ id: string, area: string, name: string, scope: string, status: 'D'|'P'|'M', test?: string, note?: string }} Feature */

/** @type {Feature[]} */
export const FEATURES = [
  // 1. Conversation core
  { id: '1.1', area: 'Conversation', name: 'Stream a reply token by token', scope: 'core', status: 'D', test: 'connect, pick a model, chat, and reload into the same thread' },
  { id: '1.2', area: 'Conversation', name: 'Enter sends, Shift+Enter newlines', scope: 'core', status: 'D', test: 'Enter sends and Shift+Enter adds a line' },
  { id: '1.3', area: 'Conversation', name: 'Stop generation mid-stream', scope: 'core', status: 'D', test: 'stopping a reply ends the stream' },
  { id: '1.4', area: 'Conversation', name: 'Conversation survives a reload', scope: 'core', status: 'D', test: 'connect, pick a model, chat, and reload into the same thread' },
  { id: '1.5', area: 'Conversation', name: 'Sidebar of past conversations', scope: 'core', status: 'D', test: 'list is newest-first' },
  { id: '1.6', area: 'Conversation', name: 'Delete a conversation', scope: 'core', status: 'D', test: 'remove deletes one session and leaves the rest' },
  { id: '1.7', area: 'Conversation', name: 'Auto-title from the first message', scope: 'core', status: 'D', test: 'appending a user turn names the chat after it' },
  { id: '1.8', area: 'Conversation', name: 'Rename a conversation', scope: 'app', status: 'D', test: 'a new chat can be renamed through PATCH' },
  { id: '1.9', area: 'Conversation', name: 'Copy a message', scope: 'app', status: 'D', test: 'a message can be copied from its action bar' },
  { id: '1.10', area: 'Conversation', name: 'Retry the last reply', scope: 'app', status: 'D', test: 'retrying a reply asks again and keeps one answer' },
  { id: '1.11', area: 'Conversation', name: 'Edit a message and resend', scope: 'app', status: 'D', test: 'editing a message replaces it and asks again' },
  { id: '1.12', area: 'Conversation', name: 'Branch a conversation at a turn', scope: 'app', status: 'D', test: 'a branch copies the transcript up to the chosen turn and points at its parent' },
  { id: '1.13', area: 'Conversation', name: 'Markdown with code blocks', scope: 'core', status: 'D', test: 'a reply is rendered as Markdown, with a copyable code block' },
  { id: '1.14', area: 'Conversation', name: 'Syntax highlighting', scope: 'app', status: 'D', test: 'code in a reply is highlighted' },
  { id: '1.15', area: 'Conversation', name: 'File and image attachments', scope: 'app', status: 'D', test: 'a file can be attached to a message' },
  { id: '1.16', area: 'Conversation', name: '/clear', scope: 'app', status: 'D', test: '/clear starts a new chat and keeps the old one' },
  { id: '1.17', area: 'Conversation', name: '/compact', scope: 'app', status: 'D', test: '/compact adds a labelled summary and keeps the conversation on screen' },
  { id: '1.24', area: 'Conversation', name: 'The model’s thinking, folded above the reply', scope: 'app', status: 'D', test: 'an artifact the model makes gets a card and opens beside the chat; its thinking is folded' },
  { id: '1.25', area: 'Conversation', name: 'Compaction with a summary the model writes', scope: 'app', status: 'D', test: 'compacting uses a summary the model writes, and the plain one when the model cannot' },
  { id: '1.18', area: 'Conversation', name: 'Automatic compaction', scope: 'app', status: 'D', test: 'a chat that fills up is compacted before the next message' },
  { id: '1.19', area: 'Conversation', name: 'Context meter', scope: 'app', status: 'D', test: 'the context meter counts what the transcript will cost' },
  { id: '1.20', area: 'Conversation', name: '/export a transcript', scope: 'app', status: 'D', test: 'export returns a markdown transcript and a json one' },
  { id: '1.21', area: 'Conversation', name: 'Search past conversations', scope: 'app', status: 'D', test: 'search matches message text, not only titles' },
  { id: '1.22', area: 'Conversation', name: 'Incognito chat', scope: 'app', status: 'D', test: 'an incognito chat leaves nothing behind' },

  // 2. Models and providers
  { id: '2.1', area: 'Providers', name: 'Connected and popular groups', scope: 'core', status: 'D', test: 'every provider from the picker screen is listed' },
  { id: '2.2', area: 'Providers', name: 'Connect with an API key', scope: 'core', status: 'D', test: 'connect, pick a model, chat, and reload into the same thread' },
  { id: '2.3', area: 'Providers', name: 'Disconnect a provider', scope: 'core', status: 'D', test: 'disconnecting clears the provider' },
  { id: '2.4', area: 'Providers', name: 'Discover a provider model list', scope: 'core', status: 'D', test: 'normalises an OpenAI-compatible list' },
  { id: '2.5', area: 'Providers', name: 'Grouped searchable model picker', scope: 'core', status: 'D', test: 'the picker filters models by search' },
  { id: '2.6', area: 'Providers', name: 'Full keyboard control in the picker', scope: 'app', status: 'D', test: 'the model picker is driven from the keyboard' },
  { id: '2.7', area: 'Providers', name: 'Model stored per conversation', scope: 'core', status: 'D', test: 'update changes title, provider and model but never the transcript' },
  { id: '2.8', area: 'Providers', name: 'Default model for new chats', scope: 'core', status: 'D', test: 'settings round-trip and persist to disk' },
  { id: '2.9', area: 'Providers', name: 'Key-unverified honesty chip', scope: 'core', status: 'D', test: 'a public model list connects but leaves the key unverified' },
  { id: '2.10', area: 'Providers', name: 'Local model server', scope: 'app', status: 'D', test: 'a local server connects with no key and offers its models' },
  { id: '2.11', area: 'Providers', name: 'OAuth sign-in providers', scope: 'app', status: 'D', test: 'the sign-in routes give a code and then connect the provider' },
  { id: '2.12', area: 'Providers', name: 'Model aliases and allowlist', scope: 'app', status: 'D', test: 'the settings screen saves an allowed-model list' },
  { id: '2.13', area: 'Providers', name: 'Per-provider usage display', scope: 'app', status: 'D', test: 'the settings screen shows what each provider was used for' },
  { id: '2.14', area: 'Providers', name: 'Each provider speaks its own dialect', scope: 'core', status: 'D', test: 'Anthropic points at the OpenAI shape and uses its own header' },
  { id: '2.15', area: 'Providers', name: 'Models the account cannot reach are marked in the picker', scope: 'core', status: 'D', test: 'a model the account cannot reach is remembered and marked' },
  { id: '2.16', area: 'Providers', name: 'Retryable provider refusals are retried once', scope: 'core', status: 'D', test: 'a request that asks for more than the balance covers is retried smaller' },
  { id: '2.17', area: 'Providers', name: 'A silent provider is reported instead of hanging', scope: 'core', status: 'D', test: 'a provider that goes silent is reported instead of hanging' },
  { id: '2.18', area: 'Providers', name: "The provider's own error explanation reaches the person", scope: 'core', status: 'D', test: 'the provider explanation reaches the person' },
  { id: '2.19', area: 'Providers', name: 'An unverifiable key is not waved through', scope: 'core', status: 'D', test: 'the google 404-on-models quirk does not wave a bad key through' },
  { id: '2.20', area: 'Providers', name: 'Custom OpenAI-compatible providers', scope: 'app', status: 'D', test: 'a custom provider is added, chats with its own key header, survives a restart, and can be removed' },
  { id: '2.22', area: 'Providers', name: 'Another model answers when the picked one is busy', scope: 'app', status: 'D', test: 'when the picked model is busy, another answers and the reply says so' },
  { id: '2.21', area: 'Providers', name: 'ModelScope, SiliconFlow, Gitee AI and other popular providers', scope: 'app', status: 'D', test: 'ModelScope, SiliconFlow and Gitee AI are ready to connect with their own addresses' },

  // 3. Artifacts
  { id: '3.1', area: 'Artifacts', name: 'Artifact side panel', scope: 'app', status: 'D', test: 'a reply can be kept as an artifact beside the chat' },
  { id: '3.2', area: 'Artifacts', name: 'Promote a reply to an artifact', scope: 'app', status: 'D', test: 'a reply can be kept as an artifact beside the chat' },
  { id: '3.3', area: 'Artifacts', name: 'Sandboxed HTML rendering', scope: 'app', status: 'D', test: 'an HTML artifact is shown in a sandboxed frame' },
  { id: '3.4', area: 'Artifacts', name: 'Version history and restore', scope: 'app', status: 'D', test: 'an artifact keeps every version and can restore an older one' },
  { id: '3.5', area: 'Artifacts', name: 'Open an artifact separately', scope: 'app', status: 'D', test: 'an artifact can be opened on its own' },
  { id: '3.6', area: 'Artifacts', name: 'Print an artifact', scope: 'app', status: 'D', test: 'an artifact shows a thumbnail and can be printed' },
  { id: '3.7', area: 'Artifacts', name: 'Star an artifact', scope: 'app', status: 'D', test: 'an artifact can be starred and deleted' },
  { id: '3.8', area: 'Artifacts', name: 'Charts and diagrams in artifacts', scope: 'app', status: 'D', test: 'an artifact that is data is drawn as a chart' },
  { id: '3.9', area: 'Artifacts', name: 'Artifact thumbnails', scope: 'app', status: 'D', test: 'an artifact shows a thumbnail and can be printed' },
  { id: '3.10', area: 'Artifacts', name: 'The model makes artifacts itself', scope: 'app', status: 'D', test: 'in Chat mode the model can make an artifact, which opens as a sandboxed page' },

  // 4. Structure
  { id: '4.1', area: 'Structure', name: 'Flat conversation list', scope: 'core', status: 'D', test: 'list is newest-first' },
  { id: '4.2', area: 'Structure', name: 'Nested child conversations', scope: 'app', status: 'D', test: 'a branch copies the transcript up to the chosen turn and points at its parent' },
  { id: '4.3', area: 'Structure', name: 'Projects', scope: 'app', status: 'D', test: 'a project holds conversations and its instructions reach the model' },
  { id: '4.4', area: 'Structure', name: 'Project instructions', scope: 'app', status: 'D', test: 'a project holds conversations and its instructions reach the model' },
  { id: '4.5', area: 'Structure', name: 'Star a conversation', scope: 'app', status: 'D', test: 'pinned chats sort above newer unpinned ones' },
  { id: '4.6', area: 'Structure', name: 'Archive a conversation', scope: 'app', status: 'D', test: 'an archived chat leaves the list unless asked for' },
  { id: '4.7', area: 'Structure', name: 'Import history', scope: 'app', status: 'D', test: 'a transcript from another tool can be imported' },

  // 5. Shell and settings
  { id: '5.1', area: 'Shell', name: 'Light, dark and system theme', scope: 'core', status: 'D', test: 'theme choice survives a reload' },
  { id: '5.2', area: 'Shell', name: 'Phone-width layout', scope: 'core', status: 'D', test: 'a phone-width window does not scroll sideways' },
  { id: '5.3', area: 'Shell', name: 'Settings screen', scope: 'core', status: 'D', test: 'settings reports test mode is on' },
  { id: '5.4', area: 'Shell', name: 'Secrets encrypted per user', scope: 'core', status: 'D', test: 'DPAPI round-trips a secret' },
  { id: '5.5', area: 'Shell', name: 'Keyboard shortcuts and command palette', scope: 'app', status: 'D', test: 'the command palette opens with Ctrl+K and runs a command' },
  { id: '5.6', area: 'Shell', name: 'Installable as a desktop app', scope: 'app', status: 'D', test: 'the app can be installed as a desktop app' },
  { id: '5.7', area: 'Shell', name: 'Multiple windows and popouts', scope: 'app', status: 'D', test: 'a chat can be opened in its own window' },
  { id: '5.8', area: 'Shell', name: 'Voice input and read-aloud', scope: 'app', status: 'D', test: 'a reply can be read aloud' },
  { id: '5.9', area: 'Shell', name: 'Notifications when a reply is ready', scope: 'app', status: 'D', test: 'notifications can be switched on' },
  { id: '5.10', area: 'Shell', name: 'Check for a newer version', scope: 'app', status: 'D', test: 'the version is shown, and a newer GitHub release is reported' },
  { id: '5.11', area: 'Shell', name: 'Multi-language UI', scope: 'app', status: 'D', test: 'the interface can speak another language' },
  { id: '5.12', area: 'Shell', name: 'Accessibility labels and focus order', scope: 'core', status: 'D', test: 'every connect button has its own name' },

  // 6. Memory, connectors, automation
  { id: '6.1', area: 'Automation', name: 'Memory kept across chats', scope: 'app', status: 'D', test: 'a memory reaches the model, and is not stored as a turn' },
  { id: '6.2', area: 'Automation', name: 'Memory editor and privacy toggles', scope: 'app', status: 'D', test: 'a memory can be written and switched off' },
  { id: '6.3', area: 'Automation', name: 'MCP server configuration', scope: 'app', status: 'D', test: 'an MCP server is added and refused when it is not an address' },
  { id: '6.4', area: 'Automation', name: 'MCP tools in a conversation', scope: 'app', status: 'D', test: 'a tool the model asks for is run and the answer comes back' },
  { id: '6.5', area: 'Automation', name: 'Connectors with OAuth', scope: 'app', status: 'D', test: 'the token arrives once the person has signed in' },
  { id: '6.6', area: 'Automation', name: 'Scheduled and recurring tasks', scope: 'app', status: 'D', test: 'a due schedule runs and leaves a chat behind' },
  { id: '6.7', area: 'Automation', name: 'Computer use', scope: 'enterprise', status: 'D', test: 'screen text is given at the centre of each line, in the pixels of the shown picture' },
  { id: '6.8', area: 'Automation', name: 'Skills', scope: 'app', status: 'D', test: 'a skill that is on reaches the model' },
  { id: '6.9', area: 'Automation', name: 'Hooks', scope: 'app', status: 'D', test: 'a hook runs when a message is sent' },
  { id: '6.10', area: 'Automation', name: 'Plugins and marketplaces', scope: 'app', status: 'D', test: 'installing a plugin adds and switches on its skills and connectors, and records the plugin' },
  { id: '6.11', area: 'Automation', name: 'Memories suggested from a chat', scope: 'app', status: 'D', test: 'a chat can suggest a memory, and it is kept only when accepted' },
  { id: '6.12', area: 'Automation', name: 'The model asks for a capability it lacks', scope: 'app', status: 'D', test: 'asking for Code mode: the person picks a folder and the file tools arrive in the same reply' },
  { id: '6.13', area: 'Automation', name: 'Programs that keep running', scope: 'app', status: 'D', test: 'a started program keeps running, is read in pieces, and stops' },
  { id: '6.14', area: 'Automation', name: 'Tools the model builds, with approval', scope: 'app', status: 'D', test: 'building a tool always asks, even in Auto mode, and the tool is usable at once' },
  { id: '6.15', area: 'Automation', name: 'Sub-agents working side by side', scope: 'app', status: 'D', test: 'two helpers run side by side, report back, and are kept as chats nested under this one' },
  { id: '6.16', area: 'Automation', name: 'Chats that message each other', scope: 'app', status: 'D', test: 'one chat can message another and read it; a background chat works on its own' },
  { id: '6.17', area: 'Automation', name: 'GitHub repositories, issues and pull requests', scope: 'app', status: 'D', test: 'the GitHub tools read and write through the API with the signed-in token' },
  { id: '6.18', area: 'Automation', name: "Undo the model's file changes", scope: 'app', status: 'D', test: 'the file changes of a reply can be undone, once' },
  { id: '6.19', area: 'Automation', name: 'A plan the model keeps visible', scope: 'app', status: 'D', test: 'the plan is shown as a live checklist and kept with the reply, without a step line per update' },
  { id: '6.20', area: 'Automation', name: 'The model remembers and schedules', scope: 'app', status: 'D', test: 'the AI can remember a fact and schedule a task; both ask first in Manual' },
  { id: '6.21', area: 'Automation', name: 'Local connectors (MCP servers run as a program)', scope: 'app', status: 'D', test: 'a local connector is only added with the command confirmed, and its tools reach the chat' },
  { id: '6.22', area: 'Automation', name: 'Gmail, Calendar and Drive', scope: 'app', status: 'D', test: 'the Google tools search mail, draft without sending, read the calendar and export a Doc' },
  { id: '6.23', area: 'Automation', name: 'Scheduled tasks with tools, unattended', scope: 'app', status: 'D', test: 'incognito chats and scheduled tasks send the key in the provider header; scheduled runs get tools' },
  { id: '6.25', area: 'Automation', name: 'The model asks questions with tailored choices and reasons', scope: 'app', status: 'D', test: 'the model asks with choices and gets the one the person clicked, in the same reply' },
  { id: '6.26', area: 'Automation', name: 'The model remembers its steps and continues after a cut-off', scope: 'app', status: 'D', test: 'on the next message the model is told what it already did, and to carry on after a cut-off' },
  { id: '6.24', area: 'Automation', name: 'Helpers on the model suited to their work', scope: 'app', status: 'D', test: 'a helper can run on a different model: named outright, chosen for the job, or the chat model when one fails' },
  { id: '1.23', area: 'Conversation', name: 'Greeting on a fresh page', scope: 'app', status: 'D', test: 'a fresh page greets you and centres the composer' },
  { id: '4.8', area: 'Structure', name: 'Date buckets and Recents in the sidebar', scope: 'app', status: 'D', test: 'the sidebar groups chats under a date bucket' },
  { id: '5.13', area: 'Shell', name: 'Open chat title in the topbar', scope: 'app', status: 'D', test: 'the topbar names the open chat' },
  { id: '5.14', area: 'Shell', name: 'Session rail show / hide', scope: 'app', status: 'D', test: 'the session rail shows environment and connectors' },
  { id: '5.15', area: 'Shell', name: 'Sign in with GitHub or Google', scope: 'app', status: 'D', test: 'signing in to GitHub: from the CLI, from a token, and out again; tokens never come back' },
];

export const countBy = (status) => FEATURES.filter((f) => f.status === status).length;

export const byArea = () => {
  const out = {};
  for (const f of FEATURES) {
    out[f.area] ??= { D: 0, P: 0, M: 0, total: 0 };
    out[f.area][f.status] += 1;
    out[f.area].total += 1;
  }
  return out;
};
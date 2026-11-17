/**
 * More things the model can do, each offered only when it makes sense:
 *
 *   artifacts      create_artifact, update_artifact          (every mode, when Artifacts is on)
 *   asking         request_capability                        (every mode)
 *   programs       start_process, read_process, stop_process, list_processes   (Code mode)
 *   the desktop    computer_screenshot, computer_click, computer_type, computer_key, computer_scroll
 *                  (when the person lets the AI control the desktop)
 *   building       create_tool                               (when the person lets the AI build tools)
 *
 * Risk levels match the rest of Bunny AI: read runs freely, edit and run follow
 * the permission mode. Two more: "own" never needs an OK (it only touches
 * Bunny AI's own artifacts, or is itself a question to the person), and
 * "build" asks in Manual and Accept edits and runs in Auto (it adds code that runs later); "send" (an email) asks in every mode.
 */

export const AGENT_TOOL_RISK = {
  create_artifact: 'own', update_artifact: 'own', request_capability: 'own',
  start_process: 'run', read_process: 'read', stop_process: 'read', list_processes: 'read',
  computer_screenshot: 'read', computer_click: 'build', computer_type: 'build', computer_key: 'build', computer_scroll: 'build',
  create_tool: 'build',
};

export const CAPABILITIES = {
  code_mode: 'Code mode: read and change files in a folder, and run commands and programs there',
  leave_plan_mode: 'Leave Plan mode: switch this chat to Ask mode, so Bunny can change files and run commands here (it asks before each)',
  computer_use: 'Control this computer: see the screen, click, type and press keys',
  custom_tools: 'Build new tools: write a small script that becomes a tool Bunny AI can use',
  new_tool: 'Something no current tool can do: find a plugin or connector for it, or build it',
};

const fn = (name, description, properties = {}, required = []) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
});

export function artifactToolDefinitions() {
  return [
    fn('create_artifact', 'Make an artifact: a page, app, game, document, diagram or long piece of code the person will look at or use. '
      + 'It opens in the Artifacts panel beside the chat, and an HTML artifact runs there as a live page. Use this instead of pasting long code into your reply; '
      + 'then say in a sentence or two what you made.',
    {
      title: { type: 'string', description: 'A short name, e.g. "Todo app"' },
      kind: { type: 'string', enum: ['html', 'markdown', 'code'], description: 'html for anything that runs in a browser (one self-contained file: inline CSS and JS), markdown for documents, code for other source files' },
      content: { type: 'string', description: 'The whole content' },
      language: { type: 'string', description: 'For kind code: the language, e.g. python' },
    }, ['title', 'kind', 'content']),
    fn('update_artifact', 'Replace the content of an artifact you made (a new version is kept; the old ones stay). Send the whole new content.',
      { id: { type: 'string' }, content: { type: 'string' }, title: { type: 'string' } }, ['id', 'content']),
  ];
}

export function capabilityToolDefinition() {
  return fn('request_capability', 'Ask the person to give you something you need but do not have, instead of working around it. '
    + 'They see a card and choose; if they agree, the new tools are yours straight away in this same reply. '
    + Object.entries(CAPABILITIES).map(([k, v]) => `${k}: ${v}.`).join(' '),
  {
    capability: { type: 'string', enum: Object.keys(CAPABILITIES) },
    reason: { type: 'string', description: 'One sentence, for the person: what you want to do with it' },
  }, ['capability', 'reason']);
}

export function processToolDefinitions(risks) {
  return [
    fn('start_process', 'Start a program that keeps running (a dev server, a watcher, a long build), as a Windows PowerShell 5.1 command '
      + '(separate commands with ;  — && and || are translated for you). Pass cwd to run in a subfolder; cd in an earlier call does not carry over. '
      + 'Waits a few seconds and returns its first output and id. Use run_command instead for commands that finish.',
    { command: { type: 'string' }, cwd: { type: 'string', description: 'Folder inside the workspace to run in, e.g. "web". Default: the workspace folder' },
      wait_seconds: { type: 'integer', description: '1 to 30, default 5' } }, ['command']),
    fn('read_process', 'Read what a started program printed since you last looked, and whether it is still running.',
      { id: { type: 'string' }, wait_seconds: { type: 'integer', description: 'Wait up to this long for output, 0 to 30. Default 0' } }, ['id']),
    fn('stop_process', 'Stop a program you started.', { id: { type: 'string' } }, ['id']),
    fn('list_processes', 'List the programs started in this chat.'),
  ].filter((d) => risks.includes(AGENT_TOOL_RISK[d.function.name]));
}

export function computerToolDefinitions(risks) {
  return [
    fn('computer_screenshot', 'See the whole screen of this computer. Returns the lines of text on screen with their positions, '
      + 'and the picture itself when you can see images. Positions are in the picture\'s pixels: use them for computer_click.'),
    fn('computer_click', 'Click on the screen at a position from the last computer_screenshot.',
      { x: { type: 'integer' }, y: { type: 'integer' }, button: { type: 'string', enum: ['left', 'right'] }, double: { type: 'boolean' } }, ['x', 'y']),
    fn('computer_type', 'Type text where the keyboard focus is.', { text: { type: 'string' } }, ['text']),
    fn('computer_key', 'Press a key or a combination, e.g. ["enter"] or ["ctrl","s"].',
      { keys: { type: 'array', items: { type: 'string' } } }, ['keys']),
    fn('computer_scroll', 'Scroll the window under a screen position.',
      { x: { type: 'integer' }, y: { type: 'integer' }, direction: { type: 'string', enum: ['up', 'down'] }, amount: { type: 'integer', description: 'Wheel steps, default 5' } }, ['x', 'y', 'direction']),
  ].filter((d) => risks.includes(AGENT_TOOL_RISK[d.function.name]));
}

export function buildToolDefinition() {
  return fn('create_tool', 'Build a new tool for yourself when nothing you have can do the job and no plugin fits. '
    + 'Write a PowerShell script: it gets its arguments as $params (e.g. $params.city) and whatever it prints is the answer. '
    + 'The person reads the script and must approve it. Once approved it is yours as my_<name>, now and in later chats.',
  {
    name: { type: 'string', description: 'lowercase_with_underscores, e.g. convert_units' },
    description: { type: 'string', description: 'What the tool does, for you to know when to use it' },
    parameters: { type: 'object', description: 'Each argument the tool takes, as name: description', additionalProperties: { type: 'string' } },
    script: { type: 'string', description: 'The PowerShell script' },
  }, ['name', 'description', 'script']);
}

export function isAgentTool(name) {
  return Object.hasOwn(AGENT_TOOL_RISK, name);
}

/** A short line for the transcript. */
export function describeAgentTool(name, args = {}) {
  const s = (v, n = 80) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
  switch (name) {
    case 'create_artifact': return `Make artifact "${s(args.title, 60)}"`;
    case 'update_artifact': return `Update artifact${args.title ? ` "${s(args.title, 60)}"` : ''}`;
    case 'request_capability': return `Ask for: ${CAPABILITIES[args.capability] ? s(args.capability).replace(/_/g, ' ') : 'a capability'}`;
    case 'start_process': return `Start ${s(args.command)}`;
    case 'read_process': return `Read output of ${s(args.id, 10)}`;
    case 'stop_process': return `Stop ${s(args.id, 10)}`;
    case 'list_processes': return 'List running programs';
    case 'computer_screenshot': return 'Look at the screen';
    case 'computer_click': return `${args.double ? 'Double-click' : args.button === 'right' ? 'Right-click' : 'Click'} at ${Math.round(args.x)}, ${Math.round(args.y)}`;
    case 'computer_type': return `Type "${s(args.text, 60)}"`;
    case 'computer_key': return `Press ${(Array.isArray(args.keys) ? args.keys : [args.keys]).map((k) => s(k, 12)).join('+')}`;
    case 'computer_scroll': return `Scroll ${args.direction === 'up' ? 'up' : 'down'} at ${Math.round(args.x)}, ${Math.round(args.y)}`;
    case 'create_tool': return `Build tool my_${s(args.name, 40)}`;
    default: return name;
  }
}

/** Screen text lines, scaled to the picture the model is shown. */
export function screenLinesText(lines, scale = 1, max = 150) {
  if (!lines.length) return 'No text was found on the screen.';
  return lines.slice(0, max).map((l) => {
    const x = Math.round((l.x + l.width / 2) * scale);
    const y = Math.round((l.y + l.height / 2) * scale);
    return `(${x}, ${y}) ${l.text}`;
  }).join('\n');
}

// ---- helpers and other chats ----

export const TEAM_TOOL_RISK = {
  run_subagent: 'own', start_session: 'own', list_models: 'read', list_sessions: 'read', read_session: 'read', message_session: 'edit',
};
Object.assign(AGENT_TOOL_RISK, TEAM_TOOL_RISK);

// A helper need not use this chat's model: the kind of work picks the best-suited one,
// or a model can be named outright (list_models shows them).
const MODEL_CHOICE = {
  job: { type: 'string', enum: ['chat', 'code', 'research', 'see'], description: 'The kind of work, so the best-suited model is picked: code (coding and tools), research (long answers from sources), see (pictures and screenshots), chat (writing and talk). Leave empty to use the model of this chat.' },
  model: { type: 'string', description: 'A specific model id from list_models, instead of job' },
};

export function teamToolDefinitions({ canDelegate = true } = {}) {
  const defs = [
    fn('list_sessions', 'List the other chats: the ones nested under this chat, its parent, and recent ones, with their ids.'),
    fn('read_session', 'Read the latest messages of another chat by id.',
      { session_id: { type: 'string' }, last: { type: 'integer', description: 'How many messages, default 10' } }, ['session_id']),
    fn('message_session', 'Send a message to another chat and get its reply. That chat answers with what it knows from its own conversation; '
      + 'the message and the reply are added to it.',
    { session_id: { type: 'string' }, message: { type: 'string' } }, ['session_id', 'message']),
  ];
  if (canDelegate) {
    defs.unshift(
      fn('run_subagent', 'Hand a self-contained task to a helper agent that works on it with your tools and reports back. '
        + 'Call it several times in one go to run helpers side by side (for example one per file, topic or question). '
        + 'The helper cannot see this conversation or ask the person anything, so put everything it needs in the task. '
        + 'Each helper\'s work is kept as a chat nested under this one.',
      {
        title: { type: 'string', description: 'A short name for the helper, e.g. "Check the tests"' },
        task: { type: 'string', description: 'What to do and what to report back' },
        read_only: { type: 'boolean', description: 'true: the helper may only look (read files, search), not change anything' },
        ...MODEL_CHOICE,
      }, ['title', 'task']),
      fn('start_session', 'Start a new chat nested under this one that works on a task by itself in the background, so this reply can go on. '
        + 'It can look and read, not change things. Check on it later with read_session.',
      { title: { type: 'string' }, task: { type: 'string' }, ...MODEL_CHOICE }, ['title', 'task']),
      fn('list_models', 'List the models you can give a helper or background chat, best first for each kind of work.'),
    );
  }
  return defs;
}

const prevDescribe = describeAgentTool;
export function describeTeamTool(name, args = {}) {
  const s = (v, n = 60) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
  switch (name) {
    case 'run_subagent': return `Helper "${s(args.title)}"`;
    case 'start_session': return `Start chat "${s(args.title)}"`;
    case 'list_sessions': return 'List chats';
    case 'list_models': return 'List models for helpers';
    case 'read_session': return 'Read another chat';
    case 'message_session': return `Message another chat: "${s(args.message)}"`;
    default: return prevDescribe(name, args);
  }
}

// ---- remembering and scheduling ----

export const MEMORY_TOOL_RISK = { remember: 'edit', schedule_task: 'edit', list_scheduled_tasks: 'read' };
Object.assign(AGENT_TOOL_RISK, MEMORY_TOOL_RISK);

export function memoryToolDefinitions({ memory = true } = {}) {
  return [
    ...(memory ? [fn('remember', 'Save a lasting fact about the person or their work to Bunny AI\'s memory, so every future chat knows it '
      + '(for example their name, preferences, or a project rule). Only when they ask you to remember something or say something clearly lasting.',
    { text: { type: 'string', description: 'One short sentence' } }, ['text'])] : []),
    fn('schedule_task', 'Set up a task Bunny AI runs on its own, again and again (for example "every morning, summarise my repos\' new issues"). '
      + 'Each run happens in a new chat with this model and the same tools while the app is open, in this folder if there is one.',
    { name: { type: 'string' }, prompt: { type: 'string', description: 'What to do each time, as a full instruction' },
      every_minutes: { type: 'integer', description: 'How often, in minutes (60 = hourly, 1440 = daily)' },
      may_change: { type: 'boolean', description: 'true only if each run must change files or run commands; otherwise runs may only look (search, read)' } }, ['name', 'prompt', 'every_minutes']),
    fn('list_scheduled_tasks', 'List the tasks Bunny AI runs on a schedule.'),
  ];
}

/** Settings → My Dear Bunny → Search and reference chats. */
export const CHAT_SEARCH_TOOL_RISK = { search_chats: 'read' };
Object.assign(AGENT_TOOL_RISK, CHAT_SEARCH_TOOL_RISK);
export function chatSearchToolDefinition() {
  return fn('search_chats', 'Search the person\'s past chats for relevant details (what was decided, built or said before). '
    + 'Returns matching chats with their ids and a snippet; read more of one with read_session.',
  { query: { type: 'string', description: 'Words to look for' } }, ['query']);
}

/** Details memory should not keep unless the person allows it (Settings → My Dear Bunny). */
export const SENSITIVE = /\b(health|ill(ness)?|disease|diagnos\w*|medic\w*|pregnan\w*|therap\w*|depress\w*|anxiety|religio\w*|church|mosque|temple|faith|pray\w*|politic\w*|vot(e|ing)|sexual\w*|gay|lesbian|transgender|salary|debt|income|bank account|password)\b/i;

const describeTeam = describeTeamTool;
export function describeAnyAgentTool(name, args = {}) {
  const s = (v, n = 60) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
  switch (name) {
    case 'remember': return `Remember: "${s(args.text)}"`;
    case 'schedule_task': return `Schedule "${s(args.name)}" every ${Math.round(Number(args.every_minutes) || 60)} min`;
    case 'list_scheduled_tasks': return 'List scheduled tasks';
    case 'ask_user': return `Asked: "${s(args.question, 80)}"`;
    case 'search_chats': return `Search past chats for "${s(args.query, 60)}"`;
    case 'move_to_new_chat': return `New chat: "${s(args.title, 60)}"`;
    case 'update_tasks': {
      const list = Array.isArray(args.tasks) ? args.tasks : [];
      return `Plan: ${list.filter((t) => t?.done).length} of ${list.length} done`;
    }
    default: return describeTeam(name, args);
  }
}

// ---- a task list the person watches ----

export const PLAN_TOOL_RISK = { update_tasks: 'own' };
Object.assign(AGENT_TOOL_RISK, PLAN_TOOL_RISK);

export function planToolDefinition() {
  return fn('update_tasks', 'Show the person your plan as a checklist under your reply, and keep it current: call it at the start of a job with several steps, '
    + 'then again as each step is done. Send the whole list each time.',
  { tasks: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' }, done: { type: 'boolean' } }, required: ['text'] } } }, ['tasks']);
}

/** The list as stored: at most 20 short steps. */
export const MAX_TASKS = 40; // W6-12: also the number sessions.js keeps
export function cleanTasks(tasks) {
  return (Array.isArray(tasks) ? tasks : []).slice(0, MAX_TASKS)
    .map((t) => ({ text: String(t?.text ?? t ?? '').replace(/\s+/g, ' ').trim().slice(0, 160), done: Boolean(t?.done) }))
    .filter((t) => t.text);
}

// ---- asking the person ----

export const NEW_CHAT_TOOL_RISK = { move_to_new_chat: 'own' };
Object.assign(AGENT_TOOL_RISK, NEW_CHAT_TOOL_RISK);

/** Settings → Code → "When you ask for an unrelated task": the request moves to a chat of its own. */
export function newChatToolDefinition() {
  return fn('move_to_new_chat', 'Move a request that is unrelated to this chat\'s work into a new chat of its own. '
    + 'Depending on the person\'s settings they are asked first, or the new chat starts at once. Give a short title and the request, complete enough to start from.',
  { title: { type: 'string', description: 'A short name for the new chat' }, message: { type: 'string', description: 'The request, as the first message of the new chat' } }, ['title', 'message']);
}

export const ASK_TOOL_RISK = { ask_user: 'own' };
Object.assign(AGENT_TOOL_RISK, ASK_TOOL_RISK);

export function askToolDefinition() {
  return fn('ask_user', 'Ask the person a question and wait for the answer, in this same reply. Use it when something is unclear, '
    + 'when there are real choices to make, or before doing something they may not want. '
    + 'Offer choices tailored to what you are working on together (their project, files and goal, not generic options): '
    + 'each with a one-line reason. Always mark exactly one choice recommended: the one you would pick for them, given what you know. '
    + 'They can always type their own answer instead.',
  {
    question: { type: 'string', description: 'One clear question' },
    choices: {
      type: 'array', description: 'Up to 6 answers to click, the recommended one first',
      items: { type: 'object', properties: {
        label: { type: 'string', description: 'The answer, a few words' },
        reason: { type: 'string', description: 'One line: why this fits what we are doing, or its trade-off' },
        recommended: { type: 'boolean', description: 'true for exactly one choice: the one you recommend' },
      }, required: ['label'] },
    },
    recommended: { type: 'string', description: 'The label of the choice you recommend (always give one when you offer choices)' },
    multiple: { type: 'boolean', description: 'true if they may pick more than one choice' },
    placeholder: { type: 'string', description: 'A hint for the typed answer, e.g. "Your colour"' },
  }, ['question']);
}

/**
 * The question as shown: trimmed, at most six choices, each { label, reason, recommended }
 * (plain strings are accepted too), the recommended one first.
 */
/**
 * W4-14c: does an ask_user question only ask the person to run commands (or paste output from a terminal) for Bunny?
 * English only, and narrow on purpose: a run word followed by commands, or a terminal named as the place.
 */
export function asksToRunCommands(q = {}) {
  const text = [q.question, ...(Array.isArray(q.choices) ? q.choices.map((c) => c?.label ?? c) : [])].join(' ');
  const verb = '(?:run|execute|paste|type|enter)';
  const place = '(?:in|into|using|from|on)\\s+(?:a\\s+|the\\s+|your\\s+)?(?:terminal|powershell|command prompt|cmd|shell|console)';
  // Only a hand-off to the person: "can you / please / you can / you need to" + a verb, "run this ... in your terminal", "paste the output".
  // Not a decision about what Bunny itself does ("Should I run the migration command now?", "Do you want me to run the commands now?").
  return new RegExp(`\\b(?:can|could|would|will) you (?:please )?${verb}\\b`, 'i').test(text)
    || new RegExp(`\\bplease ${verb}\\b`, 'i').test(text)
    || new RegExp(`\\byou (?:can|could|should|need to|must|have to|will need to) ${verb}\\b`, 'i').test(text)
    || new RegExp(`\\b${verb}\\b[^.?!\\n]{0,80}\\b${place}\\b`, 'i').test(text) && !/\b(?:me|I) (?:to )?(?:run|execute)\b/i.test(text)
    || /\bpaste\b[^.?!\n]{0,40}\b(?:output|results?|errors?)\b/i.test(text);
}

export function cleanQuestion(a = {}) {
  const choices = (Array.isArray(a.choices) ? a.choices : []).map((c) => (typeof c === 'string'
    ? { label: c.trim().slice(0, 120), reason: '', recommended: false }
    : { label: String(c?.label ?? '').trim().slice(0, 120), reason: String(c?.reason ?? '').trim().slice(0, 240), recommended: c?.recommended === true }))
    .filter((c) => c.label).slice(0, 6);
  // The recommendation may come as a label on the question, or marked on a choice.
  const named = String(a.recommended ?? '').trim().toLowerCase();
  if (named) for (const c of choices) if (c.label.toLowerCase() === named) c.recommended = true;
  let marked = false;
  for (const c of choices) { if (c.recommended && !marked) marked = true; else c.recommended = false; }
  choices.sort((x, y) => Number(y.recommended) - Number(x.recommended));
  return {
    question: String(a.question ?? '').trim().slice(0, 600),
    choices,
    multiple: a.multiple === true,
    placeholder: String(a.placeholder ?? '').slice(0, 80),
  };
}

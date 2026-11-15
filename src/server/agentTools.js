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
 * "build" always asks, whatever the mode, because it adds code that runs later.
 */

export const AGENT_TOOL_RISK = {
  create_artifact: 'own', update_artifact: 'own', request_capability: 'own',
  start_process: 'run', read_process: 'read', stop_process: 'read', list_processes: 'read',
  computer_screenshot: 'read', computer_click: 'run', computer_type: 'run', computer_key: 'run', computer_scroll: 'run',
  create_tool: 'build',
};

export const CAPABILITIES = {
  code_mode: 'Code mode: read and change files in a folder, and run commands and programs there',
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
    fn('start_process', 'Start a program that keeps running (a dev server, a watcher, a long build) in the workspace folder, as a PowerShell command. '
      + 'Waits a few seconds and returns its first output and id. Use run_command instead for commands that finish.',
    { command: { type: 'string' }, wait_seconds: { type: 'integer', description: '1 to 30, default 5' } }, ['command']),
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

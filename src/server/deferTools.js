/**
 * AGENT-FLOW F7: deferred tools with a tool search. It replaces PV-2's two meta-tools (list_connector_tools / call_connector_tool).
 *
 * Only when the full list would be over 40 tools or 30,000 characters of definitions do the "deferrable" tools (every connector tool, the Google and GitHub tools, search_chats and the
 * built tools) stop being sent. Their NAMES stay known to the model (one system line); their schemas are sent only after the model asks for them with find_tools. Loading is offering: a
 * tool that was not loaded in this reply is refused like any tool that was not offered, so "a tool that was not offered never runs" stays the single truth. Risk, cards, rules, the Plan
 * and device filters and the helpers' limits are untouched: this module only decides which definitions travel with a request, and it is given definitions that already passed them.
 *
 * Security F7-1..F7-4: what can be found is exactly what would have been sent with no deferral (the caller passes only those); the loaded set is one reply's own; descriptions from outside
 * are cut to 200 characters and cleaned; names must match ^[A-Za-z0-9_-]{1,64}$; results go in the tool result, never a system message; Quick ask is never deferred (the caller skips it).
 */
export const DEFER_COUNT = 40;
export const DEFER_CHARS = 30_000;
export const DEFER_MIN = 15; // fewer deferrable tools than this are always sent in full
export const FIND_LIMIT = 15;
export const NAMES_LINE_MAX = 3000;
export const SAFE_NAME = /^[A-Za-z0-9_-]{1,64}$/;

/** Text from outside (a connector's description): control characters gone, one line, at most `n` characters. */
export const clean = (t, n = 200) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function findToolsDefinition() {
  return {
    type: 'function',
    function: {
      name: 'find_tools',
      description: 'Look for tools that are not listed in full (their names are in the "Tools you can load" line). Give words to look for (query) or exact names (names). The tools found are loaded for the rest of this reply; then call them.',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for in the tool names and descriptions' }, names: { type: 'array', items: { type: 'string' }, description: 'Exact tool names to load' } } },
    },
  };
}

const sizeOf = (defs) => JSON.stringify(defs).length;

/**
 * @param {object[]} definitions every tool definition for this reply (after the mode, device and capability filters)
 * @param {(name: string) => string|null} sourceOf the label of a deferrable tool ("GitHub", "Notion (connector)"), or null for a core tool
 * @returns {{ core: object[], deferred: Map<string, { def: object, source: string }> } | null} null when nothing is deferred (small setups behave exactly as before)
 */
export function splitDeferred(definitions, sourceOf) {
  const core = [];
  const deferred = new Map();
  for (const def of definitions) {
    const name = def?.function?.name;
    const source = SAFE_NAME.test(String(name ?? '')) ? sourceOf(name) : null;
    if (source) deferred.set(name, { def, source: clean(source, 60) });
    else core.push(def);
  }
  // Over 40 tools in all, or 30,000 characters: but the size that counts is the DEFERRABLE tools' own (PV-2's lesson: a big built-in set, such as Code mode's, must not hide a small
  // connector), so a handful of deferrable tools is always sent in full.
  const share = [...deferred.values()].map((d) => d.def);
  const tooMany = definitions.length > DEFER_COUNT && deferred.size > DEFER_MIN;
  const tooBig = sizeOf(share) > DEFER_CHARS;
  if (!deferred.size || !(tooMany || tooBig)) return null;
  core.push(findToolsDefinition());
  return { core, deferred };
}

/** The one system line that names what can be loaded, grouped by source, cut at 3,000 characters. */
export function namesLine(deferred) {
  const groups = new Map();
  for (const [name, { source }] of deferred) { if (!groups.has(source)) groups.set(source, []); groups.get(source).push(name); }
  const head = 'Tools you can load with find_tools (their definitions are not sent until you do): ';
  let text = head;
  let shown = 0;
  for (const [source, names] of groups) {
    const piece = `${text === head ? '' : '; '}${source}: `;
    if (text.length + piece.length > NAMES_LINE_MAX) break;
    text += piece;
    for (let i = 0; i < names.length; i += 1) {
      const add = `${i ? ', ' : ''}${names[i]}`;
      if (text.length + add.length > NAMES_LINE_MAX - 40) break;
      text += add; shown += 1;
    }
  }
  const more = deferred.size - shown;
  return more > 0 ? `${text}; and ${more} more: use find_tools` : text;
}

/**
 * find_tools: up to 15 matching tools (words ANDed over name and description, case-insensitive) or exact names. Returns { text, defs }: the text goes in the tool result, the defs are
 * the definitions to add to this reply's tool list. `allowed(name)` is the caller's check again at call time (Plan, device, scope), so a tool that stopped being allowed is not loaded.
 */
export function findTools(deferred, args = {}, { allowed = () => true, already = () => false } = {}) {
  const names = Array.isArray(args.names) ? args.names.map(String).filter((n) => SAFE_NAME.test(n)).slice(0, FIND_LIMIT) : [];
  const words = String(args.query ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
  const picked = [];
  const unknown = [];
  for (const n of names) {
    const hit = deferred.get(n);
    if (hit && allowed(n)) picked.push([n, hit]); else unknown.push(n);
  }
  if (words.length) {
    for (const [n, hit] of deferred) {
      if (picked.length >= FIND_LIMIT) break;
      if (picked.some(([p]) => p === n) || !allowed(n)) continue;
      const hay = `${n} ${hit.def.function.description ?? ''}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) picked.push([n, hit]);
    }
  }
  const lines = picked.map(([n, hit]) => `${n} (${hit.source}${already(n) ? ', already loaded' : ''}): ${clean(hit.def.function.description, 200) || '(no description)'}`);
  let text = lines.length ? `Loaded for this reply, call them now:\n${lines.join('\n')}` : 'No tool matches. Try other words, or check the names in the "Tools you can load" line.';
  if (unknown.length) text += `\nNot found: ${unknown.join(', ')}.`;
  return { text, defs: picked.map(([, hit]) => hit.def) };
}

/**
 * App tools: what the model can do with Bunny AI itself and the web, in every mode.
 *   read  - web_search, read_url, search_plugins, read_skill
 *   edit  - install_plugin, add_skill, add_connector   (follow the permission mode)
 */
import { readGithubPlugin, readUrl, searchPlugins } from './pluginImport.js';
import { checkProposedCommand, LOCAL_COMMANDS } from './mcpLocal.js';

export const APP_TOOL_RISK = {
  web_search: 'read', read_url: 'read', search_plugins: 'read', read_skill: 'read',
  install_plugin: 'edit', add_skill: 'edit', add_connector: 'edit',
};

export function appToolDefinitions(risks = ['read', 'edit']) {
  const fn = (name, description, properties, required) => ({
    type: 'function',
    function: { name, description, parameters: { type: 'object', properties, required } },
  });
  return [
    fn('web_search', 'Search the web. Returns titles, links and snippets. Use read_url to read a result.',
      { query: { type: 'string' } }, ['query']),
    fn('read_url', 'Read a web page as text. A github.com/owner/repo link reads its README.',
      { url: { type: 'string' } }, ['url']),
    fn('search_plugins', 'Find agent plugins and skills on GitHub, and connectors (MCP servers) in the official MCP registry.',
      { query: { type: 'string', description: 'What the plugin, skill or connector should do' } }, ['query']),
    fn('read_skill', 'Load the instructions of a switched-on skill by name. A long skill comes in parts of about 8,000 characters: the answer says "part 1 of 5"; ask again with part 2, 3 ... until you have read all of it.',
      { name: { type: 'string' }, part: { type: 'integer', description: 'Which part of a long skill (starts at 1)' } }, ['name']),
    fn('install_plugin', 'Install a plugin from a GitHub repository link: adds its skills and remote connectors to Bunny AI and switches them on.',
      { url: { type: 'string' } }, ['url']),
    fn('add_skill', 'Add a skill (instructions the model follows) to Bunny AI and switch it on.',
      { name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' } }, ['name', 'instructions']),
    fn('add_connector', 'Add an MCP server to Bunny AI as a connector and switch it on: a remote one by its https address, '
      + `or a local one by the program that runs it (one of ${LOCAL_COMMANDS.join(', ')}; for example command "npx", args ["-y", "@modelcontextprotocol/server-filesystem", "C:\\notes"]). `
      + 'The person always sees the exact command line on a card and confirms it before anything runs. The first start can take a few minutes.',
      { name: { type: 'string' }, url: { type: 'string', description: 'For a remote connector' },
        command: { type: 'string', description: 'For a local connector: the program to run' },
        args: { type: 'array', items: { type: 'string' }, description: 'Its arguments' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Not for secrets: keys and passwords are never taken through the chat. Tell the person to add them in Settings, Customize.' } }, ['name']),
  ].filter((d) => risks.includes(APP_TOOL_RISK[d.function.name]));
}

export function describeAppTool(name, args = {}) {
  switch (name) {
    case 'web_search': return `Search the web for "${String(args.query ?? '').slice(0, 80)}"`;
    case 'read_url': return `Read ${String(args.url ?? '').slice(0, 100)}`;
    case 'search_plugins': return `Search plugins for "${String(args.query ?? '').slice(0, 80)}"`;
    case 'read_skill': return `Load skill ${args.name}`;
    case 'install_plugin': return `Install plugin ${args.url}`;
    case 'add_skill': return `Add skill ${args.name}`;
    case 'add_connector': return `Add connector ${args.name}`;
    default: return name;
  }
}

/** DuckDuckGo's HTML endpoint: no key, plain results. */
async function webSearch(query, fetchImpl = globalThis.fetch) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('web_search needs a query');
  const res = await fetchImpl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) bunny-ai', accept: 'text/html' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`The search answered ${res.status}`);
  const html = await res.text();
  const strip = (t) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  for (let m = re.exec(html); m && out.length < 8; m = re.exec(html)) {
    let link = m[1];
    const real = /[?&]uddg=([^&]+)/.exec(link);
    if (real) link = decodeURIComponent(real[1]);
    if (link.startsWith('//')) link = `https:${link}`;
    out.push(`- ${strip(m[2])}\n  ${link}\n  ${strip(m[3] ?? '').slice(0, 220)}`);
  }
  return out.length ? out.join('\n') : 'No results.';
}

/**
 * @param {{ skills: any, mcp: any, getSettings: () => any, saveSettings: (patch: object) => Promise<any> }} deps
 */
export function createAppTools({ skills, mcp, getSettings, saveSettings, stopConnector = async () => {}, signOutConnector = async () => {}, fetchImpl = globalThis.fetch }) {
  // W4-10: install and uninstall run one at a time on the server, from the server's own list. Two quick clicks (or a click
  // and the model) can no longer both read the same list and overwrite each other, which left parts nobody owned.
  let queue = Promise.resolve();
  const serial = (job) => { const next = queue.then(job, job); queue = next.catch(() => {}); return next; };

  const findInstalled = (name, source) => (getSettings().plugins ?? []).find((p) => (source ? p.source === source : !p.source && p.name === name));

  async function removeParts(record) {
    for (const id of record.connectors ?? []) {
      // W3-6: a remote connector's sign-in ends with it, as when the connector itself is deleted, so no stored token is left behind.
      const leaving = await mcp.get?.(id);
      if (leaving && leaving.type !== 'local') await signOutConnector(leaving).catch(() => {});
      await stopConnector(id).catch(() => {});
      await mcp.remove(id);
    }
    for (const id of record.skills ?? []) await skills.remove(id);
  }

  /** Add the parts of a plugin and write down what was added. A plugin that is already installed is refused, never added twice. */
  function installParts(plugin, source, { off = false } = {}) {
    return serial(async () => {
      if (findInstalled(plugin.name, source)) throw Object.assign(new Error(`${plugin.name} is already installed. Uninstall it first to install it again.`), { code: 'plugin.installed' });
      const record = { id: crypto.randomUUID(), name: plugin.name, description: plugin.description, ...(source ? { source } : {}), connectors: [], skills: [] };
      try {
        for (const s of plugin.skills ?? []) record.skills.push((await skills.add({ ...s, enabled: !off })).id);
        for (const c of plugin.connectors ?? []) {
          try { record.connectors.push((await mcp.add({ ...c, enabled: off ? false : c.enabled !== false })).id); } catch (err) { if (err.code !== 'mcp.duplicate') throw err; /* already a connector: it is used as it is, and not owned by this plugin */ }
        }
      } catch (err) { // half an install is undone, so nothing is left behind
        await removeParts(record);
        throw err;
      }
      await saveSettings({ plugins: [...(getSettings().plugins ?? []), record] });
      return record;
    });
  }

  async function installFromGithub(url, { off = false } = {}) {
    const plugin = await readGithubPlugin(url, { fetchImpl });
    const record = await installParts(plugin, plugin.source, { off });
    return { record, plugin };
  }

  /**
   * P-6: what the MODEL adds (install_plugin, add_connector with an address) arrives switched OFF, in every permission mode: the skill text of a
   * stranger's repository would otherwise ride in front of every later reply, and a remote address would start receiving the person's requests.
   * What was added is remembered here so the chat can show one card; only the window answers it, and switchOn is what a yes does.
   */
  let pending = null;
  const takePending = () => { const p = pending; pending = null; return p; };
  async function switchOn(p) {
    for (const id of p?.skillIds ?? []) await skills.update(id, { enabled: true }).catch(() => {});
    for (const id of p?.connectorIds ?? []) await mcp.update(id, { enabled: true }).catch(() => {});
  }

  /** What install_plugin would add, in plain words, for the card shown before installing in Ask and Manual. */
  async function previewPlugin(url) {
    try {
      const plugin = await readGithubPlugin(url, { fetchImpl });
      return describePlugin(plugin);
    } catch (err) {
      return `Could not read that repository yet: ${String(err.message).slice(0, 200)}`;
    }
  }
  const describePlugin = (plugin) => [
    `Plugin ${plugin.name}${plugin.description ? `: ${plugin.description}` : ''}`,
    ...(plugin.skills ?? []).map((s) => `Skill ${s.name} (${String(s.instructions ?? '').length} characters of instructions): ${s.description || '(no description)'}`),
    ...(plugin.connectors ?? []).map((c) => `Connector ${c.name}: ${c.url}`),
    ...(plugin.skipped?.length ? [`Not imported: ${plugin.skipped.join('; ')}`] : []),
    'It is added switched OFF. You decide afterwards whether to switch it on.',
  ].join('\n').slice(0, 1800);

  /** A plugin from a file or the catalog: { name, description, connectors: [{name, url}], skills: [{name, description, instructions}] }. */
  async function installBundle(bundle) {
    const name = String(bundle?.name ?? '').trim();
    if (!name) throw Object.assign(new Error('A plugin needs a name'), { code: 'plugin.nameRequired' });
    return installParts({
      name: name.slice(0, 60),
      description: String(bundle.description ?? '').slice(0, 200),
      connectors: (bundle.connectors ?? []).map((c) => ({ name: c.name, url: c.url })),
      skills: (bundle.skills ?? []).map((s) => ({ name: s.name, description: s.description ?? '', instructions: s.instructions })),
    }, null);
  }

  /** Remove a plugin and what it added, from the server's own list. A part that is already gone does not stop the rest. */
  function uninstall(id) {
    return serial(async () => {
      const record = (getSettings().plugins ?? []).find((p) => p.id === id);
      if (!record) return { ok: false, removed: 0 };
      await removeParts(record);
      await saveSettings({ plugins: (getSettings().plugins ?? []).filter((p) => p.id !== id) });
      return { ok: true, removed: (record.connectors?.length ?? 0) + (record.skills?.length ?? 0) };
    });
  }

  const run = {
    web_search: ({ query }) => webSearch(query),
    read_url: ({ url }) => readUrl(url),
    search_plugins: ({ query }) => searchPlugins(query),
    read_skill: async ({ name, part }) => {
      const skill = await skills.find(name);
      // S-6: a skill that is switched off, or all skills switched off, cannot be read either
      if (!skill || skill.enabled === false || getSettings().skillsEnabled === false) throw new Error(`There is no skill called ${name}`);
      const text = String(skill.instructions ?? '');
      const SIZE = 8000;
      if (text.length <= SIZE) return text;
      const total = Math.ceil(text.length / SIZE);
      const at = Math.min(Math.max(1, Math.floor(Number(part) || 1)), total);
      const slice = text.slice((at - 1) * SIZE, at * SIZE);
      return `[Skill ${skill.name}, part ${at} of ${total}]\n${slice}\n[${at < total ? `Call read_skill again with part ${at + 1} to carry on.` : 'That was the last part.'}]`;
    },
    install_plugin: async ({ url }) => {
      const { plugin, record } = await installFromGithub(url, { off: true });
      pending = { title: plugin.name, text: describePlugin(plugin), skillIds: record.skills, connectorIds: record.connectors };
      return `Installed ${plugin.name}: ${plugin.skills.length} skill(s) [${plugin.skills.map((s) => s.name).join(', ')}], `
        + `${plugin.connectors.length} connector(s). They are switched OFF until the person says to switch them on (they were just asked); they appear in Settings, Customize.`
        + (plugin.skipped.length ? ` Not imported: ${plugin.skipped.join('; ')}.` : '');
    },
    add_skill: async (args) => `Added skill ${(await skills.add({ ...args, enabled: true })).name}. It is switched on.`,
    add_connector: async (args) => {
      if (String(args.command ?? '').trim()) {
        // A local connector proposed by the model: a known program, separate arguments, and no secrets through the chat.
        const checked = checkProposedCommand(args.command, args.args);
        if (args.env && typeof args.env === 'object' && Object.keys(args.env).length) {
          throw new Error('Keys and passwords are not taken through the chat. Add the connector without settings and ask the person to enter them in Settings, Customize.');
        }
        args = { ...args, ...checked, env: {} };
      }
      // P-6: a remote address the model proposes is added switched OFF; the person is asked, and only the window can switch it on
      const remote = !String(args.command ?? '').trim();
      const added = await mcp.add({ name: args.name, url: args.url, command: args.command, args: args.args, env: args.env, enabled: !remote });
      if (remote) {
        pending = { title: added.name, text: `Connector ${added.name}: ${added.url}\nIt is added switched OFF. Its tools reach the model only after you switch it on.`, skillIds: [], connectorIds: [added.id] };
        return `Added the remote connector ${added.name} (${added.url}). It is switched OFF until the person says to switch it on (they were just asked).`;
      }
      return `Added the local connector ${added.name}. It is switched on; its tools are offered from the next message.`;
    },
  };

  return {
    has: (name) => Object.hasOwn(run, name),
    run: (name, args) => run[name](args ?? {}),
    installFromGithub,
    installBundle,
    uninstall,
    takePending,
    switchOn,
    previewPlugin,
  };
}

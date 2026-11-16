/**
 * App tools: what the model can do with Bunny AI itself and the web, in every mode.
 *   read  - web_search, read_url, search_plugins, read_skill
 *   edit  - install_plugin, add_skill, add_connector   (follow the permission mode)
 */
import { readGithubPlugin, readUrl, searchPlugins } from './pluginImport.js';

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
    fn('read_skill', 'Load the full instructions of a switched-on skill by name.',
      { name: { type: 'string' } }, ['name']),
    fn('install_plugin', 'Install a plugin from a GitHub repository link: adds its skills and remote connectors to Bunny AI and switches them on.',
      { url: { type: 'string' } }, ['url']),
    fn('add_skill', 'Add a skill (instructions the model follows) to Bunny AI and switch it on.',
      { name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' } }, ['name', 'instructions']),
    fn('add_connector', 'Add an MCP server to Bunny AI as a connector and switch it on: a remote one by its https address, '
      + 'or a local one by the command that runs it (for example command "npx", args ["-y", "@modelcontextprotocol/server-filesystem", "C:\\notes"]). The person always confirms a local command.',
      { name: { type: 'string' }, url: { type: 'string', description: 'For a remote connector' },
        command: { type: 'string', description: 'For a local connector: the program to run' },
        args: { type: 'array', items: { type: 'string' }, description: 'Its arguments' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Settings it needs, such as an API key name and value' } }, ['name']),
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
  function installParts(plugin, source) {
    return serial(async () => {
      if (findInstalled(plugin.name, source)) throw Object.assign(new Error(`${plugin.name} is already installed. Uninstall it first to install it again.`), { code: 'plugin.installed' });
      const record = { id: crypto.randomUUID(), name: plugin.name, description: plugin.description, ...(source ? { source } : {}), connectors: [], skills: [] };
      try {
        for (const s of plugin.skills ?? []) record.skills.push((await skills.add({ ...s, enabled: true })).id);
        for (const c of plugin.connectors ?? []) record.connectors.push((await mcp.add({ ...c, enabled: true })).id);
      } catch (err) { // half an install is undone, so nothing is left behind
        await removeParts(record);
        throw err;
      }
      await saveSettings({ plugins: [...(getSettings().plugins ?? []), record] });
      return record;
    });
  }

  async function installFromGithub(url) {
    const plugin = await readGithubPlugin(url, { fetchImpl });
    const record = await installParts(plugin, plugin.source);
    return { record, plugin };
  }

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
    read_skill: async ({ name }) => {
      const skill = await skills.find(name);
      if (!skill) throw new Error(`There is no skill called ${name}`);
      return skill.instructions.slice(0, 60_000);
    },
    install_plugin: async ({ url }) => {
      const { plugin } = await installFromGithub(url);
      return `Installed ${plugin.name}: ${plugin.skills.length} skill(s) [${plugin.skills.map((s) => s.name).join(', ')}], `
        + `${plugin.connectors.length} connector(s). They are switched on and appear in Settings, Customize.`
        + (plugin.skipped.length ? ` Not imported: ${plugin.skipped.join('; ')}.` : '');
    },
    add_skill: async (args) => `Added skill ${(await skills.add({ ...args, enabled: true })).name}. It is switched on.`,
    add_connector: async (args) => {
      const added = await mcp.add({ name: args.name, url: args.url, command: args.command, args: args.args, env: args.env, enabled: true });
      return `Added the ${added.type === 'local' ? 'local' : 'remote'} connector ${added.name}. It is switched on; its tools are offered from the next message.`;
    },
  };

  return {
    has: (name) => Object.hasOwn(run, name),
    run: (name, args) => run[name](args ?? {}),
    installFromGithub,
    installBundle,
    uninstall,
  };
}

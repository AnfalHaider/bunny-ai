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
    fn('add_connector', 'Add a remote MCP server (https address) to Bunny AI as a connector and switch it on.',
      { name: { type: 'string' }, url: { type: 'string' } }, ['name', 'url']),
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
export function createAppTools({ skills, mcp, getSettings, saveSettings }) {
  async function installFromGithub(url) {
    const plugin = await readGithubPlugin(url);
    const record = { id: crypto.randomUUID(), name: plugin.name, description: plugin.description, source: plugin.source, connectors: [], skills: [] };
    for (const s of plugin.skills) record.skills.push((await skills.add({ ...s, enabled: true })).id);
    for (const c of plugin.connectors) record.connectors.push((await mcp.add({ ...c, enabled: true })).id);
    await saveSettings({ plugins: [...(getSettings().plugins ?? []), record] });
    return { record, plugin };
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
        + (plugin.skipped.length ? ` Not imported (built for other apps): ${plugin.skipped.join(', ')}.` : '');
    },
    add_skill: async (args) => `Added skill ${(await skills.add({ ...args, enabled: true })).name}. It is switched on.`,
    add_connector: async (args) => `Added connector ${(await mcp.add({ ...args, enabled: true })).name}. It is switched on; its tools load the next time it is tested in Settings, Customize.`,
  };

  return {
    has: (name) => Object.hasOwn(run, name),
    run: (name, args) => run[name](args ?? {}),
    installFromGithub,
  };
}

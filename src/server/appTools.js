/**
 * App tools: what the model can do with Bunny AI itself and the web, in every mode.
 *   read  - web_search, read_url, search_plugins, read_skill
 *   edit  - install_plugin, add_skill, add_connector   (follow the permission mode)
 */
import { parseGithubUrl, readGithubPlugin, readUrl, searchPlugins } from './pluginImport.js';
import { bunnyText } from './bunnyText.js';
import { checkProposedCommand, LOCAL_COMMANDS } from './mcpLocal.js';
import { inScope } from './scope.js';

export const APP_TOOL_RISK = {
  web_search: 'read', read_url: 'read', search_plugins: 'read', read_skill: 'read',
  install_plugin: 'edit', add_skill: 'edit', add_connector: 'edit',
  install_from_github: 'build', // W6-6: runs code from the internet, so it is asked in EVERY mode (Auto too); Plan mode refuses it
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
    fn('search_plugins', "Find skills, plugins and connectors (MCP servers) for Bunny: a short list of known connectors first, then GitHub, then the official MCP registry. A repository's name may mention another app; its skills, commands and connectors still work in Bunny.",
      { query: { type: 'string', description: 'What the plugin, skill or connector should do' } }, ['query']),
    fn('read_skill', 'Load the instructions of a switched-on skill by name (Bunny\'s own skills, whichever app they were first written for). A long skill comes in parts of about 8,000 characters: the answer says "part 1 of 5"; ask again with part 2, 3 ... until you have read all of it.',
      { name: { type: 'string' }, part: { type: 'integer', description: 'Which part of a long skill (starts at 1)' } }, ['name']),
    fn('install_plugin', 'Install a plugin from a GitHub repository link: adds its skills and remote connectors to Bunny AI switched OFF; the person is shown what was added and decides whether to switch them on.',
      { url: { type: 'string' } }, ['url']),
    fn('add_skill', 'Add a skill (instructions the model follows) to Bunny AI, switched OFF: the person is shown the whole text (at most about 1,500 characters) and decides whether to switch it on.',
      { name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' } }, ['name', 'instructions']),
    fn('add_connector', 'Add an MCP server to Bunny AI as a connector: a remote one by its https address (added switched OFF until the person says yes), '
      + `or a local one by the program that runs it (one of ${LOCAL_COMMANDS.join(', ')}; for example command "npx", args ["-y", "@modelcontextprotocol/server-filesystem", "C:\\notes"]). `
      + 'The person always sees the exact command line on a card and confirms it before anything runs. The first start can take a few minutes.',
      { name: { type: 'string' }, url: { type: 'string', description: 'For a remote connector' },
        command: { type: 'string', description: 'For a local connector: the program to run' },
        args: { type: 'array', items: { type: 'string' }, description: 'Its arguments' },
        env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Not for secrets: keys and passwords are never taken through the chat. Tell the person to add them in Settings, Customize.' },
        key_headers: { type: 'array', items: { type: 'string' }, description: 'For a remote connector that needs a key: the header NAMES its listing asks for (never a value). The person pastes the key themselves, in Settings, Customize, on that connector: never ask for it in the chat.' } }, ['name']),
    fn('install_from_github', 'Install a tool from a PUBLIC GitHub repository: an MCP server written in Node.js. The person sees a card first with the repository, the exact commit, the install command and "This runs code from the internet on this computer", and must say yes. It is installed into Bunny AI\'s own tools folder at that commit, npm install scripts are NOT run, and it is added as a connector. Use add_connector instead for a server that npx can run, and install_plugin for skills.',
      { repo: { type: 'string', description: 'owner/name or a github.com link' } }, ['repo']),
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
    case 'install_from_github': return `Install tool ${String(args.repo ?? '').slice(0, 100)} from GitHub`;
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
  const strip = (t) => t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); // one line each: a title or snippet written by a page can never start a line of its own
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  for (let m = re.exec(html); m && out.length < 8; m = re.exec(html)) {
    let link = m[1];
    const real = /[?&]uddg=([^&]+)/.exec(link);
    if (real) link = decodeURIComponent(real[1]);
    if (link.startsWith('//')) link = `https:${link}`;
    if (/[\s\u0000-\u001f\u007f]/.test(link)) continue; // a link with a line break or a space in it is not a link Bunny lists
    out.push(`- ${strip(m[2])}\n  ${link}\n  ${strip(m[3] ?? '').slice(0, 220)}`);
  }
  return out.length ? out.join('\n') : 'No results.';
}

/**
 * @param {{ skills: any, mcp: any, getSettings: () => any, saveSettings: (patch: object) => Promise<any> }} deps
 */
export function createAppTools({ toolInstaller = null, skills, mcp, getSettings, saveSettings, stopConnector = async () => {}, signOutConnector = async () => {}, getGithubToken = async () => null, fetchImpl = globalThis.fetch }) {
  // W4-10: install and uninstall run one at a time on the server, from the server's own list. Two quick clicks (or a click
  // and the model) can no longer both read the same list and overwrite each other, which left parts nobody owned.
  let queue = Promise.resolve();
  const serial = (job) => { const next = queue.then(job, job); queue = next.catch(() => {}); return next; };

  // The same repository is the same plugin however its address was spelled: letters in any case, www, http, .git, a trailing slash, a /tree/branch address.
  const repoKey = (source) => { const g = parseGithubUrl(source); return g ? `${g.owner}/${g.repo}`.toLowerCase() : String(source ?? '').trim().toLowerCase().replace(/\/+$/, ''); };
  const findInstalled = (name, source) => (getSettings().plugins ?? []).find((p) => (source ? p.source && repoKey(p.source) === repoKey(source) : !p.source && String(p.name).trim().toLowerCase() === String(name).trim().toLowerCase()));

  /** G11: is this connector still named by another installed plugin? Then it stays. */
  const usedByAnother = (connectorId, pluginId) => (getSettings().plugins ?? []).some((p) => p.id !== pluginId && ((p.connectors ?? []).includes(connectorId) || (p.uses ?? []).includes(connectorId)));
  /** G11: a connector that stays because another plugin counts on it becomes that plugin's own, so removing that plugin later removes it. */
  async function handOver(connectorId, fromId) {
    const plugins = (getSettings().plugins ?? []).map((p) => (p.id !== fromId && (p.uses ?? []).includes(connectorId) && !(p.connectors ?? []).includes(connectorId)
      ? { ...p, connectors: [...(p.connectors ?? []), connectorId], uses: p.uses.filter((u) => u !== connectorId) } : p));
    await saveSettings({ plugins });
  }

  async function removeParts(record) {
    for (const id of record.connectors ?? []) {
      if (usedByAnother(id, record.id)) { await handOver(id, record.id); continue; } // G11
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
      const record = { id: crypto.randomUUID(), name: plugin.name, description: plugin.description, ...(source ? { source } : {}), connectors: [], uses: [], skills: [] };
      try {
        for (const s of plugin.skills ?? []) record.skills.push((await skills.add({ ...s, enabled: !off })).id);
        for (const c of plugin.connectors ?? []) {
          try { record.connectors.push((await mcp.add({ ...c, enabled: off ? false : c.enabled !== false })).id); } catch (err) { if (err.code !== 'mcp.duplicate') throw err; /* already a connector: it is used as it is, and not owned by this plugin */ if (err.existing) record.uses.push(err.existing); /* G11: but this plugin counts on it */ }
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
  const pendingByChat = new Map(); // P6-2: one chat's card is never shown in another chat
  const keep = (ctx, p) => { pendingByChat.set(String(ctx?.chatId ?? ''), p); };
  const takePending = (chatId = '') => { const key = String(chatId ?? ''); const p = pendingByChat.get(key) ?? null; pendingByChat.delete(key); return p; };
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
    `Plugin ${plugin.name}${plugin.description ? `: ${bunnyText(plugin.description)}` : ''}`,
    ...(plugin.skills ?? []).map((s) => `Skill ${s.name} (${String(s.instructions ?? '').length} characters of instructions): ${bunnyText(s.description) || '(no description)'}`),
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

  /**
   * P-4: read the plugin's source again and bring what it owns up to date. A skill with the same name is updated where it is (its on or off state stays);
   * a new skill is added (on only if all the plugin's skills were on); a skill that is gone from the source is removed. A connector at the same address is
   * kept as it is (its trust and sign-in stay); a new connector is added switched OFF, whatever the plugin's state (an update never switches a connector on);
   * one that is gone from the source is removed. The person's own other skills and connectors are never touched.
   */
  function updatePlugin(id) {
    return serial(async () => {
      const record = (getSettings().plugins ?? []).find((p) => p.id === id);
      if (!record) return { ok: false, code: 'plugin.notFound', message: 'No such plugin' };
      if (!record.source) return { ok: false, code: 'plugin.noSource', message: 'This plugin came from a file, so there is nowhere to update it from.' };
      const plugin = await readGithubPlugin(record.source, { fetchImpl });
      const norm = (x) => String(x ?? '').trim().toLowerCase();
      const allSkills = typeof skills.list === 'function' ? await skills.list() : [];
      const ownedSkills = (record.skills ?? []).map((sid) => allSkills.find((s) => s.id === sid)).filter(Boolean);
      const wasOn = ownedSkills.length > 0 && ownedSkills.every((s) => s.enabled !== false);
      const next = { skills: [], connectors: [] };
      const done = { skillsUpdated: 0, skillsAdded: 0, skillsRemoved: 0, connectorsKept: 0, connectorsAdded: 0, connectorsRemoved: 0 };
      const keepSkill = new Set();
      const switchedOff = [];
      for (const s of plugin.skills ?? []) {
        const same = ownedSkills.find((o) => norm(o.name) === norm(s.name) && !keepSkill.has(o.id));
        if (same) {
          // P4-1: a skill that is ON and whose instructions changed does not stay on silently: new words from the source are the person's to look at first
          // exact words, not folded: a change of case ("do NOT" to "do not") or of the description (which also reaches the model) is a change; only line endings and the ends are ignored
          const exact = (x) => String(x ?? '').replace(/\r\n/g, '\n').trim();
          const changed = exact(same.instructions) !== exact(s.instructions) || exact(same.description) !== exact(s.description);
          const patch = { description: s.description ?? '', instructions: s.instructions, folders: record.folders ?? [] }; // W616-1: the plugin's folders stay on its parts
          if (changed && same.enabled !== false) { patch.enabled = false; switchedOff.push(same.name); }
          await skills.update(same.id, patch);
          keepSkill.add(same.id); next.skills.push(same.id); done.skillsUpdated += 1;
        } else {
          // P4-1: new words from the source are the person's to look at first, so a NEW skill arrives OFF too, whatever the plugin's state, and is listed
          const added = await skills.add({ ...s, enabled: false, folders: record.folders ?? [] }); // W616-1: a new part is limited like the rest of the plugin
          switchedOff.push(s.name);
          next.skills.push(added.id); done.skillsAdded += 1;
        }
      }
      for (const o of ownedSkills) if (!keepSkill.has(o.id)) { await skills.remove(o.id); done.skillsRemoved += 1; }
      const allConnectors = typeof mcp.list === 'function' ? await mcp.list() : [];
      const ownedConnectors = (record.connectors ?? []).map((cid) => allConnectors.find((c) => c.id === cid)).filter(Boolean);
      const keepConnector = new Set();
      for (const c of plugin.connectors ?? []) {
        const same = ownedConnectors.find((o) => norm(o.url).replace(/\/+$/, '') === norm(c.url).replace(/\/+$/, ''));
        if (same) { keepConnector.add(same.id); next.connectors.push(same.id); done.connectorsKept += 1; if ((record.folders ?? []).length || (same.folders ?? []).length) await mcp.update(same.id, { folders: record.folders ?? [] }); continue; }
        try {
          const added = await mcp.add({ ...c, enabled: false, folders: record.folders ?? [] }); // W616-1
          next.connectors.push(added.id); done.connectorsAdded += 1;
        } catch (err) { if (err.code !== 'mcp.duplicate') throw err; /* already a connector of the person's own: left as it is */ }
      }
      for (const o of ownedConnectors) {
        if (keepConnector.has(o.id)) continue;
        if (usedByAnother(o.id, id)) { done.connectorsKept += 1; continue; } // G11: another plugin still uses it
        await stopConnector(o.id).catch(() => {});
        if (o.type !== 'local') await signOutConnector(o).catch(() => {});
        await mcp.remove(o.id);
        done.connectorsRemoved += 1;
      }
      const plugins = (getSettings().plugins ?? []).map((p) => (p.id === id
        ? { ...p, name: plugin.name, description: plugin.description, skills: next.skills, connectors: next.connectors, updatedAt: new Date().toISOString() } : p));
      await saveSettings({ plugins });
      const message = switchedOff.length ? `${switchedOff.length} new or changed skill${switchedOff.length === 1 ? '' : 's'} ${switchedOff.length === 1 ? 'is' : 'are'} off (${switchedOff.join(', ')}); switch ${switchedOff.length === 1 ? 'it' : 'them'} on in Customize.` : '';
      return { ok: true, ...done, skillsSwitchedOff: switchedOff, message, skipped: plugin.skipped ?? [] };
    });
  }

  /** P-5: switch a plugin's skills and connectors on or off together. A part that is already gone is skipped. */
  function setEnabled(id, on) {
    return serial(async () => {
      const record = (getSettings().plugins ?? []).find((p) => p.id === id);
      if (!record) return { ok: false, changed: 0 };
      let changed = 0;
      for (const sid of record.skills ?? []) { if (await skills.update(sid, { enabled: Boolean(on) }).then(() => true, () => false)) changed += 1; }
      for (const cid of record.connectors ?? []) { if (await mcp.update(cid, { enabled: Boolean(on) }).then(() => true, () => false)) changed += 1; }
      return { ok: true, changed };
    });
  }

  /** W6-16: limit a plugin, and everything it added, to some folders (an empty list: everywhere). The route has already checked the folders. */
  function setFolders(id, folders) {
    return serial(async () => {
      const record = (getSettings().plugins ?? []).find((p) => p.id === id);
      if (!record) return { ok: false, changed: 0 };
      let changed = 0;
      for (const sid of record.skills ?? []) { if (await skills.update(sid, { folders }).then(() => true, () => false)) changed += 1; }
      for (const cid of record.connectors ?? []) { if (await mcp.update(cid, { folders }).then(() => true, () => false)) changed += 1; }
      await saveSettings({ plugins: (getSettings().plugins ?? []).map((p) => (p.id === id ? { ...p, folders } : p)) });
      return { ok: true, changed };
    });
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
    search_plugins: async ({ query }) => searchPlugins(query, { fetchImpl, githubToken: await getGithubToken().catch(() => null) }),
    read_skill: async ({ name, part }, ctx) => {
      const skill = await skills.find(name);
      // S-6: a skill that is switched off, or all skills switched off, cannot be read either
      // W6-16: nor one limited to other folders than this chat's (a chat with no folder gets only the skills for everywhere)
      if (!skill || skill.enabled === false || getSettings().skillsEnabled === false || !inScope(skill.folders, ctx?.folder ?? null)) throw new Error(`There is no skill called ${name}`);
      const text = bunnyText(String(skill.instructions ?? '')); // BRAND-BUNNY: said in Bunny's words; the stored text is untouched
      const SIZE = 8000;
      if (text.length <= SIZE) return text;
      const total = Math.ceil(text.length / SIZE);
      const at = Math.min(Math.max(1, Math.floor(Number(part) || 1)), total);
      const slice = text.slice((at - 1) * SIZE, at * SIZE);
      return `[Skill ${skill.name}, part ${at} of ${total}]\n${slice}\n[${at < total ? `Call read_skill again with part ${at + 1} to carry on.` : 'That was the last part.'}]`;
    },
    install_plugin: async ({ url }, ctx) => {
      const { plugin, record } = await installFromGithub(url, { off: true });
      keep(ctx, { title: plugin.name, text: describePlugin(plugin), skillIds: record.skills, connectorIds: record.connectors });
      return `Installed ${plugin.name}: ${plugin.skills.length} skill(s) [${plugin.skills.map((s) => s.name).join(', ')}], `
        + `${plugin.connectors.length} connector(s). They are switched OFF until the person says to switch them on (they were just asked); they appear in Settings, Customize.`
        + (plugin.skipped.length ? ` Not imported: ${plugin.skipped.join('; ')}.` : '');
    },
    // P6-1: a skill the model writes is text that rides in front of every later reply: it arrives OFF in every mode, the card shows ALL of it,
    // and one too long to show whole is refused.
    add_skill: async (args, ctx) => {
      const head = `Skill ${String(args.name ?? '').trim()}: ${String(args.description ?? '').trim()}\n\n`;
      const text = String(args.instructions ?? '').trim();
      const footer = '\n\nIt is added switched OFF.';
      const shownLength = String(args.name ?? '').trim().slice(0, 60).length + 1 + head.length + text.length + footer.length; // exactly what the card holds: title, a line break, the text and the footer
      if (shownLength > 1800) throw new Error(`That skill is too long to show you whole (${shownLength} characters; the limit is 1,800). Make it shorter.`);
      const added = await skills.add({ ...args, enabled: false });
      keep(ctx, { title: added.name, text: `${head}${text}${footer}`, skillIds: [added.id], connectorIds: [] });
      return `Added the skill ${added.name}. It is switched OFF until the person says to switch it on (they were just asked).`;
    },
    // W6-6: only with the commit the person was shown on the card (the route puts it in ctx); never without it
    install_from_github: async (args, ctx) => {
      if (!toolInstaller) throw new Error('Installing tools is not available.');
      return toolInstaller.install({ repo: args.repo, expectSha: ctx?.expectSha });
    },
    add_connector: async (args, ctx) => {
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
      const added = await mcp.add({ name: args.name, url: args.url, command: args.command, args: args.args, env: args.env, enabled: !remote, ...(remote && args.key_headers ? { keyHeaders: args.key_headers } : {}) });
      if (remote) {
        keep(ctx, { title: added.name, text: `Connector ${added.name}: ${added.url}\nIt is added switched OFF. Its tools reach the model only after you switch it on.`, skillIds: [], connectorIds: [added.id] });
        return `Added the remote connector ${added.name} (${added.url}). It is switched OFF until the person says to switch it on (they were just asked).${added.keyHeaders?.length ? ` It needs a key (${added.keyHeaders.join(', ')}): tell the person to open Settings, Customize, this connector, Add key, and paste it there. Never ask for the key in the chat.` : ''}`;
      }
      return `Added the local connector ${added.name}. It is switched on; its tools are offered from the next message.`;
    },
  };

  return {
    has: (name) => Object.hasOwn(run, name),
    run: (name, args, ctx) => run[name](args ?? {}, ctx),
    installFromGithub,
    installBundle,
    uninstall,
    takePending,
    switchOn,
    setEnabled,
    setFolders,
    updatePlugin,
    previewPlugin,
  };
}

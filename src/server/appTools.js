/**
 * App tools: what the model can do with Bunny AI itself and the web, in every mode.
 *   read  - web_search, read_url, search_plugins, read_skill
 *   edit  - install_plugin, add_skill, add_connector   (follow the permission mode)
 */
import { describeNpm, discardNpm, installNpm, prepareNpm } from './npmSource.js';
import { describePypi, discardPypi, installPypi, preparePypi } from './pypiSource.js';
import { unpinnedPackage } from './pinning.js';
import { fetchLimited } from './download.js';
import { searchWeb } from './webSearch.js';
import { dirname, join } from 'node:path';
import { describeSource, discardSource, prepareSource, sourceKind, stillTheSame, CHANGED } from './installSource.js';
import { checkPublicAddress } from './publicFetch.js';
import { parseGithubUrl, readGithubPlugin, readUrl, resolveCommit, searchPlugins } from './pluginImport.js';
import { bunnyText } from './bunnyText.js';
import { checkProposedCommand, LOCAL_COMMANDS } from './mcpLocal.js';
import { inScope } from './scope.js';

export const APP_TOOL_RISK = {
  web_search: 'read', read_url: 'read', search_plugins: 'read', read_skill: 'read',
  install_plugin: 'build', install_skill: 'build', add_skill: 'edit', add_connector: 'edit', // INSTALL-ANYWHERE: an install is a build action: a card in every mode, never skipped by a rule, a kind or a judge, refused in Plan
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
    fn('install_plugin', 'Install a plugin from a GitHub repository link, or from an archive (.zip, .tar.gz, .tgz) at a public https address: adds its skills and remote connectors to Bunny AI switched OFF after the person has seen one card listing every part and the fingerprint of the source. Nothing in it runs.',
      { url: { type: 'string' } }, ['url']),
    fn('install_skill', 'Install a skill from a SKILL.md address, or an archive or GitHub repository that holds skills, at a public https address: the person sees one card with the source, its fingerprint and the skill text before anything is added. It arrives switched OFF.',
      { url: { type: 'string' } }, ['url']),
    fn('add_skill', 'Add a skill (instructions the model follows) to Bunny AI, switched OFF: the person is shown the whole text (at most about 1,500 characters) and decides whether to switch it on.',
      { name: { type: 'string' }, description: { type: 'string' }, instructions: { type: 'string' } }, ['name', 'instructions']),
    fn('add_connector', 'Add an MCP server to Bunny AI as a connector: a remote one by its https address (added switched OFF until the person says yes), '
      + `or a local one by the program that runs it (one of ${LOCAL_COMMANDS.join(', ')}; for example command "npx", args ["-y", "@modelcontextprotocol/server-filesystem", "C:\\notes"]). `
      + 'The person always sees the exact command line on a card and confirms it before anything runs. The first start can take a few minutes.',
      { name: { type: 'string' }, url: { type: 'string', description: 'For a remote connector' }, pypi: { type: 'string', description: 'For a local connector from PyPI: name==version (an exact version). Wheels only, all the way down; one card first' }, npm: { type: 'string', description: 'For a local connector from npm: name@version (an exact version, or latest). Bunny pins the version, installs the whole tree with no scripts, and shows it on one card first' },
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
    case 'install_skill': return `Install skill ${args.url}`;
    case 'add_skill': return `Add skill ${args.name}`;
    case 'add_connector': return `Add connector ${args.name}`;
    case 'install_from_github': return `Install tool ${String(args.repo ?? '').slice(0, 100)} from GitHub`;
    default: return name;
  }
}

/**
 * @param {{ skills: any, mcp: any, getSettings: () => any, saveSettings: (patch: object) => Promise<any> }} deps
 */
export function createAppTools({ toolInstaller = null, getSearchKey = async () => null, skills, mcp, getSettings, saveSettings, stopConnector = async () => {}, signOutConnector = async () => {}, getGithubToken = async () => null, fetchImpl = globalThis.fetch, workDir = null, fetchSource = undefined, checkAddress = undefined, gitOptions = undefined, npmDeps = undefined, pypiDeps = undefined, now = () => new Date() }) {
  // W4-10: install and uninstall run one at a time on the server, from the server's own list. Two quick clicks (or a click
  // and the model) can no longer both read the same list and overwrite each other, which left parts nobody owned.
  const startFetch = globalThis.fetch; // web_search reads globalThis.fetch at call time unless a test passed its own
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
  function installParts(plugin, source, { off = false, pin = null } = {}) {
    return serial(async () => {
      if (findInstalled(plugin.name, source)) throw Object.assign(new Error(`${plugin.name} is already installed. Uninstall it first to install it again.`), { code: 'plugin.installed' });
      const record = { id: crypto.randomUUID(), name: plugin.name, description: plugin.description, ...(source ? { source } : {}), ...(pin ? { pin } : {}), connectors: [], uses: [], skills: [] };
      try {
        for (const s of plugin.skills ?? []) record.skills.push((await skills.add({ ...s, enabled: !off })).id);
        for (const c of plugin.connectors ?? []) {
          try { record.connectors.push((await mcp.add({ ...c, addedBy: 'model', enabled: off ? false : c.enabled !== false })).id); } catch (err) { if (err.code !== 'mcp.duplicate') throw err; /* already a connector: it is used as it is, and not owned by this plugin */ if (err.existing) record.uses.push(err.existing); /* G11: but this plugin counts on it */ }
        }
      } catch (err) { // half an install is undone, so nothing is left behind
        await removeParts(record);
        throw err;
      }
      await saveSettings({ plugins: [...(getSettings().plugins ?? []), record] });
      return record;
    });
  }

  // INSTALL-ANYWHERE: a source that is not GitHub's (an archive, a SKILL.md) is fetched, pinned, unpacked and inspected ONCE for the card; the install then uses exactly that folder.
  const prepared = new Map(); // token -> prepared source (a temp folder under workDir)
  const known = new Map(); // chat -> the addresses the catalogues showed it (curated, GitHub, registry): anything else is "found on the open web"
  const sweep = async () => { for (const [t, p] of prepared) if (Date.now() - Date.parse(p.fetchedAt) > 30 * 60_000) { prepared.delete(t); await discardSource(p); } };
  // a GitHub link counts as known only when this chat's own catalogue results listed that repository (Security LOW: not every GitHub link is a catalogue link)
  const sourceKey = (url) => { const g = parseGithubUrl(url); return g ? `gh:${g.owner}/${g.repo}`.toLowerCase() : String(url).trim().toLowerCase().replace(/[.,;]+$/, '').replace(/\/+$/, ''); };
  const noteKnown = (chatId, text) => { const set = known.get(String(chatId ?? '')) ?? new Set(); for (const m of String(text).matchAll(/https:\/\/[^\s)>"']+/g)) set.add(sourceKey(m[0])); known.set(String(chatId ?? ''), set); };
  const isOpenWeb = (chatId, url) => !(known.get(String(chatId ?? ''))?.has(sourceKey(url)));
  async function prepareFromSource(url, chatId) {
    if (!workDir) throw new Error('Installing from an address is not available here.');
    await sweep();
    const src = await prepareSource(url, { workDir, ...(fetchSource ? { fetchSource } : {}), ...(checkAddress ? { checkAddress } : {}), ...(gitOptions ? { gitOptions } : {}), now });
    prepared.set(src.token, src);
    return { src, openWeb: isOpenWeb(chatId, url) };
  }
  // IA-2: a pinned npm connector: fetched, locked and installed into staging ONCE for the card; the yes moves exactly that tree
  const preparedNpm = new Map();
  const sweepNpm = async () => { for (const [k, p] of preparedNpm) if (now().getTime() - Date.parse(p.fetchedAt) > 30 * 60_000) { preparedNpm.delete(k); await discardNpm(p); } }; // a card nobody answered: its staging is deleted
  async function previewNpmCard(spec) {
    await sweepNpm();
    if (!workDir) return { ok: false, message: 'Installing from npm is not available here.' };
    try {
      const reg = npmDeps ?? {
        fetchJson: async (u) => JSON.parse(Buffer.from((await fetchLimited(u, { maxBytes: 8 * 1024 * 1024 })).bytes).toString('utf8')),
        fetchBytes: async (u, o) => (await fetchLimited(u, o)).bytes,
      };
      const p = await prepareNpm(spec, { workDir, ...reg, now });
      preparedNpm.set(p.root, p);
      const full = describeNpm(p);
      const tooLong = full.length > 1800;
      return { ok: true, name: p.name, token: p.root, text: tooLong ? `${full.slice(0, 1800)}\n…` : full, tooLong, listed: { skills: [], connectors: [p.name] } };
    } catch (err) { return { ok: false, message: String(err.message).slice(0, 300) }; }
  }
  // IA-3: a pinned PyPI connector (wheels only): the venv is made at its final folder at card time, marked pending; the yes removes the mark, no or a timeout deletes the folder
  const preparedPypi = new Map();
  const sweepPypi = async () => { for (const [k, p] of preparedPypi) if (now().getTime() - Date.parse(p.fetchedAt) > 30 * 60_000) { preparedPypi.delete(k); await discardPypi(p); } };
  async function previewPypiCard(spec) {
    await sweepPypi();
    if (!workDir) return { ok: false, message: 'Installing from PyPI is not available here.' };
    try {
      const reg = pypiDeps ?? {
        fetchJson: async (u) => JSON.parse(Buffer.from((await fetchLimited(u, { maxBytes: 8 * 1024 * 1024 })).bytes).toString('utf8')),
        fetchBytes: async (u, o) => (await fetchLimited(u, o)).bytes,
      };
      const name = String(spec ?? '').split('==')[0].replace(/[^A-Za-z0-9._-]/g, '_');
      const dest = join(dirname(workDir), 'tools', 'pypi', `${name}-${String(spec ?? '').split('==')[1] ?? 'x'}-${crypto.randomUUID().slice(0, 8)}`.replace(/[^A-Za-z0-9._-]/g, '_')); // a folder of its own for this card: an existing connector's folder is never touched before the yes
      const p = await preparePypi(spec, { workDir, dest, ...reg, now });
      preparedPypi.set(p.dest, p);
      const full = describePypi(p);
      const tooLong = full.length > 1800;
      return { ok: true, name: p.name, token: p.dest, text: tooLong ? `${full.slice(0, 1800)}\n…` : full, tooLong, listed: { skills: [], connectors: [p.name] } };
    } catch (err) { return { ok: false, message: String(err.message).slice(0, 300) }; }
  }
  // IA-9: "Pin this version" on an existing unpinned npx / uvx connector: the same pipeline and card; the yes points the connector at the pinned copy (its name, folders and settings stay)
  const pins = new Map(); // card token -> { serverId, kind }
  async function pinCard(serverId) {
    const server = await mcp.get(serverId);
    const what = unpinnedPackage(server);
    if (!what) return { ok: false, message: 'That connector is already pinned, or is not a package Bunny can pin.' };
    let card;
    if (what.kind === 'npm') card = await previewNpmCard(what.spec);
    else {
      const reg = pypiDeps ?? { fetchJson: async (u) => JSON.parse(Buffer.from((await fetchLimited(u, { maxBytes: 8 * 1024 * 1024 })).bytes).toString('utf8')) };
      let version = null;
      try { version = (await reg.fetchJson(`https://pypi.org/pypi/${encodeURIComponent(what.name)}/json`))?.info?.version; } catch { /* below */ }
      if (!version) return { ok: false, message: 'Could not find the current version of that package.' };
      card = await previewPypiCard(`${what.name}==${version}`);
    }
    if (!card.ok) return card;
    const id = crypto.randomUUID(); // the page gets an opaque id, never a folder path
    pins.set(id, { serverId, kind: what.kind, token: card.token, rest: what.rest ?? [], tooLong: card.tooLong === true });
    const keeps = (what.rest ?? []).length ? `\nIt keeps the arguments it has now: ${what.rest.join(' ').slice(0, 200)}` : '';
    return { ok: true, token: id, text: `This connector runs ${what.name} at whatever version the registry has today. Pinning installs one exact version and points the connector at it.${keeps}${card.tooLong ? '\nToo long to show whole: it will be pinned and switched off. Switch it on in Customize afterwards.' : ''}\n\n${card.text}`, tooLong: card.tooLong };
  }
  async function pinConfirm(serverId, token) {
    const pin = pins.get(String(token ?? ''));
    if (!pin || pin.serverId !== serverId) throw new Error('That pin is no longer waiting. Start again.');
    pins.delete(token);
    let placed;
    if (pin.kind === 'npm') { const p = preparedNpm.get(pin.token); if (!p) throw new Error('That pin is no longer waiting. Start again.'); preparedNpm.delete(pin.token); placed = await installNpm(p, { dest: join(dirname(workDir), 'tools', 'npm', `${p.name.replace('/', '__')}-${p.version}-${crypto.randomUUID().slice(0, 8)}`) }); }
    else { const p = preparedPypi.get(pin.token); if (!p) throw new Error('That pin is no longer waiting. Start again.'); preparedPypi.delete(pin.token); placed = await installPypi(p); }
    // PIN-1 (F10-1): a card too long to show whole never switches anything on: the pinned connector is switched OFF as part of the pin
    return mcp.update(serverId, { command: placed.command, args: [...placed.args, ...pin.rest], ...(pin.tooLong ? { enabled: false } : {}) }); // the arguments after the package stay
  }
  async function pinCancel(token) { const pin = pins.get(String(token ?? '')); pins.delete(String(token ?? '')); if (pin) { await discardNpmToken(pin.token); await discardPypiToken(pin.token); } }
  // INSTALL-ANYWHERE: the person's own "Add from address" field (window only). One field, what was understood, then the same one card. The person typed the address, so it is not "found on the open web", and a private address is
  // allowed for exactly that address; everything the source brings stays under the public-https rule.
  const addresses = new Map(); // opaque id -> { kind, ... }
  const classify = (text) => {
    const t = String(text ?? '').trim();
    if (/^npm:/i.test(t)) return { kind: 'npm', spec: t.replace(/^npm:/i, '') };
    if (/^pypi:/i.test(t)) { const s = t.replace(/^pypi:/i, ''); return { kind: 'pypi', spec: s.includes('==') ? s : s }; }
    if (!/^https:\/\//i.test(t)) return { error: /^http:\/\//i.test(t) ? 'Only https addresses can be installed.' : "I can't tell what this is. Paste an https address, or npm:name or pypi:name." };
    if (parseGithubUrl(t)) return { kind: 'github', url: t };
    const found = sourceKind(t);
    if (!found.error) return { kind: found.kind, url: t };
    return { kind: 'connector', url: t };
  };
  // `by` is who is at the window: 'person' (Bunny's own window) or 'device' (an Everything device). Only the person's own typing may reach a private address; a device keeps every public-https rule and its connector is recorded as a device's.
  async function addressCheck(text, { by = 'person' } = {}) {
    await sweep(); await sweepNpm(); await sweepPypi();
    const person = by === 'person'; // `by` is 'person' (Bunny's own window) or 'device:<id>' (one particular Everything device): a card belongs to whoever opened it
    const c = classify(text);
    if (c.error) return { ok: false, message: c.error };
    const id = crypto.randomUUID();
    try {
      if (c.kind === 'npm') { const card = await previewNpmCard(/@/.test(c.spec.slice(1)) ? c.spec : `${c.spec}@latest`); if (!card.ok) return card; addresses.set(id, { kind: 'npm', token: card.token, name: card.name, tooLong: card.tooLong === true, by }); return { ok: true, id, kind: 'npm', name: card.name, text: card.text, tooLong: card.tooLong, understood: 'npm package: exact version + integrity' }; }
      if (c.kind === 'pypi') {
        let spec = c.spec;
        if (!spec.includes('==')) { const reg = pypiDeps ?? { fetchJson: async (u) => JSON.parse(Buffer.from((await fetchLimited(u, { maxBytes: 8 * 1024 * 1024 })).bytes).toString('utf8')) }; const v = (await reg.fetchJson(`https://pypi.org/pypi/${encodeURIComponent(spec)}/json`))?.info?.version; if (!v) return { ok: false, message: 'Could not find that package on PyPI.' }; spec = `${spec}==${v}`; }
        const card = await previewPypiCard(spec); if (!card.ok) return card; addresses.set(id, { kind: 'pypi', token: card.token, name: card.name, tooLong: card.tooLong === true, by }); return { ok: true, id, kind: 'pypi', name: card.name, text: card.text, tooLong: card.tooLong, understood: 'PyPI package: a wheel with its sha256' };
      }
      if (c.kind === 'github') { const card = await previewPluginCard(c.url, { chatId: `address:${id}` }); if (!card.ok) return card; const text = card.text.replace(/^Found on the open web: not from a known catalogue\.\n/, ''); addresses.set(id, { kind: 'github', url: c.url, commit: card.commit, listed: card.listed, name: card.name, tooLong: card.tooLong === true, by }); return { ok: true, id, kind: 'github', name: card.name, text, tooLong: card.tooLong, understood: 'git repository: a commit is pinned' }; }
      if (c.kind === 'connector') {
        const u = new URL(c.url); let local = false;
        try { await checkPublicAddress(c.url); } catch (err) { if (!person) return { ok: false, message: err.message }; local = true; } // a device may not add an address on a network
        addresses.set(id, { kind: 'connector', url: c.url, name: u.hostname, by });
        return { ok: true, id, kind: 'connector', name: u.hostname, text: `Connector at ${c.url}\nThis service can change what it does at any time.${local ? '\nThis address is on your own network. It is allowed because you added it.' : ''}`, understood: 'remote connector: cannot be pinned to content' };
      }
      // git host, archive, SKILL.md: the same pipeline, with the typed address allowed to be on the person's own network
      if (!workDir) return { ok: false, message: 'Installing from an address is not available here.' };
      const src = await prepareSource(c.url, { workDir, ...(fetchSource ? { fetchSource } : {}), ...(checkAddress ? { checkAddress } : {}), ...(gitOptions ? { gitOptions } : {}), typedAddress: person, now });
      prepared.set(src.token, src);
      const full = describeSource(src, { openWeb: false }); const tooLong = full.length > 1800;
      addresses.set(id, { kind: 'source', tooLong, by, token: src.token, listed: { skills: src.plugin.skills.map((s) => String(s.name)), connectors: src.plugin.connectors.map((x) => String(x.url)) }, name: src.plugin.name });
      return { ok: true, id, kind: src.kind, name: src.plugin.name, text: tooLong ? `${full.slice(0, 1800)}\n…` : full, tooLong, understood: src.kind === 'git' ? 'git repository: a commit is pinned' : src.kind === 'skill' ? 'skill file: its sha256 is pinned' : 'archive: its sha256 is pinned' };
    } catch (err) { return { ok: false, message: String(err.message).slice(0, 300) }; }
  }
  async function addressConfirm(id, choice, { by = 'person' } = {}) {
    const a = addresses.get(String(id ?? '')); if (!a) throw new Error('That is no longer waiting. Check the address again.');
    if (a.by !== by) throw new Error('That card was not shown here.');
    addresses.delete(id);
    const on = choice === 'on' && a.tooLong !== true; // ADDR-1 (F10-1): a card too long to show whole never switches anything on
    a.item = a.name;
    if (a.kind === 'connector') { const added = await mcp.add({ name: a.name, url: a.url, enabled: on, addedBy: by === 'person' ? 'person' : 'device' }); return { ok: true, id: added.id, name: a.name, switchedOn: on }; }
    if (a.kind === 'npm') { const p = preparedNpm.get(a.token); if (!p) throw new Error('That is no longer waiting. Check the address again.'); preparedNpm.delete(a.token); const placed = await installNpm(p, { dest: join(dirname(workDir), 'tools', 'npm', `${p.name.replace('/', '__')}-${p.version}-${crypto.randomUUID().slice(0, 8)}`) }); const added = await mcp.add({ name: p.name, command: placed.command, args: placed.args, env: {}, enabled: on, addedBy: 'model' }); return { ok: true, id: added.id, name: a.name, switchedOn: on }; }
    if (a.kind === 'pypi') { const p = preparedPypi.get(a.token); if (!p) throw new Error('That is no longer waiting. Check the address again.'); preparedPypi.delete(a.token); const placed = await installPypi(p); const added = await mcp.add({ name: p.name, command: placed.command, args: placed.args, env: {}, enabled: on, addedBy: 'model' }); return { ok: true, id: added.id, name: a.name, switchedOn: on }; }
    let record;
    if (a.kind === 'github') record = (await installFromGithub(a.url, { off: true, pin: a.commit })).record;
    else record = (await installPrepared(a.token, { off: true })).record;
    if (on) await switchOn({ skillIds: record.skills, connectorIds: record.connectors }, a.listed);
    return { ok: true, id: record.id, name: a.name, switchedOn: on };
  }
  async function addressCancel(id, { by = 'person' } = {}) {
    const a = addresses.get(String(id ?? ''));
    if (!a) return;
    if (a.by !== by) throw new Error('That card was not shown here.'); // a second device (or the window) cannot cancel another's card
    addresses.delete(String(id ?? ''));
    if (a.kind === 'npm') await discardNpmToken(a.token);
    if (a.kind === 'pypi') await discardPypiToken(a.token);
    if (a.kind === 'source') { const p = prepared.get(a.token); prepared.delete(a.token); if (p) await discardSource(p); }
  }
  const discardPypiToken = async (token) => { const p = preparedPypi.get(token); preparedPypi.delete(token); if (p) await discardPypi(p); };
  const discardNpmToken = async (token) => { const p = preparedNpm.get(token); preparedNpm.delete(token); if (p) await discardNpm(p); };

  async function installPrepared(token, { off = false } = {}) {
    const src = prepared.get(String(token ?? ''));
    if (!src) throw new Error('The source is no longer ready. Ask again to see it first.');
    if (!(await stillTheSame(src))) { prepared.delete(src.token); await discardSource(src); throw new Error(CHANGED); }
    try {
      const record = await installParts({ ...src.plugin }, src.url, { off, pin: { kind: src.kind, url: src.url, ...(src.commit ? { commit: src.commit } : { sha256: src.sha256 }), treeHash: src.treeHash, fetchedAt: src.fetchedAt } });
      return { record, plugin: src.plugin };
    } finally { prepared.delete(src.token); await discardSource(src); }
  }

  async function installFromGithub(url, { off = false, pin = null } = {}) {
    const plugin = await readGithubPlugin(url, { fetchImpl, pin });
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
  const normUrl = (u) => String(u ?? '').trim().toLowerCase().replace(/\/+$/, '');
  /**
   * F10-2: with `listed` ({ skills: [names], connectors: [addresses] }, the card's own list) only a part that was ON the card is switched on; one that was not stays off.
   * Without `listed` (the older card) every part just added is switched on, as before.
   */
  async function switchOn(p, listed = null) {
    const allSkills = listed && typeof skills.list === 'function' ? await skills.list() : [];
    const names = new Set((listed?.skills ?? []).map((n) => String(n).trim().toLowerCase()));
    const urls = new Set((listed?.connectors ?? []).map(normUrl));
    const left = [];
    for (const id of p?.skillIds ?? []) {
      const skill = allSkills.find((x) => x.id === id);
      if (listed && !(skill && names.has(String(skill.name).trim().toLowerCase()))) { left.push(skill?.name ?? id); continue; }
      await skills.update(id, { enabled: true }).catch(() => {});
    }
    for (const id of p?.connectorIds ?? []) {
      const server = listed ? await mcp.get(id) : null;
      if (listed && !(server && (urls.has(normUrl(server.url)) || urls.has(normUrl(server.name))))) { left.push(server?.name ?? id); continue; }
      await mcp.update(id, { enabled: true }).catch(() => {});
    }
    return { left };
  }

  /**
   * F10: the one card for a plugin. `text` lists EVERY part by name (each skill, each connector with its address, and what is not imported); `listed` is the same list as data, kept by the server:
   * "Install and switch on" switches on exactly those parts and no other (F10-2). Over 1,800 characters the card cannot show it all: tooLong, no switch-on button, and it installs off.
   */
  async function previewPluginCard(url, { chatId = '' } = {}) {
    if (!parseGithubUrl(url)) {
      try {
        const { src, openWeb } = await prepareFromSource(url, chatId);
        const full = describeSource(src, { openWeb });
        const tooLong = full.length > 1800;
        return { ok: true, name: src.plugin.name, token: src.token, openWeb, pin: src.sha256, text: tooLong ? `${full.slice(0, 1800)}
…` : full, tooLong, listed: { skills: src.plugin.skills.map((s) => String(s.name)), connectors: src.plugin.connectors.map((c) => String(c.url)) } };
      } catch (err) { return { ok: false, message: String(err.message).slice(0, 300) }; }
    }
    try {
      const commit = await resolveCommit(url, { fetchImpl }); // the card and the install read this one commit
      const plugin = await readGithubPlugin(url, { fetchImpl, pin: commit });
      const lines = [
        `Plugin ${plugin.name}${plugin.description ? `: ${bunnyText(plugin.description)}` : ''}${commit ? ` (commit ${commit.slice(0, 7)})` : ''}`,
        ...(plugin.skills ?? []).map((s) => `Skill ${s.name} (${String(s.instructions ?? '').length} characters of instructions): ${bunnyText(s.description) || '(no description)'}`),
        ...(plugin.connectors ?? []).map((c) => `Connector ${c.name}: ${c.url}`),
        ...(plugin.skipped?.length ? [`Not imported: ${plugin.skipped.join('; ')}`] : []),
      ];
      const full = lines.join('\n');
      const openWeb = isOpenWeb(chatId, url);
      const shown = openWeb ? `Found on the open web: not from a known catalogue.\n${full}` : full;
      const tooLong = shown.length > 1800;
      return { ok: true, name: plugin.name, commit, openWeb, text: tooLong ? `${shown.slice(0, 1800)}\n…` : shown, tooLong, listed: { skills: (plugin.skills ?? []).map((s) => String(s.name)), connectors: (plugin.connectors ?? []).map((c) => String(c.url)) } };
    } catch (err) {
      return { ok: false, message: `Could not read that repository yet: ${String(err.message).slice(0, 200)}` };
    }
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
          const added = await mcp.add({ ...c, addedBy: 'model', enabled: false, folders: record.folders ?? [] }); // W616-1
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
    web_search: async ({ query }, ctx) => searchWeb(query, { fetchImpl: (u, i) => (fetchImpl === startFetch ? globalThis.fetch : fetchImpl)(u, i), braveKey: await Promise.resolve().then(getSearchKey).catch(() => null), browser: ctx?.browser === true }), // F6: Brave (with the person's key), then DuckDuckGo
    read_url: ({ url }) => readUrl(url),
    search_plugins: async ({ query }, ctx) => {
      const found = await searchPlugins(query, { fetchImpl, githubToken: await getGithubToken().catch(() => null) });
      noteKnown(ctx?.chatId, found); // only the catalogues' own results are "known" to this chat
      // INSTALL-ANYWHERE: the open web, last. Candidates only: a link and a title, cleaned like any web result; nothing from it is installed without the pipeline and the one card, which says it was found on the open web.
      const q = String(query ?? '').trim().slice(0, 100);
      const lines = [];
      let viaBrave = false;
      const braveKey = await Promise.resolve().then(getSearchKey).catch(() => null);
      for (const phrase of [`${q} MCP server`, `${q} SKILL.md`, `${q} claude plugin`]) {
        try {
          const text = await searchWeb(phrase, { fetchImpl: (u, i) => (fetchImpl === startFetch ? globalThis.fetch : fetchImpl)(u, i), braveKey }); // F6: Brave (with the person's key), then DuckDuckGo
          if (String(text).startsWith('(via Brave)')) viaBrave = true;
          for (const block of String(text).split(/\n(?=- )/)) { const m = /^- (.*)\n\s+(https:\/\/\S+)/.exec(block); if (m && !lines.some((l) => l.url === m[2])) lines.push({ title: m[1].slice(0, 100), url: m[2].slice(0, 300) }); }
        } catch { /* the web is not reachable: the catalogues' answer stands */ }
      }
      const web = lines.slice(0, 6);
      return web.length ? `${found}\n\nFrom the open web (candidates only: not a known catalogue; nothing here is installed without the one card, which says "Found on the open web")${viaBrave ? ' (via Brave)' : ''}:\n${web.map((w) => `- ${w.title}\n  ${w.url}`).join('\n')}` : found;
    },
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
    install_skill: (args, ctx) => run.install_plugin(args, ctx), // the same pipeline and the same card
    install_plugin: async ({ url }, ctx) => {
      if (!parseGithubUrl(url)) { // INSTALL-ANYWHERE: only what the card showed, and only through the card
        if (findInstalled(null, url)) return 'It is already installed, so nothing was changed. Updating a plugin is done by the person in Settings, Customize.';
        if (!ctx?.expectToken) throw new Error('A source that is not on GitHub is installed only after the card shows it.');
        const { plugin, record } = await installPrepared(ctx.expectToken, { off: true });
        keep(ctx, { title: plugin.name, text: describePlugin(plugin), skillIds: record.skills, connectorIds: record.connectors });
        return `Installed ${plugin.name}: ${plugin.skills.length} skill(s) [${plugin.skills.map((s) => s.name).join(', ')}], ${plugin.connectors.length} connector(s). They are switched OFF until the person says to switch them on (they were just asked).`
          + (plugin.skipped.length ? ` Not imported: ${plugin.skipped.join('; ')}.` : '');
      }
      // F10-5: something already installed is never read or imported again from here (an update goes through Customize's own update path)
      if (findInstalled(null, url)) return 'It is already installed, so nothing was changed. Updating a plugin is done by the person in Settings, Customize.';
      const { plugin, record } = await installFromGithub(url, { off: true, pin: ctx?.expectCommit });
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
      return toolInstaller.install({ repo: args.repo, expectSha: ctx?.expectSha, enabled: ctx?.switchOn !== 'off' });
    },
    add_connector: async (args, ctx) => {
      if (String(args.pypi ?? '').trim()) { // a pinned PyPI package: only what the card showed, only through the card
        const p = preparedPypi.get(String(ctx?.expectToken ?? ''));
        if (!p) throw new Error('A package from PyPI is added only after the card shows it.');
        preparedPypi.delete(p.dest);
        const placed = await installPypi(p);
        const added = await mcp.add({ name: args.name ?? p.name, command: placed.command, args: placed.args, env: {}, enabled: ctx?.switchOn !== 'off', addedBy: 'model', source: null });
        if (ctx?.oneCard) keep(ctx, { title: added.name, text: `Connector ${added.name} (runs on this computer)`, skillIds: [], connectorIds: [added.id] });
        return added.enabled === false ? `Added the local connector ${added.name} (${p.name}==${p.version}, pinned, wheels only). It is switched OFF, as the person chose; they can switch it on in Settings, Customize.` : `Added the local connector ${added.name} (${p.name}==${p.version}, pinned, wheels only). It is switched on; its tools are offered from the next message.`;
      }
      if (String(args.npm ?? '').trim()) { // a pinned npm package: only what the card showed, only through the card
        const p = preparedNpm.get(String(ctx?.expectToken ?? ''));
        if (!p) throw new Error('A package from npm is added only after the card shows it.');
        preparedNpm.delete(p.root);
        const dest = join(dirname(workDir), 'tools', 'npm', `${p.name.replace('/', '__')}-${p.version}-${crypto.randomUUID().slice(0, 8)}`); // never over an existing connector's folder
        const placed = await installNpm(p, { dest });
        const added = await mcp.add({ name: args.name ?? p.name, command: placed.command, args: placed.args, env: {}, enabled: ctx?.switchOn !== 'off', addedBy: 'model', source: null });
        if (ctx?.oneCard) keep(ctx, { title: added.name, text: `Connector ${added.name} (runs on this computer)`, skillIds: [], connectorIds: [added.id] });
        return added.enabled === false ? `Added the local connector ${added.name} (${p.name}@${p.version}, pinned). It is switched OFF, as the person chose; they can switch it on in Settings, Customize.` : `Added the local connector ${added.name} (${p.name}@${p.version}, pinned). It is switched on; its tools are offered from the next message.`;
      }
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
      if (remote && String(args.url ?? '').trim() && (await mcp.list()).some((x) => x.url && normUrl(x.url) === normUrl(args.url))) return 'A connector at that address is already installed, so nothing was added (F10-5). Changing it is done by the person in Settings, Customize.';
      const added = await mcp.add({ addedBy: 'model', name: args.name, url: args.url, command: args.command, args: args.args, env: args.env, enabled: remote ? false : ctx?.switchOn !== 'off', ...(remote && args.key_headers ? { keyHeaders: args.key_headers } : {}) });
      if (remote) {
        keep(ctx, { title: added.name, text: `Connector ${added.name}: ${added.url}\nIt is added switched OFF. Its tools reach the model only after you switch it on.`, skillIds: [], connectorIds: [added.id] });
        return `Added the remote connector ${added.name} (${added.url}). It is switched OFF until the person says to switch it on (they were just asked).${added.keyHeaders?.length ? ` It needs a key (${added.keyHeaders.join(', ')}): tell the person to open Settings, Customize, this connector, Add key, and paste it there. Never ask for the key in the chat.` : ''}`;
      }
      if (ctx?.oneCard) keep(ctx, { title: added.name, text: `Connector ${added.name} (runs on this computer)`, skillIds: [], connectorIds: [added.id] });
      return added.enabled === false ? `Added the local connector ${added.name}. It is switched OFF, as the person chose; they can switch it on in Settings, Customize.` : `Added the local connector ${added.name}. It is switched on; its tools are offered from the next message.`;
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
    previewPluginCard, previewNpmCard, discardNpmToken, sweepNpm, previewPypiCard, discardPypiToken, sweepPypi, pinCard, pinConfirm, pinCancel, addressCheck, addressConfirm, addressCancel,
    /** F10: is this plugin already installed? (then there is nothing to ask: the install itself says so) */
    isPluginInstalled: (url) => Boolean(findInstalled(null, url)),
  };
}

/**
 * Install an agent plugin from a GitHub repository.
 *
 * Reads the common plugin layout (plugin.json or .claude-plugin/plugin.json,
 * skills/<name>/SKILL.md with optional references/, and .mcp.json) and brings in
 * what Bunny can use:
 *   - every skill, with its reference files appended (long skills load on demand);
 *   - every remote MCP server (http / streamable-http / sse with a url) as a connector.
 * Hooks, commands, agents and scripts are built for other apps: they are listed
 * as skipped, never run.
 */
const MAX_SKILL = 120_000;

export function parseGithubUrl(raw) {
  const text = String(raw ?? '').trim().replace(/\.git$/, '');
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?\/?$/i.exec(text)
    ?? /^([\w.-]+)\/([\w.-]+)$/.exec(text);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref: m[3] ?? 'HEAD', base: (m[4] ?? '').replace(/\/$/, '') };
}

export function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const block = /^([|>])[+-]?\s*$/.exec(kv[2]);
    // a block (| keeps the lines, > folds them) or a value that goes on over indented lines
    if (block || !kv[2]) {
      const rest = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) { i += 1; rest.push(lines[i].trim()); }
      const joined = (block?.[1] === '|' ? rest.join('\n') : rest.join(' ')).replace(/\s+$/, '').replace(/ {2,}/g, ' ');
      if (joined) data[kv[1]] = joined;
      continue;
    }
    let value = kv[2];
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]) && !/^\s*[A-Za-z0-9_-]+:\s/.test(lines[i + 1])) { i += 1; value += ` ${lines[i].trim()}`; }
    data[kv[1]] = value.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  return { data, body: m[2] };
}

/** S-2: a skill with no description in its front matter is described by the first sentence of its text that is not a heading. */
export function firstSentence(body) {
  let fenced = false;
  for (const line of String(body ?? '').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('```')) { fenced = !fenced; continue; }
    if (fenced || !t || /^(#|---|>|\|)/.test(t)) continue;
    return t.replace(/[*_`]/g, '').slice(0, 200);
  }
  return '';
}

export async function readGithubPlugin(url, { fetchImpl = globalThis.fetch } = {}) {
  const loc = parseGithubUrl(url);
  if (!loc) throw new Error('That is not a GitHub repository link (github.com/owner/repo).');
  const { owner, repo, ref, base } = loc;
  const api = `https://api.github.com/repos/${owner}/${repo}/git/trees/${ref}?recursive=1`;
  const treeRes = await fetchImpl(api, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'bunny-ai' } });
  if (treeRes.status === 404) throw new Error('GitHub could not find that repository (it may be private).');
  if (!treeRes.ok) throw new Error(`GitHub answered ${treeRes.status} for the repository list.`);
  const tree = await treeRes.json();
  const prefix = base ? `${base}/` : '';
  const files = (tree.tree ?? []).filter((t) => t.type === 'blob' && t.path.startsWith(prefix)).map((t) => t.path.slice(prefix.length));
  const raw = async (path) => {
    const res = await fetchImpl(`https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${prefix}${path}`, { headers: { 'user-agent': 'bunny-ai' } });
    if (!res.ok) throw new Error(`Could not read ${path} (${res.status})`);
    return res.text();
  };

  // name and description
  let meta = {};
  for (const p of ['plugin.json', '.claude-plugin/plugin.json', 'package.json']) {
    if (files.includes(p)) { try { meta = JSON.parse(await raw(p)); break; } catch { /* next */ } }
  }

  // skills: skills/<name>/SKILL.md, or a single SKILL.md at the root
  // P-1: also under a nested plugin (plugins/<name>/skills/<skill>/SKILL.md) and under .claude/skills
  const NOT_A_SKILL = /(^|\/)(node_modules|tests?|__tests__|fixtures?|examples?|samples?|vendor)\//i; // QA: never imported from there
  const MAX_SKILLS = 40;
  const allSkillFiles = files.filter((p) => !NOT_A_SKILL.test(p) && /(^|\/)SKILL\.md$/i.test(p) && (p.startsWith('skills/') || p === 'SKILL.md' || p.split('/').length === 2 || /(^|\/)skills\/[^/]+\/SKILL\.md$/i.test(p)));
  const skillFiles = allSkillFiles.slice(0, MAX_SKILLS);
  const skills = [];
  for (const path of skillFiles) {
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const { data, body } = frontmatter(await raw(path));
    let instructions = body.trim();
    const refs = files.filter((p) => p.startsWith(`${dir}references/`) && /\.(md|txt)$/i.test(p));
    for (const ref of refs) {
      if (instructions.length > MAX_SKILL) break;
      instructions += `\n\n---\n# Reference: ${ref.slice(dir.length)}\n\n${(await raw(ref)).trim()}`;
    }
    skills.push({
      name: String(data.name ?? (dir.split('/').filter(Boolean).pop() || repo)).slice(0, 60),
      description: String(data.description || firstSentence(body)).slice(0, 200),
      instructions: instructions.slice(0, MAX_SKILL),
    });
  }

  // P-2: commands/*.md are prompts the person invokes; agents/*.md are briefs for a helper. Both are kept as skills (read_skill / the /name menu),
  // counted in the same limit as the skills, and never from node_modules, tests, fixtures or examples.
  const pname = String(meta.name ?? repo);
  const extra = files.filter((p) => !NOT_A_SKILL.test(p) && /(^|\/)(commands|agents)\/[^/]+\.md$/i.test(p));
  let extraLeft = 0;
  for (const path of extra) {
    if (skills.length >= MAX_SKILLS) { extraLeft += 1; continue; }
    const kind = /(^|\/)agents\//i.test(path) ? 'agent' : 'command';
    const base = path.split('/').pop().replace(/\.md$/i, '');
    const { data, body } = frontmatter(await raw(path));
    const what = String(data.description || firstSentence(body));
    skills.push(kind === 'command'
      ? {
        name: `${pname}:${base}`.slice(0, 60),
        description: what.slice(0, 200),
        instructions: `This is the command /${base} of the ${pname} plugin. Follow it when the person asks for it (or for what it describes).\n\n${body.trim()}`.slice(0, MAX_SKILL),
      }
      : {
        name: `agent:${pname}:${base}`.slice(0, 60),
        description: `Helper brief: ${what}`.slice(0, 200),
        instructions: `This is a brief for a helper agent from the ${pname} plugin. To use it, call run_subagent with this brief, and what the person asked for, as the task.\n\n${body.trim()}`.slice(0, MAX_SKILL),
      });
  }

  // connectors: remote servers from .mcp.json are added; local ones run a program, so they are
  // listed for add_connector, where the person confirms the exact command.
  const connectors = [];
  const skipped = [];
  if (allSkillFiles.length > skillFiles.length) skipped.push(`${allSkillFiles.length - skillFiles.length} more skills were not imported (at most ${MAX_SKILLS} are taken from one repository)`);
  if (files.includes('.mcp.json')) {
    try {
      const mcp = JSON.parse(await raw('.mcp.json'));
      for (const [name, def] of Object.entries(mcp.mcpServers ?? mcp)) {
        // P-3: a legacy SSE server does not take the POSTs this client sends; one that needs headers (a key) is added SWITCHED OFF, and said so
        if (def?.url && /^https?:\/\//.test(def.url) && String(def.type ?? '').toLowerCase() === 'sse') skipped.push(`connector "${name}" (an older SSE server, which Bunny cannot talk to yet)`);
        else if (def?.url && /^https?:\/\//.test(def.url) && (def.headers && Object.keys(def.headers).length || def.env && Object.keys(def.env).length)) {
          connectors.push({ name, url: def.url, enabled: false });
          skipped.push(`connector "${name}" needs a key or sign-in: it was added switched off`);
        } else if (def?.url && /^https?:\/\//.test(def.url)) connectors.push({ name, url: def.url });
        else if (def?.command) skipped.push(`local connector "${name}" (${[def.command, ...(def.args ?? [])].join(' ')}): add it with add_connector so the person can confirm the command`);
        else skipped.push(`connector "${name}" (no address or command)`);
      }
    } catch { skipped.push('.mcp.json (could not be read)'); }
  }
  if (extraLeft) skipped.push(`${extraLeft} more commands or agents were not imported (the limit of ${MAX_SKILLS} is reached)`);
  for (const [label, test] of [['hooks', /^hooks\//], ['scripts', /^(bin|scripts)\//]]) {
    const n = files.filter((p) => test.test(p)).length;
    if (n) skipped.push(`${n} ${label} file${n === 1 ? '' : 's'}`);
  }
  if (!skills.length && !connectors.length) {
    throw new Error('That repository has no skills (SKILL.md) or remote connectors (.mcp.json) Bunny can use.');
  }
  return {
    name: String(meta.name ?? repo).slice(0, 60),
    description: String(meta.description ?? '').slice(0, 200),
    version: meta.version ?? null,
    source: `https://github.com/${owner}/${repo}`,
    skills, connectors, skipped,
  };
}

/** Search GitHub for plugins / skills and the MCP registry for connectors (no sign-in needed). */
export async function searchPlugins(query, { fetchImpl = globalThis.fetch } = {}) {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('search_plugins needs a query');
  const lines = [];
  try {
    const res = await fetchImpl(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${q} skill OR plugin OR mcp`)}&sort=stars&per_page=8`,
      { headers: { accept: 'application/vnd.github+json', 'user-agent': 'bunny-ai' } });
    const data = await res.json();
    lines.push('GitHub repositories (install with install_plugin and the url):');
    for (const r of data.items ?? []) lines.push(`- ${r.full_name} (★${r.stargazers_count}) https://github.com/${r.full_name} — ${String(r.description ?? '').slice(0, 140)}`);
    if (!(data.items ?? []).length) lines.push('- none found');
  } catch (err) { lines.push(`GitHub search failed: ${err.message}`); }
  try {
    const res = await fetchImpl(`https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(q)}&limit=8`);
    const data = await res.json();
    lines.push('', 'MCP registry connectors (add with add_connector and the url):');
    let n = 0;
    for (const { server } of data.servers ?? []) {
      for (const remote of server.remotes ?? []) {
        if (!remote.url) continue;
        const signIn = (remote.headers ?? []).some((h) => h.isRequired);
        lines.push(`- ${server.name}: ${remote.url}${signIn ? ' (needs sign-in, Bunny cannot connect it yet)' : ''} — ${String(server.description ?? '').slice(0, 120)}`);
        n += 1;
        break;
      }
    }
    if (!n) lines.push('- none with a remote address');
  } catch (err) { lines.push(`MCP registry search failed: ${err.message}`); }
  return lines.join('\n');
}

/** Read a web page as text (README-friendly), for the model to check before installing. */
export async function readUrl(url, { fetchImpl = globalThis.fetch } = {}) {
  let target = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(target)) throw new Error('read_url needs an http or https address');
  const gh = parseGithubUrl(target);
  if (gh && !gh.base) target = `https://raw.githubusercontent.com/${gh.owner}/${gh.repo}/${gh.ref}/README.md`;
  const res = await fetchImpl(target, { headers: { 'user-agent': 'bunny-ai', accept: 'text/html,text/plain,*/*' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`The page answered ${res.status}`);
  let text = await res.text();
  if (/<html|<body|<div/i.test(text.slice(0, 2000))) {
    text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n');
  }
  return text.trim().slice(0, 12_000);
}

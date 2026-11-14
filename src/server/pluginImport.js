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

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv && kv[2]) data[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return { data, body: m[2] };
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
  const skillFiles = files.filter((p) => /(^|\/)SKILL\.md$/i.test(p) && (p.startsWith('skills/') || p === 'SKILL.md' || p.split('/').length === 2));
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
      description: String(data.description ?? '').slice(0, 200),
      instructions: instructions.slice(0, MAX_SKILL),
    });
  }

  // connectors: remote servers from .mcp.json (local command servers cannot run here)
  const connectors = [];
  const skipped = [];
  if (files.includes('.mcp.json')) {
    try {
      const mcp = JSON.parse(await raw('.mcp.json'));
      for (const [name, def] of Object.entries(mcp.mcpServers ?? mcp)) {
        if (def?.url && /^https?:\/\//.test(def.url)) connectors.push({ name, url: def.url });
        else skipped.push(`connector "${name}" (runs a local command)`);
      }
    } catch { skipped.push('.mcp.json (could not be read)'); }
  }
  for (const [label, test] of [['hooks', /^hooks\//], ['commands', /^commands\//], ['agents', /^agents\//], ['scripts', /^(bin|scripts)\//]]) {
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

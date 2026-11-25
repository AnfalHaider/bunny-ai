/**
 * AGENT-FLOW F4: a short, curated list of known connectors for common jobs, shown FIRST by search_plugins. Every entry is a REMOTE connector at the vendor's own https address: nothing in this list
 * runs a program on the person's computer, and adding one still goes through today's path (add_connector: it arrives switched OFF, the person is asked, only the window switches it on).
 *
 * A trust decision, so Security reviews each entry before a release (drop an entry, or the whole list, by deleting it here). The list is pinned: it changes only with a release, never at run time. The sources checked for each entry are in docs/plans/curated-connectors-sources.md.
 * `needs`: 'sign-in' (the vendor's own sign-in page opens, Bunny never sees the password) or 'key' (the vendor gives a key the person pastes; the header's name is in `keyHeader`).
 */
export const CURATED = Object.freeze([
  // PROPOSED by the builder, to be checked entry by entry by Security: every address is the vendor's own https address; none runs a program here.
  { id: 'notion', name: 'Notion', url: 'https://mcp.notion.com/mcp', needs: 'sign-in', jobs: 'notes wiki docs pages database knowledge base notion', why: "Read and write the person's Notion pages and databases." },
  { id: 'linear', name: 'Linear', url: 'https://mcp.linear.app/mcp', needs: 'sign-in', jobs: 'issues tickets project tracker bugs sprint linear', why: 'Find, create and update Linear issues and projects.' },
  { id: 'sentry', name: 'Sentry', url: 'https://mcp.sentry.dev/mcp', needs: 'sign-in', jobs: 'errors crashes exceptions monitoring stack traces sentry', why: 'Look into errors and crashes recorded in Sentry.' },
  { id: 'atlassian', name: 'Atlassian (Jira and Confluence)', url: 'https://mcp.atlassian.com/v2/mcp', needs: 'sign-in', jobs: 'jira confluence tickets wiki issues atlassian', why: 'Search and update Jira issues and Confluence pages.' },
  { id: 'context7', name: 'Context7 (library documentation)', url: 'https://mcp.context7.com/mcp', needs: 'none', note: 'no sign-in needed; an API key is optional, for higher limits', jobs: 'documentation docs library api reference framework version up to date', why: 'Current documentation and examples for programming libraries.' },
  { id: 'deepwiki', name: 'DeepWiki (explain a GitHub repository)', url: 'https://mcp.deepwiki.com/mcp', needs: 'none', jobs: 'github repository explain codebase architecture wiki open source', why: 'Ask questions about a public GitHub repository.' },
  { id: 'microsoft-learn', name: 'Microsoft Learn', url: 'https://learn.microsoft.com/api/mcp', needs: 'none', jobs: 'microsoft azure dotnet windows powershell documentation learn', why: 'Search official Microsoft documentation.' },
].map((e) => Object.freeze(e)));

const words = (s) => String(s ?? '').toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];

/** The curated entries that fit a search, best first (`list` is for tests). */
export function searchCurated(query, { list = CURATED, limit = 4 } = {}) {
  const q = new Set(words(query));
  if (!q.size) return [];
  const scored = [];
  for (const e of list) {
    const hay = new Set([...words(e.name), ...words(e.jobs), ...words(e.id)]);
    let score = 0;
    for (const w of q) if (hay.has(w)) score += words(e.name).includes(w) || e.id === w ? 3 : 1;
    if (score > 0) scored.push({ e, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name)).slice(0, limit).map((x) => x.e);
}

/** The lines the model sees for the curated matches. */
export function curatedLines(matches) {
  if (!matches.length) return [];
  const how = { 'sign-in': "the person signs in on the vendor's own page", key: 'the person pastes a key', none: 'no sign-in needed' };
  return ["Known connectors for common jobs, checked by Bunny's team against each vendor's own documentation (add with add_connector and the url; it is added switched OFF and the person is asked):",
    ...matches.map((e) => `- ${e.name}: ${e.url} (${e.note ?? how[e.needs] ?? how.none}) — ${e.why}`), ''];
}

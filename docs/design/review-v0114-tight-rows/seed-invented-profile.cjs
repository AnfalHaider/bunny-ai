const W = 'http://127.0.0.1:5612';
const post = async (p, b, m = 'POST') => { const r = await fetch(W + p, { method: m, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); console.log(m, p, r.status, t.slice(0, 120)); return t; };
(async () => {
  await post('/api/mcp', { name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', enabled: true });
  await post('/api/mcp', { name: 'Context7', url: 'https://mcp.context7.com/mcp', enabled: true });
  await post('/api/mcp', { name: 'Team wiki', url: 'https://wiki.example.com/mcp', enabled: false });
  await post('/api/skills', { name: 'Code reviewer', description: 'Reviews a change for bugs before style', instructions: 'Look for correctness bugs first.', enabled: true });
  await post('/api/skills', { name: 'Commit message writer', description: 'Short, clear commit messages', instructions: 'Subject under 60 chars.', enabled: true });
  await post('/api/skills', { name: 'Plain-language explainer', description: 'Explains without jargon', instructions: 'Plain words.', enabled: false });
  await post('/api/plugins', { name: 'Developer docs pack', description: 'DeepWiki and Context7 connectors plus a skill that cites its sources', connectors: [{ name: 'DeepWiki docs', url: 'https://mcp.deepwiki.com/mcp?p=1' }], skills: [{ name: 'Cite sources', description: 'Says where an answer came from', instructions: 'Name the source.' }] });
})();

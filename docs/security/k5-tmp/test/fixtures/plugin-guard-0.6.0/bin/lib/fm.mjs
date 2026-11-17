// Minimal, dependency-free frontmatter reader for the subset this toolkit writes:
//   key: value        key: [a, b, c]        key:\n  - a\n  - b
// Anything richer is out of scope on purpose: every file the toolkit reads is one it generated.

export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: null, body: text };
  const data = {};
  let listKey = null;
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (!line.trim()) continue;
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { data[listKey].push(unquote(item[1].trim())); continue; }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv;
    if (value === '') { data[key] = []; listKey = key; continue; }
    listKey = null;
    if (/^\[.*\]$/.test(value)) {
      const inner = value.slice(1, -1).trim();
      data[key] = inner ? inner.split(',').map((s) => unquote(s.trim())) : [];
    } else {
      data[key] = unquote(value.trim());
    }
  }
  return { data, body: m[2] };
}

function unquote(s) {
  return s.replace(/^(['"])(.*)\1$/, '$2');
}

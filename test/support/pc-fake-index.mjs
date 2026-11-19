// A stand-in for the Windows Search index, for SEARCH-PC tests: no real index, no PowerShell, invented files only.
// fakeRunner(rows) is the `run(sql)` of createPcSearch: it checks that the query text is well formed (every quote balanced, nothing outside a quoted piece but the template's
// own words), then answers the rows whose name or snippet holds every CONTAINS term, as the lines the real script writes.
const OUTSIDE_OK = /^[A-Za-z0-9 (),=.<>*:[\]_-]*$/;

/** The quoted pieces of a query and what is left between them. Throws on an unbalanced quote (what a bad term would cause on the real index). */
export function splitSql(sql) {
  const pieces = [];
  let outside = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c !== "'") { outside += c; i += 1; continue; }
    let lit = '';
    i += 1;
    for (;;) {
      if (i >= sql.length) throw new Error('unterminated string in the query');
      if (sql[i] === "'") { if (sql[i + 1] === "'") { lit += "'"; i += 2; continue; } i += 1; break; }
      lit += sql[i]; i += 1;
    }
    pieces.push(lit);
    outside += '\u0001';
  }
  return { pieces, outside };
}

export function fakeRunner(rows, { seen = [] } = {}) {
  return async (sql) => {
    seen.push(sql);
    const { pieces, outside } = splitSql(sql);
    if (!OUTSIDE_OK.test(outside.replace(/\u0001/g, ''))) throw new Error('something outside the quoted terms is not part of the template');
    const terms = [...sql.matchAll(/CONTAINS\('"((?:[^']|'')*)"'\)/g)].map((m) => m[1].replace(/''/g, "'").toLowerCase());
    void pieces;
    const hit = rows.filter((r) => terms.every((t) => `${r.name} ${r.snippet ?? ''}`.toLowerCase().includes(t)));
    const lines = hit.slice(0, 50).map((r) => JSON.stringify({ p: r.path, n: r.name, m: r.modified ?? '2025-03-01 10:00:00', s: r.size ?? 100, a: r.snippet ?? '' }));
    return { lines: [...lines, '{"done":true}'], timedOut: false, tooBig: false };
  };
}

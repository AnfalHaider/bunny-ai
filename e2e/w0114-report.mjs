/** Turn result-*.json of the phone walk into one list of breaks (grouped), with the smallest screenshot per group. node e2e/w0114-report.mjs <inDir> <outFile> */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const IN = process.argv[2]; const OUTF = process.argv[3];
const all = []; const notes = [];
for (const f of readdirSync(IN).filter((x) => /^result-.*\.json$/.test(x))) { const j = JSON.parse(readFileSync(join(IN, f), 'utf8')); all.push(...j.results); notes.push(...j.notes.map((n) => `${j.mode}: ${n}`)); }
const groups = new Map();
for (const r of all) for (const b of r.breaks) {
  const state = r.state.replace(/^settings-.*/, 'settings (tab)');
  const strip = b.kind === 'cut-in-scroller';
  const key = strip ? ['strip', b.frame, b.parent].join(' | ') : [b.kind, b.frame, b.el, b.other ?? ''].join(' | ');
  if (!groups.has(key)) groups.set(key, { b: strip ? { ...b, el: `${b.parent} (a strip that scrolls sideways; cut: ${b.el})`, kind: 'cut-in-scroller' } : b, state: r.state, frame: b.frame, hits: [], els: new Set(), states: new Set() });
  groups.get(key).states.add(r.state);
  groups.get(key).els.add(b.el);
  groups.get(key).hits.push({ mode: r.mode, size: r.size, theme: r.theme, shot: r.shot, rect: b.rect, note: b.note });
}
const sizeSort = (a, b) => parseInt(a) - parseInt(b);
const lines = [];
const rank = (g) => ({ 'page-scrolls-sideways': 0, 'cut-by-screen': 1, overlap: 2, 'label-cut': 3, 'cut-by-parent': 4, covered: 5, 'cut-in-scroller': 6 }[g.b.kind] ?? 9);
const list = [...groups.values()].sort((x, y) => rank(x) - rank(y) || y.hits.length - x.hits.length);
lines.push(`Total states measured: ${all.length}; with at least one break: ${all.filter((r) => r.breaks.length).length}; distinct breaks (kind, state, element): ${list.length}.`, '');
let n = 0;
for (const g of list) {
  n++;
  const sizes = [...new Set(g.hits.map((h) => h.size))].sort(sizeSort); const modes = [...new Set(g.hits.map((h) => h.mode))]; const themes = [...new Set(g.hits.map((h) => h.theme))];
  const shot = g.hits.map((h) => h.shot).filter(Boolean).sort((a, c) => { const sz = (s) => { try { return statSync(join(IN, s)).size; } catch { return 1e9; } }; return sz(a) - sz(c); })[0];
  const first = g.hits[0];
  lines.push(`### B${n}. ${g.b.kind}: ${g.b.el}${g.b.other ? ' over ' + g.b.other : ''}`);
  const st = [...g.states]; const stShown = st.length > 8 ? st.slice(0, 8).join(', ') + `, and ${st.length - 8} more (${st.filter((x) => x.startsWith('settings-')).length} settings tabs)` : st.join(', ');
  lines.push(`- Page / state: ${stShown}${g.frame !== 'main' ? ' (inside ' + g.frame + ')' : ''}`);
  lines.push(`- Sizes (${g.hits.length} hits): ${sizes.join(', ')}`);
  lines.push(`- Modes: ${modes.join(', ')}; themes: ${themes.join(', ')}`);
  lines.push(`- What: ${first.note}${g.b.parent ? ' (parent ' + g.b.parent + ')' : ''}${first.rect ? ' box ' + JSON.stringify(first.rect) : ''}`);
  if (g.els.size > 1 || g.b.kind === 'cut-in-scroller') lines.push(`- Cut elements: ${[...g.els].slice(0, 12).join('; ')}`);
  if (shot) lines.push(`- Picture: ${shot}`);
  lines.push('');
}
const small = new Map();
for (const r of all) for (const s of r.smallList ?? []) { const k = s.frame + ' ' + s.el; small.set(k, (small.get(k) ?? 0) + 1); }
lines.push('## Small touch targets (under 30 px on a side; the first six per state, counted over all states)', '', ...[...small.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, c]) => `- ${k} (${c} states)`), '');
const pick = all.filter((r) => r.texts?.length);
lines.push('## Words', '', `"Pick a model" is on screen in ${pick.length} of ${all.length} states (for example ${[...new Set(pick.map((r) => r.state))].slice(0, 8).join(', ')}).`, '');
lines.push('## Notes from the run (states that could not be set up)', '', ...(notes.length ? notes.map((x) => '- ' + x) : ['- none']));
writeFileSync(OUTF, lines.join('\n'));
console.log('groups', list.length);

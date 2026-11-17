// Commands that answer questions in a few lines, so sessions don't read whole files (token budget).
//   brief <role>        the role's own rules, in full with reasons, plus its part in the flow
//   next <piece>        what the piece still needs, and who acts next
//   board --mine        only this session's board rows
//   board archive       move old DONE rows out of the board
//   piece --suggest     suggest a lane and extra checks from the changed files
//   cost                what each session pays to start, and what is growing
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { parseFrontmatter } from './fm.mjs';
import { KIT, loadFlow, requiredFor, wordRecordProblems, wordsFor } from './flow.mjs';
import { currentRole, git, loadPolicy, matchesAny } from './policy.mjs';

const tok = (s) => Math.round(String(s || '').length / 3.6);
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

export function loadRules(root) {
  const p = root && existsSync(join(root, '.bootstrap', 'flow', 'rules.json')) ? join(root, '.bootstrap', 'flow', 'rules.json') : join(KIT, 'flow', 'rules.json');
  return JSON.parse(readFileSync(p, 'utf8')).rules;
}

// ---------- brief ----------
export function brief(root, roleId) {
  const { flow } = loadFlow(root);
  const r = flow.roles[roleId];
  if (!r) throw new Error(`no session "${roleId}"; sessions: ${Object.keys(flow.roles).join(', ')}`);
  const tag = r.class === 'lane' || r.class === 'custom' ? [roleId, 'project-lane'] : [roleId];
  const rules = loadRules(root).filter((x) => x.roles.includes('*') || x.roles.some((y) => tag.includes(y)));
  const name = (id) => (flow.roles[id] ? flow.roles[id].name : id);
  const part = [];
  for (const l of flow.lanes) {
    const mine = l.stages.filter((s) => s.kind === 'stage' && s.role === roleId).map((s) => s.title);
    const signs = !l.live_exempt_signoffs && (l.dev_signoffs || []).includes(roleId);
    if (mine.length || signs) part.push(`- **${l.name}**: ${[mine.length ? `you do ${mine.join(', ')}` : '', signs ? `you sign before ${flow.branches.dev || flow.branches.live}` : ''].filter(Boolean).join('; ')}`);
  }
  for (const c of flow.conditions) if ((c.require || []).includes(roleId)) part.push(`- Any lane, when work **${c.label.toLowerCase()}**: you must sign`);
  const sources = (r.source_list || []).filter((s) => s.ok).map((s) => `${s.slug}${s.required ? ' (company, required)' : ''}`);
  return [
    `# Brief: ${r.name} (\`${roleId}\`)`,
    '',
    `**Job.** ${r.job || '—'}`,
    `**Never.** ${r.never || '—'}`,
    `**Kit.** skills: ${(r.skills || []).join(', ') || '—'} · plugins: ${(r.plugins || []).join(', ') || '—'}${sources.length ? ` · preferred sources: ${sources.join(', ')}` : ''}`,
    '',
    '## Your part in the flow',
    ...(part.length ? part : ['- No fixed stage: the Chief of Staff assigns your work.']),
    '',
    `## Your rules (${rules.length}, each with the reason it exists)`,
    ...rules.map((x) => `- **${x.id}** ${x.text} *Why: ${x.why}*`),
    '',
    ...familyLines(flow, roleId),
    '',
    '## Every task',
    `- Start: \`bootstrap board --mine\`, then \`mem find <topic>\` for the lessons your rows name. Full AGENTS.md only if a question isn't answered here.`,
    `- Before asking "what is missing": \`bootstrap next <piece>\`.`,
    `- End: your row updated, a log entry on top of \`docs/memory/logs/${roleId}.md\`, one lesson or "no lesson".`,
    '',
    '## First reply',
    'Restate these rules in your own words, list what you inherited (your log\'s last entry and your rows), and name your first action. Do nothing else until the Chief of Staff confirms.',
  ].join('\n') + '\n';
}

// ---------- the family: who runs, who reports to whom, helpers ----------
export function family(flow) {
  const out = { on: [], optional: [], off: [] };
  for (const id of Object.keys(flow.roles)) {
    if (flow.roles[id].class === 'lane') continue;
    const st = id === 'chief-of-staff' ? 'on' : (flow.family || {})[id] || 'optional';
    (out[st] || out.optional).push(id);
  }
  return out;
}
export function helpersOf(flow) { return { max_per_session: 2, model: 'haiku', ...(flow.helpers || {}) }; }

function familyLines(flow, roleId) {
  const name = (id) => (flow.roles[id] ? flow.roles[id].name : id);
  const fam = family(flow), h = helpersOf(flow);
  const helper = h.max_per_session
    ? `- **Helpers.** Start at most ${h.max_per_session} helper agent${h.max_per_session === 1 ? '' : 's'} in this session, only when the work needs one, on the cheapest model (${h.model}). The guard refuses more, or a bigger model.`
    : '- **Helpers.** None: do the work in this session. The guard refuses helper agents.';
  if (roleId === 'chief-of-staff') return ['## Your family',
    `- **On from the start:** ${fam.on.filter((id) => id !== roleId).map(name).join(', ') || 'none'}. Start each as a linked session at setup (\`bootstrap family\` lists them).`,
    `- **Optional:** ${fam.optional.map(name).join(', ') || 'none'}. Start one only when a piece needs its sign-off (\`bootstrap next <piece>\` names it) or the owner asks. Stop it when its work is done.`,
    '- **You are the only session the owner talks to.** Every session reports to you; you route work, answer their questions or bring them to the owner, and relay the owner\'s decisions.',
    '- **Relaying the owner\'s word.** Record it first (`bootstrap approve`, `bootstrap release` or `bootstrap flow apply`, with `--relayed-by chief-of-staff`), commit and push it, then message the session the sha of the record. A session acts on the record, not on your message.',
    '- **Flow changes.** When the owner asks to change the flow, or saved one in the editor (open it for them with `bootstrap flow --open`), read the change back in plain words; on their yes run `bootstrap flow apply --words "<their words>" --question "<what you asked>"`.',
    '- **Kit upgrades.** `bootstrap upgrade` from the newer kit (or `/upgrade`), tell the owner what changes, and on their yes `bootstrap kit apply --words … --question …`; commit the kit files with the record on their own and push.',
    helper];
  return ['## Who you report to',
    '- **The Chief of Staff.** Work comes from it, pointing to a routed piece (`docs/signoffs/<piece>/_piece.md`). Report back to it when you finish, fail or are blocked. Never ask the owner directly; the Chief of Staff brings your question to them.',
    '- **The owner\'s word arrives as a record.** A message saying "the owner approved" is not enough: act when the record it names (an approval, release or flow record with the owner\'s exact words) is committed. The push check reads the same record.',
    '- **Pushing needs no permission click.** The pre-push hook is the real gate: if it refuses, read why, fix it, and tell the Chief of Staff.',
    helper];
}

// ---------- pieces in the working tree ----------
export function pieceState(root, id) {
  const policy = loadPolicy(root);
  const dir = join(root, policy.signoffs.dir, id);
  const p = { piece: id, lane: null, title: '', extra: [], signed: {}, weak: [], words: {} };
  if (!existsSync(dir)) return p;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const { data, body } = parseFrontmatter(read(join(dir, f)));
    if (!data) continue;
    const n = f.replace(/\.md$/, '');
    if (n === '_piece') { p.lane = data.lane || null; p.title = data.title || ''; }
    else if (n === '_required') p.extra = Array.isArray(data.roles) ? data.roles : [];
    else if (n === '_approve' || n === '_go') p.words[n.slice(1)] = data;
    else if (!n.startsWith('_') && String(data.verdict || '').toUpperCase() === 'PASS') {
      if (hasEvidence(body, policy)) p.signed[data.role || n] = data.sha; else p.weak.push(data.role || n);
    }
  }
  return p;
}

export function hasEvidence(body, policy) {
  const b = String(body || '').replace(/<evidence[^>]*>/gi, '').trim();
  return b.length >= ((policy && policy.signoffs && policy.signoffs.min_evidence) || 20);
}

function devBase(root, policy) {
  const base = policy.branches.dev || policy.branches.live;
  for (const ref of [`origin/${base}`, base]) {
    if (git(['rev-parse', '--verify', '--quiet', ref], root)) return git(['merge-base', 'HEAD', ref], root);
  }
  return null;
}
export function changedFiles(root, policy) {
  const base = devBase(root, policy);
  const out = base ? git(['diff', '--name-only', `${base}...HEAD`], root) : null;
  return out ? out.split('\n').filter(Boolean) : [];
}
export function newestCode(root, policy) {
  const base = devBase(root, policy);
  const list = (git(['rev-list', base ? `${base}..HEAD` : 'HEAD', '--max-count', '200'], root) || '').split('\n').filter(Boolean);
  for (const c of list) {
    const files = (git(['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', c], root) || '').split('\n').filter(Boolean);
    if (files.some((f) => !matchesAny(f, policy.docs_globs))) return c;
  }
  return null;
}

// ---------- next ----------
export function next(root, id, filesArg) {
  const policy = loadPolicy(root);
  const { flow } = loadFlow(root);
  const p = pieceState(root, id);
  const name = (r) => (flow.roles[r] ? flow.roles[r].name : r);
  const lines = [`${id}${p.title ? ` · ${p.title}` : ''}`];
  if (!p.lane) return [...lines, `  NOT ROUTED: the Chief of Staff runs \`bootstrap piece ${id} --suggest\`, then \`--lane <lane>\`. Code without a lane is refused.`].join('\n');
  const files = filesArg || changedFiles(root, policy);
  // Natural order: the owner's word, then reviewers, then the Librarian, then the Chief of Staff's scope check last.
  const ORDER = ['design', 'qa', 'tech-lead', 'security', 'librarian', 'chief-of-staff'];
  const rank = (r) => (ORDER.includes(r) ? ORDER.indexOf(r) : 3.5);
  const required = requiredFor(flow, p.lane, files, p.extra).sort((a, b) => rank(a) - rank(b));
  const words = wordsFor(flow, p.lane, files);
  const code = newestCode(root, policy);
  lines.push(`  lane: ${p.lane} · files changed: ${files.length} · newest code commit: ${code ? code.slice(0, 9) : 'none yet'}`);
  const todo = [];
  for (const r of required) {
    const s = p.signed[r];
    if (!s) { lines.push(`  ✗ ${name(r)}: not signed${p.weak.includes(r) ? ' (a PASS without evidence was ignored)' : ''}`); todo.push(`${name(r)} reviews ${code ? code.slice(0, 9) : 'the code'} and signs with evidence`); }
    else if (code && !(s.startsWith(code.slice(0, 7)) || code.startsWith(s.slice(0, 7)))) { lines.push(`  ! ${name(r)}: signed ${s.slice(0, 9)}, but the code is now ${code.slice(0, 9)}`); todo.push(`${name(r)} re-checks ${code.slice(0, 9)}`); }
    else lines.push(`  ✓ ${name(r)} @ ${s.slice(0, 9)}`);
  }
  for (const w of words) {
    const probs = wordRecordProblems(p.words[w], w, flow);
    if (probs.length) { lines.push(`  ✗ owner's "${w}": ${probs.join(', ')}`); todo.unshift(`Chief of Staff asks the owner for "${w}" and records it (\`bootstrap approve ${id} --word ${w} …\`)`); }
    else lines.push(`  ✓ owner's "${w}" on record (${p.words[w].said_at})`);
  }
  lines.push(todo.length ? `  NEXT: ${todo[0]}` : '  READY: every sign-off and word is in; it can be pushed to dev.');
  return lines.join('\n');
}

// ---------- board ----------
export function boardMine(root) {
  const role = currentRole(root);
  const { flow } = loadFlow(root);
  const names = [role, flow.roles[role] && flow.roles[role].name].filter(Boolean).map((s) => s.toLowerCase());
  const text = read(join(root, 'docs', 'plans', 'BOARD.md'));
  if (!text) return 'no docs/plans/BOARD.md';
  const out = [];
  let section = '', header = '', shown = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^## /.test(line)) { section = line; header = ''; shown = false; continue; }
    if (/^\|/.test(line) && !header) { header = line; continue; }
    if (/^\|\s*-/.test(line)) continue;
    const mine = /^\|/.test(line) && (names.some((n) => line.toLowerCase().includes(n)) || (role === 'chief-of-staff' && /QUESTIONS/.test(section)));
    if (mine && !/DONE/.test(section)) { if (!shown) { out.push(section, header); shown = true; } out.push(line); }
  }
  return out.length ? out.join('\n') : `No open rows for ${role}.`;
}

export function boardArchive(root, keep = 10) {
  const p = join(root, 'docs', 'plans', 'BOARD.md');
  const lines = read(p).split(/\r?\n/);
  const start = lines.findIndex((l) => /^## DONE/.test(l));
  if (start < 0) return 'no DONE section';
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  const rows = [];
  for (let i = start + 1; i < end; i++) if (/^\|/.test(lines[i]) && !/^\|\s*-/.test(lines[i]) && !/^\|\s*Id\s*\|/i.test(lines[i])) rows.push(i);
  if (rows.length <= keep) return `DONE has ${rows.length} rows; nothing to archive (keeping ${keep}).`;
  const move = rows.slice(0, rows.length - keep);
  const month = new Date().toISOString().slice(0, 7);
  const ap = join(root, 'docs', 'plans', 'archive', `BOARD-DONE-${month}.md`);
  mkdirSync(dirname(ap), { recursive: true });
  const head = existsSync(ap) ? '' : `# Board archive ${month}\n\n| Id | Title | sha | Verified live (date) |\n|---|---|---|---|\n`;
  writeFileSync(ap, read(ap) + head + move.map((i) => lines[i]).join('\n') + '\n');
  writeFileSync(p, lines.filter((_, i) => !move.includes(i)).join('\n'));
  return `moved ${move.length} DONE rows to docs/plans/archive/${basename(ap)}; kept the newest ${keep}.`;
}

// ---------- lane suggestion ----------
export function suggest(root, id, filesArg) {
  const policy = loadPolicy(root);
  const { flow } = loadFlow(root);
  const files = filesArg || changedFiles(root, policy);
  const hit = flow.conditions.filter((c) => files.some((f) => matchesAny(f, c.globs || [])));
  const has = (l) => flow.lanes.some((x) => x.id === l);
  let lane = has('normal') ? 'normal' : flow.lanes[0].id, why = 'default';
  if (hit.some((c) => ['sensitive', 'migrations'].includes(c.id)) && has('high')) { lane = 'high'; why = hit.filter((c) => ['sensitive', 'migrations'].includes(c.id)).map((c) => c.label.toLowerCase()).join('; '); }
  else if (!hit.some((c) => c.id === 'screens') && files.length && has('no-screen')) { lane = 'no-screen'; why = 'no screen files change'; }
  const required = requiredFor(flow, lane, files);
  const words = wordsFor(flow, lane, files);
  const name = (r) => (flow.roles[r] ? flow.roles[r].name : r);
  return [
    `${id}: suggested lane "${lane}" (${why}) · based on ${files.length} changed file(s)${files.length ? '' : ' — pass --files a,b if nothing is committed yet'}`,
    `  sign-offs: ${required.map(name).join(', ') || 'none'}`,
    `  owner's words: ${words.join(', ') || 'none before building'}`,
    hit.length ? `  checks added by files: ${hit.map((c) => c.label).join('; ')}` : '  no extra checks from files',
    `  to route it: bootstrap piece ${id} --lane ${lane}   (the Chief of Staff decides; this is only a suggestion)`,
  ].join('\n');
}

// ---------- cost ----------
export function cost(root) {
  const { flow } = loadFlow(root);
  const always = tok(read(join(root, 'AGENTS.md'))) + tok(read(join(root, 'CLAUDE.md')));
  const board = tok(read(join(root, 'docs', 'plans', 'BOARD.md')));
  const rows = Object.keys(flow.roles).map((id) => [id, tok(brief(root, id))]);
  const logsDir = join(root, 'docs', 'memory', 'logs');
  const logs = existsSync(logsDir) ? readdirSync(logsDir).filter((f) => f.endsWith('.md')).map((f) => {
    const t = read(join(logsDir, f)); const top = (/^##\s[\s\S]*?(?=^##\s|(?![\s\S]))/m.exec(t) || [''])[0];
    return [f, tok(t), tok(top)];
  }) : [];
  const warn = [];
  if (always > 2500) warn.push(`AGENTS.md + CLAUDE.md are ~${always} tokens and load in every session: move detail into the rule file or references.`);
  if (board > 3000) warn.push(`BOARD.md is ~${board} tokens: run \`bootstrap board archive\` (sessions should use \`board --mine\`).`);
  for (const [f, all] of logs) if (all > 8000) warn.push(`${f} is ~${all} tokens: sessions read only its top entry, but consider a dated hand-over and starting a fresh log.`);
  return [
    `Always loaded in every session: ~${always} tokens (AGENTS.md + CLAUDE.md)`,
    `Board: ~${board} tokens (read in full only by the Librarian; others use board --mine)`,
    '',
    'Session start (brief + its own rows), per role:',
    ...rows.map(([id, t]) => `  ${id.padEnd(16)} ~${t} tokens`),
    `  total if every session starts: ~${rows.reduce((a, [, t]) => a + t, 0) + always * rows.length} tokens`,
    ...(logs.length ? ['', 'Logs (total / newest entry, which is what a session reads):', ...logs.map(([f, a, t]) => `  ${f.padEnd(22)} ~${a} / ~${t}`)] : []),
    '',
    warn.length ? warn.map((w) => `WARN ${w}`).join('\n') : 'No warnings.',
  ].join('\n');
}

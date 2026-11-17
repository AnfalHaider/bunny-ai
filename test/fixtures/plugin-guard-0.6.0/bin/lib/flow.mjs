// The flow: lanes, stages, gates, conditions, words and roles — in three layers.
//   built-in (flow/defaults.json + roles/*.md)  →  company (company.json)  →  project (.bootstrap/flow.json)
// A company "floor" can only be tightened by a project, never loosened. Enforcement (pre-push, guard)
// and the editor both read the merged result from here, so what the editor shows is what gets enforced.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter } from './fm.mjs';
import { git, matchesAny } from './policy.mjs';

export const KIT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OFFICIAL_OWNERS = ['anthropics', 'agentskills', 'laravel', 'vercel', 'microsoft', 'github', 'openai', 'google', 'google-gemini', 'cursor'];
const REVIEWERS = ['qa', 'tech-lead', 'security'];

const clone = (x) => JSON.parse(JSON.stringify(x));
const uniq = (a) => [...new Set(a.filter(Boolean))];

export function builtin() {
  return JSON.parse(readFileSync(join(KIT, 'flow', 'defaults.json'), 'utf8'));
}

// ---------- roles from the brief files ----------
export function briefRoles(root) {
  const dir = root && existsSync(join(root, '.bootstrap', 'roles')) ? join(root, '.bootstrap', 'roles') : join(KIT, 'roles');
  const out = {};
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const { data, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
    if (!data || !data.id) continue;
    const grab = (label) => ((body.match(new RegExp(`\\*\\*${label}\\.\\*\\*\\s*([^\\n]+)`)) || [])[1] || '').trim();
    out[data.id] = {
      id: data.id, name: data.title, class: data.class, model: data.model,
      job: grab('Job'), never: grab('Never'),
      skills: Array.isArray(data.kit_skills) ? data.kit_skills : [],
      plugins: Array.isArray(data.kit_plugins) ? data.kit_plugins : [],
      write_globs: Array.isArray(data.write_globs) ? data.write_globs : [],
      deny: Array.isArray(data.deny) ? data.deny : [],
      sources: [],
    };
  }
  return out;
}

// ---------- presets (a starting point applied on top of the built-in lanes) ----------
export const PRESETS = {
  full: { label: 'Full company', about: 'All nine core sessions; Platform and Support when due. Best for a live product with real users.' },
  small: { label: 'Small team', about: 'Researcher folds into Design, Platform into Release Ops. Tech Lead and Security stay separate, so nobody reviews their own code.' },
  solo: { label: 'Solo', about: 'One agent plays the roles in turn and says which role it is acting as. The pre-push hook still enforces sign-offs and records.' },
  custom: { label: 'Custom', about: 'One simple lane to draw your own flow from.' },
};

export function applyPreset(flow, name) {
  const f = clone(flow);
  if (name === 'small') {
    for (const l of f.lanes) for (const s of l.stages) if (s.role === 'researcher') { s.role = 'design'; s.title = 'Research + design'; }
    f.folded = { researcher: 'design', platform: 'release-ops' };
  } else if (name === 'solo') {
    f.solo = true;
  } else if (name === 'custom') {
    f.lanes = [{
      id: 'main', name: 'Main', when: 'every piece of work',
      stages: [
        { kind: 'stage', role: 'builder', title: 'Build', produces: 'Own branch' },
        { kind: 'gate', gate: 'dev', title: 'Push to dev' },
        { kind: 'word', word: 'release', title: '"release <scope>"', produces: 'Typed or relayed' },
        { kind: 'gate', gate: 'live', title: 'Push live' },
      ],
      dev_signoffs: ['tech-lead', 'chief-of-staff'], live_word: 'release', live_exempt_signoffs: false,
    }, f.lanes.find((l) => l.id === 'hotfix')].filter(Boolean);
  }
  return f;
}

// ---------- reading layers (from the working tree, or from a commit for enforcement) ----------
function readText(root, rel, ref) {
  if (ref) return git(['show', `${ref}:${rel}`], root);
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}
function readJson(root, rel, ref) {
  const t = readText(root, rel, ref);
  if (!t) return null;
  try { return JSON.parse(t); } catch { return { __invalid: rel }; }
}

export function parseExtends(spec) {
  if (!spec) return null;
  const gh = /^github:([\w.-]+)\/([\w.-]+)(?:\/([^@]+))?@([0-9a-f]{7,40})$/i.exec(spec);
  if (gh) return { kind: 'github', owner: gh[1], repo: gh[2], path: gh[3] || 'company.json', sha: gh[4] };
  return { kind: 'path', path: spec };
}

export function loadLayers(root, { ref = null } = {}) {
  const project = (root && readJson(root, '.bootstrap/flow.json', ref)) || { version: 1 };
  let company = null;
  const ext = parseExtends(project.extends);
  if (ext && ext.kind === 'github') company = readJson(root, '.bootstrap/company.json', ref); // the reviewed, committed copy
  else if (ext && ext.kind === 'path') {
    const p = isAbsolute(ext.path) ? ext.path : resolve(root, ext.path);
    const rel = !isAbsolute(ext.path) ? ext.path.replace(/^\.\//, '') : null;
    company = rel && ref ? readJson(root, rel, ref) : (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null);
  }
  let branches = { live: 'main', dev: 'dev' };
  try { if (root) branches = { ...branches, ...JSON.parse(readFileSync(join(root, '.bootstrap', 'policy.json'), 'utf8')).branches }; } catch { /* defaults */ }
  return { builtin: builtin(), company, project, extends: ext, briefs: briefRoles(root), branches };
}

// ---------- merge ----------
function mergeById(base, over) {
  const out = base.map(clone);
  for (const item of over || []) {
    const i = out.findIndex((x) => x.id === item.id);
    if (item.removed) { if (i >= 0) out.splice(i, 1); continue; }
    if (i >= 0) out[i] = { ...out[i], ...clone(item) }; else out.push(clone(item));
  }
  return out;
}

export function floorOf(company) {
  const f = (company && company.floor) || {};
  return { signoffs: f.signoffs || {}, no_relay: f.no_relay || [], required_sources: (company && company.sources) || {} };
}

export function merge(layers) {
  const { builtin: b, company, project, briefs } = layers;
  const cdef = (company && company.defaults) || {};
  const presetName = project.preset || cdef.preset || 'full';
  let f = applyPreset(b, presetName);
  f.preset = presetName;
  for (const layer of [cdef, project]) {
    f.lanes = mergeById(f.lanes, layer.lanes);
    f.conditions = mergeById(f.conditions, layer.conditions);
    for (const [w, v] of Object.entries(layer.words || {})) f.words[w] = { ...(f.words[w] || {}), ...v };
    f.blocked_sources = uniq([...(f.blocked_sources || []), ...(layer.blocked_sources || [])]);
    if (layer.branches) f.branches = { ...(f.branches || {}), ...layer.branches };
    if (layer.naming) f.naming = layer.naming;
    if (layer.family) f.family = { ...(f.family || {}), ...layer.family };
    if (layer.helpers) f.helpers = { ...(f.helpers || {}), ...layer.helpers };
  }
  // roles: briefs → company defaults → project
  const roles = clone(briefs);
  for (const layer of [cdef, project]) {
    for (const [id, r] of Object.entries(layer.roles || {})) {
      if (r.removed) { delete roles[id]; continue; }
      roles[id] = { id, name: id, class: 'custom', skills: [], plugins: [], sources: [], write_globs: [], deny: [], ...(roles[id] || {}), ...clone(r) };
    }
  }
  // sources: company-approved (required or default) first, then the project's pasted ones
  const floor = floorOf(company);
  for (const [id, r] of Object.entries(roles)) {
    const comp = (floor.required_sources[id] || []).map((s) => ({ ...parseSource(s.repo || s), required: !!s.required, from: 'company' }));
    const own = (Array.isArray(r.sources) ? r.sources : []).map((s) => ({ ...parseSource(s), from: 'project' }));
    r.source_list = [...comp, ...own].map((s) => (s.ok && f.blocked_sources.some((b2) => s.slug.toLowerCase().startsWith(b2.toLowerCase()))
      ? { ...s, ok: false, blocked: true, kind: 'Blocked by company', why: 'Blocked in the company defaults; it will never be installed.' } : s));
  }
  f.roles = roles;
  // The project's real branches: gates are named after them, and with no dev branch the dev gate goes away.
  f.branches = { live: 'main', dev: 'dev', ...(layers.branches || {}) };
  for (const l of f.lanes) {
    if (!f.branches.dev) l.stages = l.stages.filter((s) => !(s.kind === 'gate' && s.gate === 'dev'));
    for (const s of l.stages) if (s.kind === 'gate') s.title = s.gate === 'dev' ? `Push to ${f.branches.dev}` : `Push to ${f.branches.live}`;
  }
  // floor: company minimums are added back no matter what the project says (enforcement never loosens)
  for (const l of f.lanes) {
    if (l.live_exempt_signoffs) continue;
    l.dev_signoffs = uniq([...(l.dev_signoffs || []), ...(floor.signoffs['*'] || []), ...(floor.signoffs[l.id] || [])]);
  }
  for (const w of floor.no_relay) if (f.words[w]) f.words[w].relay = false;
  f.floor = floor;
  f.company = company ? { name: company.name || 'Company', source: company.source || null, sha: company.sha || null } : null;
  return f;
}

// ---------- sources pasted per session ----------
export function parseSource(line) {
  const s = String(line || '').trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w.-]+)\/(.+?))?\/?$/i.exec(s)
    || /^([\w.-]+)\/([\w.-]+)(?:\/tree\/([\w.-]+)\/(.+?))?$/.exec(s);
  if (!m) return { line: s, ok: false, kind: 'Not a GitHub link', why: 'Paste github.com/owner/repo, owner/repo, or a link to a folder inside a repo.' };
  const [, owner, repo, ref, path] = m;
  const official = OFFICIAL_OWNERS.includes(owner.toLowerCase());
  const kind = path ? (/skill/i.test(path) ? 'Skill folder' : 'Folder') : 'Plugin / marketplace repo';
  return {
    line: s, ok: true, owner, repo, ref: ref || null, path: path || null, kind, official,
    slug: `${owner}/${repo}${path ? `/tree/${ref}/${path}` : ''}`,
    why: (path ? `Uses ${path} at ${ref}. ` : 'Bootstrap reads its plugin.json or marketplace.json. ') +
      'Searched first for this session, pinned to a commit SHA at install' +
      (official ? '.' : ', and trust-checked (hooks, MCP, install scripts) because it is not an official source.'),
  };
}

// ---------- what a piece needs ----------
export function laneOf(flow, laneId) {
  return flow.lanes.find((l) => l.id === laneId) || flow.lanes.find((l) => l.id === 'normal') || flow.lanes[0];
}

export function requiredFor(flow, laneId, files = [], extra = []) {
  const lane = laneOf(flow, laneId);
  if (!lane || lane.live_exempt_signoffs) return [];
  const byCond = flow.conditions.filter((c) => files.some((f) => matchesAny(f, c.globs || []))).flatMap((c) => c.require || []);
  return uniq([...(lane.dev_signoffs || []), ...byCond, ...extra]).sort();
}

// Owner's words a piece needs on record before its code may reach dev (e.g. "approve" for a screen
// change, "go" for HIGH work): from the lane and from every condition its files match.
export function wordsFor(flow, laneId, files = []) {
  const lane = laneOf(flow, laneId);
  if (!lane || lane.live_exempt_signoffs) return [];
  const byCond = flow.conditions.filter((c) => c.require_word && files.some((f) => matchesAny(f, c.globs || []))).map((c) => c.require_word);
  return uniq([lane.require_word, ...byCond]).sort();
}

export function wordRecordProblems(rec, word, flow) {
  if (!rec) return [`no _${word}.md record`];
  const p = [];
  for (const k of ['owner_words', 'question', 'said_at']) if (!rec[k]) p.push(k);
  if (word === 'approve' && !rec.artifact) p.push('artifact');
  const relayed = rec.relayed_by && !/^none/.test(String(rec.relayed_by));
  if (relayed && flow.words[word] && flow.words[word].relay === false) p.push(`relay not allowed for "${word}"`);
  return p;
}

// ---------- side-by-side steps ----------
// A stage with `with_previous: true` runs side by side with the stage before it (one column on the canvas).
// Only session stages can be grouped; gates and words always stand alone. Enforcement is unaffected:
// only gates and the owner's words are checked.
export function columns(lane) {
  const cols = [];
  (lane.stages || []).forEach((s, i) => {
    const prev = cols[cols.length - 1];
    if (s.with_previous && s.kind === 'stage' && prev && prev[prev.length - 1].s.kind === 'stage') prev.push({ s, i });
    else cols.push([{ s, i }]);
  });
  return cols;
}

// ---------- "Try a change": the same logic the push check uses ----------
export function suggestLaneFor(flow, hitConds) {
  const has = (l) => flow.lanes.some((x) => x.id === l);
  if (hitConds.some((c) => ['sensitive', 'migrations'].includes(c.id)) && has('high')) return 'high';
  if (!hitConds.some((c) => c.id === 'screens') && has('no-screen')) return 'no-screen';
  return has('normal') ? 'normal' : flow.lanes[0].id;
}

// condIds: the conditions a pretend change touches; docsOnly: only docs change.
export function simulate(flow, { condIds = [], docsOnly = false, laneId = null } = {}) {
  if (docsOnly) return { docsOnly: true, lane: null, required: [], words: [], added: [], path: [] };
  const hit = flow.conditions.filter((c) => condIds.includes(c.id));
  const lane = laneId && flow.lanes.some((l) => l.id === laneId) ? laneId : suggestLaneFor(flow, hit);
  const L = laneOf(flow, lane);
  const base = L.live_exempt_signoffs ? [] : (L.dev_signoffs || []);
  const added = L.live_exempt_signoffs ? [] : [...new Set(hit.flatMap((c) => c.require || []))].filter((r) => !base.includes(r));
  const words = [...new Set([L.require_word, ...hit.map((c) => c.require_word), ...(L.stages || []).filter((s) => s.kind === 'word').map((s) => s.word), L.live_word].filter(Boolean))];
  return { docsOnly: false, lane, required: [...base, ...added], added, words, path: (L.stages || []).map((_, i) => i) };
}

// ---------- checks shown in the editor and by `bootstrap flow check` ----------
export function validate(layers, flow) {
  const out = [];
  const add = (level, msg, fix = '', where = '') => out.push({ level, msg, fix, where });
  const floor = flow.floor;
  const cname = flow.company ? flow.company.name : 'Company';
  // project tried to loosen a company floor
  for (const pl of layers.project.lanes || []) {
    if (!pl.dev_signoffs) continue;
    const need = uniq([...(floor.signoffs['*'] || []), ...(floor.signoffs[pl.id] || [])]);
    const lane = flow.lanes.find((l) => l.id === pl.id);
    if (lane && lane.live_exempt_signoffs) continue;
    for (const r of need) if (!pl.dev_signoffs.includes(r)) {
      add('error', `Lane "${lane ? lane.name : pl.id}" drops ${flow.roles[r] ? flow.roles[r].name : r} from the dev gate, but ${cname} defaults require it on every code push.`,
        `Tick ${flow.roles[r] ? flow.roles[r].name : r} for this lane in Gates, or ask whoever owns the company defaults to change the rule.`, `gates:${pl.id}`);
    }
  }
  for (const [w, v] of Object.entries(layers.project.words || {})) {
    if (v.relay && floor.no_relay.includes(w)) add('error', `Relays of "${w}" are turned on, but ${cname} defaults forbid relaying it.`, 'Turn the relay off in Gates & words.', 'words');
  }
  const ids = new Set();
  for (const l of flow.lanes) {
    if (ids.has(l.id)) add('error', `Two lanes share the id "${l.id}".`, 'Rename one.', `flow:${l.id}`);
    ids.add(l.id);
    const hasLive = l.stages.some((s) => s.kind === 'gate' && s.gate === 'live');
    const hasDev = l.stages.some((s) => s.kind === 'gate' && s.gate === 'dev');
    if (hasLive && !l.live_word) add('error', `Lane "${l.name}" reaches live without one of your words.`, 'Set the live word (release or apply).', `flow:${l.id}`);
    if (hasLive && !l.stages.some((s) => s.kind === 'word' && s.word === l.live_word)) add('warning', `Lane "${l.name}" has no "${l.live_word}" step drawn before Push live.`, 'Add the word step so sessions see where it is needed.', `flow:${l.id}`);
    for (const s of l.stages) if (s.kind === 'stage' && !flow.roles[s.role]) add('error', `Lane "${l.name}" has a stage owned by "${s.role}", which is not a session.`, 'Pick a session for it, or add that session.', `flow:${l.id}`);
    if (l.stages.some((s) => s.with_previous && s.kind !== 'stage')) add('info', `Lane "${l.name}": only session steps can run side by side; a checkpoint or your word always stands alone.`, '', `flow:${l.id}`);
    if (!l.live_exempt_signoffs && (hasDev || hasLive)) {
      if (!(l.dev_signoffs || []).length) add('error', `Lane "${l.name}" lets code reach dev with no sign-offs at all.`, 'Tick at least one reviewer in Gates.', `gates:${l.id}`);
      else if (!(l.dev_signoffs || []).some((r) => REVIEWERS.includes(r))) add('warning', `Lane "${l.name}" lets code reach dev without QA, Tech Lead or Security signing. Nobody reviews the code.`, 'Tick Tech Lead or QA for this lane in Gates.', `gates:${l.id}`);
    }
    const builders = l.stages.filter((s) => s.kind === 'stage' && ['builder', 'hotfix'].includes(s.role)).map((s) => s.role);
    for (const b of builders) if ((l.dev_signoffs || []).includes(b)) add('warning', `In lane "${l.name}", ${flow.roles[b].name} signs off its own work.`, 'Untick it in Gates.', `gates:${l.id}`);
  }
  for (const r of Object.values(flow.roles)) {
    if (!r.job) add('warning', `Session "${r.name}" has no job written down.`, 'Fill it in on the Sessions tab, or remove the session.', `sessions:${r.id}`);
    for (const s of r.source_list || []) {
      if (s.blocked) add('warning', `${r.name} lists ${s.slug} as a preferred source, but ${cname} defaults block it. It will be ignored.`, 'Remove it on the Sessions tab.', `sessions:${r.id}`);
      else if (!s.ok) add('info', `${r.name}: "${s.line}" is not a GitHub link and will be ignored.`, 'Paste github.com/owner/repo links.', `sessions:${r.id}`);
    }
  }
  for (const c of flow.conditions) for (const r of c.require || []) if (!flow.roles[r]) add('error', `Condition "${c.label}" requires "${r}", which is not a session.`, 'Pick an existing session.', 'gates');
  if (flow.solo) add('info', 'Solo preset: one agent signs as several roles, so reviews are not independent. The pre-push hook still requires every sign-off file.', '', 'presets');
  const lanesToLive = flow.lanes.filter((l) => l.stages.some((s) => s.kind === 'gate' && s.gate === 'live'));
  if (lanesToLive.every((l) => l.live_word)) add('ok', 'Every lane reaches live only through a release record and one of your words.');
  if (!out.some((f) => /signs off its own work/.test(f.msg))) add('ok', 'No session signs off its own build.');
  return out;
}

// ---------- docs/flow.md ----------
export function renderMarkdown(flow) {
  const name = (id) => (flow.roles[id] ? flow.roles[id].name : id);
  const lines = ['<!-- GENERATED by the flow editor from .bootstrap/flow.json. Edit the flow, not this file. -->', '# Flow', '',
    `Preset: **${PRESETS[flow.preset] ? PRESETS[flow.preset].label : flow.preset}**${flow.company ? ` · inherits **${flow.company.name}** defaults${flow.company.sha ? ` @ \`${flow.company.sha}\`` : ''}` : ''}`, ''];
  for (const l of flow.lanes) {
    lines.push(`## ${l.name}`, '', `Used when: ${l.when || '—'}`, '', '```mermaid', 'flowchart LR');
    const cols = columns(l);
    cols.forEach((col, c) => {
      for (const { s, i } of col) {
        const label = s.kind === 'stage' ? `${name(s.role)}: ${s.title}` : s.kind === 'gate' ? `${s.title}` : `Owner: ${s.title}`;
        const shape = s.kind === 'gate' ? [`{{"`, `"}}`] : s.kind === 'word' ? [`(["`, `"])`] : [`["`, `"]`];
        lines.push(`  s${i}${shape[0]}${label.replace(/"/g, "'")}${shape[1]}`);
        if (c) for (const p of cols[c - 1]) lines.push(`  s${p.i} --> s${i}`); // side-by-side steps fan out and back in
      }
    });
    lines.push('```', '');
    if (!l.live_exempt_signoffs) lines.push(`Sign-offs before ${flow.branches.dev || flow.branches.live}: ${(l.dev_signoffs || []).map(name).join(', ') || 'none'}`);
    else lines.push('Dev gate: exempt (live breakage only).');
    lines.push(`Live word: ${l.live_word || '—'}`, '');
  }
  lines.push('## Conditions that add a sign-off', '');
  for (const c of flow.conditions) lines.push(`- ${c.label}: \`${(c.globs || []).join('`, `')}\` → ${(c.require || []).map(name).join(', ')}`);
  lines.push('', '## Sessions', '', '| Role id | Name | Class | Preferred sources |', '|---|---|---|---|');
  for (const r of Object.values(flow.roles)) {
    lines.push(`| \`${r.id}\` | ${r.name} | ${r.class || ''} | ${(r.source_list || []).filter((s) => s.ok).map((s) => `${s.slug}${s.required ? ' (company, required)' : ''}`).join('<br>') || '—'} |`);
  }
  return lines.join('\n') + '\n';
}

export function loadFlow(root, opts) {
  const layers = loadLayers(root, opts);
  const flow = merge(layers);
  return { layers, flow, findings: validate(layers, flow) };
}

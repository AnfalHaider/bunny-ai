#!/usr/bin/env node
// bootstrap — install the toolkit into a project and keep its records in the shape the checks read.
//
//   bootstrap init [--live <b>] [--dev <b>|none] [--project-hooks]  scaffold, never overwrite (branches detected if not given)
//   bootstrap role <role-id>                                     mark this worktree's session role + narrow its kit
//   bootstrap signoff <piece> --verdict PASS|FAIL [--sha S] [--role R] [--note "..."]
//   bootstrap require <piece> <role> [<role>...]                 set which roles must sign a piece
//   bootstrap release <scope> --shas a,b --words "..." --question "..." --said-at "..." --check <file> [--relayed-by chief-of-staff]
//   bootstrap piece <piece> --lane <lane-id> [--title "..."]    put a piece of work on a lane of the flow
//   bootstrap approve <piece> --word approve|go --words "..." --question "..." --said-at ... [--artifact <link>]
//   bootstrap status                                             role, policy, hooksPath, flow, sign-offs at HEAD
//   bootstrap brief <role>                                       the role's own rules + its part in the flow (send at start)
//   bootstrap next <piece> [--files a,b]                         what the piece still needs and who acts next
//   bootstrap board --mine | board archive [--keep 10]           only your rows · move old DONE rows out
//   bootstrap piece <piece> --suggest [--files a,b]              suggest a lane and extra checks from changed files
//   bootstrap cost                                               start cost per session and what is growing
//   bootstrap family                                             which sessions run from the start, which are optional; helpers
//   bootstrap upgrade                                            refresh the kit's own files from this (newer) kit (Chief of Staff)
//   bootstrap kit apply --words "..." --question "..."          record the owner's yes to the kit upgrade (Chief of Staff)
//   bootstrap flow [--open] [--port N]                           visual flow editor for this project (local only)
//   bootstrap flow --company <dir> [--open]                      edit a company defaults folder
//   bootstrap flow apply --words "..." --question "..."         record the owner's yes to the current flow (Chief of Staff)
//   bootstrap flow check                                         check the flow; exit 1 on errors (CI-friendly)
//   bootstrap flow sources [role]                                each session's preferred sources (company + project)
//   bootstrap company init <dir> [--name "Acme"]                 scaffold a company defaults folder (company.json)
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFrontmatter } from './lib/fm.mjs';
import { DEFAULT_POLICY, currentRole, detectBranches, git, globToRegex, loadPolicy, repoRoot } from './lib/policy.mjs';
import { loadFlow, renderMarkdown } from './lib/flow.mjs';
import { boardArchive, boardMine, brief, cost, family, helpersOf, newestCode, next, suggest } from './lib/ops.mjs';
import { FLOW_CHANGES_DIR, KIT_CHANGES_DIR, completeSignoffs, hashText } from './prepush.mjs';
import { runFlowUi } from './flow-ui.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
const today = () => new Date().toISOString().slice(0, 10);
const log = (state, what) => console.log(`${state.padEnd(7)} ${what}`);

function arg(args, name, dflt) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
}

function copyTree(src, dst, { overwrite = false } = {}) {
  for (const e of readdirSync(src)) {
    const s = join(src, e);
    const d = join(dst, e);
    if (statSync(s).isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d, { overwrite }); continue; }
    const existed = existsSync(d);
    if (existed && !overwrite) { log('SKIP', `${d} exists`); continue; }
    mkdirSync(dirname(d), { recursive: true });
    copyFileSync(s, d);
    log(existed ? 'UPDATE' : 'CREATE', d);
  }
}

function writeOnce(path, content) {
  if (existsSync(path)) return log('SKIP', `${path} exists`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  log('CREATE', path);
}

function backup(path) {
  if (!existsSync(path)) return null;
  const b = `${path}.bak-${Date.now()}`;
  copyFileSync(path, b);
  log('BACKUP', `${path} -> ${b}   (rollback: copy it back)`);
  return b;
}

function init(root, args, { upgrading = false } = {}) {
  const found = detectBranches(root);
  const live = arg(args, 'live', found.live);
  const devArg = arg(args, 'dev', found.dev);
  const dev = !devArg || devArg === 'none' ? null : devArg;
  const kept = loadPolicy(root);
  if (kept) log('BRANCH', `live: ${kept.branches.live} · dev: ${kept.branches.dev || 'none'} (kept from .bootstrap/policy.json)`);
  else log('BRANCH', `live: ${live}${arg(args, 'live') ? '' : ' (detected)'} · dev: ${dev || 'none: pieces go to live through a release'}${arg(args, 'dev') ? '' : ' (detected)'}`);
  // Toolkit code is refreshed on every init (it is ours); everything else is written once.
  copyTree(join(KIT, 'bin'), join(root, '.bootstrap', 'bin'), { overwrite: true });
  writeFileSync(join(root, '.bootstrap', 'kit.json'), JSON.stringify({ version: kitVersion() }, null, 2) + '\n');
  copyTree(join(KIT, 'flow'), join(root, '.bootstrap', 'flow'), { overwrite: true });
  copyTree(join(KIT, 'ui'), join(root, '.bootstrap', 'ui'), { overwrite: true });
  copyTree(join(KIT, 'roles'), join(root, '.bootstrap', 'roles'));
  // --size picks a starting preset so small projects are not buried in process: prototype → solo, small → small team, live → full.
  const size = arg(args, 'size', 'live');
  const preset = { prototype: 'solo', small: 'small', live: 'full' }[size];
  if (!preset) { console.error('--size prototype|small|live'); process.exit(1); }
  writeOnce(join(root, '.bootstrap', 'flow.json'), JSON.stringify({ version: 1, preset, size }, null, 2) + '\n');
  writeOnce(join(root, '.bootstrap', 'policy.json'),
    JSON.stringify({ version: 1, branches: { live, dev }, destructive_commands: [], deny_all: DEFAULT_POLICY.deny_all }, null, 2) + '\n');
  copyTree(join(KIT, 'templates', 'project'), root);
  const agents = join(root, 'AGENTS.md');
  if (existsSync(agents)) writeFileSync(agents, readFileSync(agents, 'utf8').replace('`<main>` / `<dev>`', `\`${live}\` / ${dev ? `\`${dev}\`` : 'none (pieces go to live through a release)'}`));
  for (const d of ['docs/memory/lessons', 'docs/memory/logs', 'docs/signoffs', 'docs/releases', 'docs/research', 'docs/adr', 'docs/security']) {
    writeOnce(join(root, d, '.gitkeep'), '');
  }
  writeOnce(join(root, '.githooks', 'pre-push'), readFileSync(join(KIT, 'githooks', 'pre-push'), 'utf8').replace(/\r\n/g, '\n'));
  // git silently ignores a hook that is not executable (macOS/Linux); force LF so sh can run it.
  chmodSync(join(root, '.githooks', 'pre-push'), 0o755);
  git(['config', 'core.hooksPath', '.githooks'], root);
  log('SET', 'git config core.hooksPath .githooks   (rollback: git config --unset core.hooksPath)');

  const gi = join(root, '.gitignore');
  const have = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
  const add = ['.bootstrap/session.json', '.bootstrap/helpers/', '.claude/settings.local.json', '*.bak-*'].filter((l) => !have.split(/\r?\n/).includes(l));
  if (add.length) { writeFileSync(gi, have + (have && !have.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n'); log('APPEND', `.gitignore: ${add.join(', ')}`); }

  // Sessions push and run the kit without a permission click: the pre-push hook and the guard are the real gates.
  {
    const p = join(root, '.claude', 'settings.json');
    const s = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    const want = ['Bash(git push:*)', 'Bash(node .bootstrap/bin/bootstrap.mjs:*)', 'Bash(node .bootstrap/bin/mem.mjs:*)'];
    s.permissions ||= {}; s.permissions.allow ||= [];
    const missing = want.filter((w) => !s.permissions.allow.includes(w));
    if (missing.length) {
      backup(p);
      s.permissions.allow.push(...missing);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
      log('UPDATE', `${p}: allow ${missing.join(', ')} (the pre-push hook still checks every push)`);
    }
  }

  if (args.includes('--project-hooks')) {
    const p = join(root, '.claude', 'settings.json');
    const s = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    const cmd = 'node "$CLAUDE_PROJECT_DIR/.bootstrap/bin/guard.mjs"';
    s.hooks ||= {};
    s.hooks.PreToolUse ||= [];
    if (!JSON.stringify(s.hooks.PreToolUse).includes('guard.mjs')) {
      backup(p);
      s.hooks.PreToolUse.push({ matcher: 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|Agent|Task', hooks: [{ type: 'command', command: cmd, timeout: 10 }] });
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
      log('UPDATE', `${p}: PreToolUse guard (works without the plugin, e.g. cloud sessions)`);
    } else log('SKIP', `${p} already has the guard`);
  }
  if (!upgrading) console.log('\nNext: edit .bootstrap/policy.json destructive_commands with the answers to Phase 0H, then `bootstrap role <id>` in each worktree.');
}

// Plugins switched on for this folder before any local override: user settings (every project) then
// the project's own settings, later layers winning. CLAUDE_CONFIG_DIR is honoured like Claude Code does.
export function enabledPluginIds(root) {
  const read = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')).enabledPlugins || {}; } catch { return {}; } };
  const home = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const on = new Set();
  for (const f of [join(home, 'settings.json'), join(root, '.claude', 'settings.json')]) {
    for (const [pid, v] of Object.entries(read(f))) { if (v) on.add(pid); else on.delete(pid); }
  }
  return [...on];
}

function role(root, id) {
  const brief = join(root, '.bootstrap', 'roles', `${id}.md`);
  if (!existsSync(brief)) { console.error(`no role brief ${brief}; run init first or pick one of: ${readdirSync(join(root, '.bootstrap', 'roles')).map((f) => f.replace(/\.md$/, '')).join(', ')}`); process.exit(1); }
  const data = parseFrontmatter(readFileSync(brief, 'utf8')).data || {};
  writeFileSync(join(root, '.bootstrap', 'session.json'), JSON.stringify({ role: id, since: new Date().toISOString() }, null, 2) + '\n');
  log('WRITE', `.bootstrap/session.json role=${id}`);

  // Claude Code layer: per-worktree permission denials and plugin narrowing (7C).
  const p = join(root, '.claude', 'settings.local.json');
  const s = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  backup(p);
  s.permissions ||= {};
  s.permissions.deny = [...new Set([...(s.permissions.deny || []), ...(data.deny || [])])];
  // The kit comes from the merged flow (so editor changes count), falling back to the role file.
  let kit = Array.isArray(data.kit_plugins) ? data.kit_plugins : [];
  try { const fr = loadFlow(root).flow.roles[id]; if (fr && Array.isArray(fr.plugins) && fr.plugins.length) kit = fr.plugins; } catch { /* keep the role file's kit */ }
  // Every plugin that would load in this folder: enabled for the user (all projects) or for this project.
  // Both must be narrowed, or user-level plugins ride along in every permanent session.
  const installed = enabledPluginIds(root);
  if (installed.length && kit.length) {
    s.enabledPlugins ||= {};
    // kit entries are plugin names, optionally with * wildcards ("*-lsp" = every language server).
    for (const id2 of installed) {
      const name = id2.split('@')[0];
      s.enabledPlugins[id2] = name === 'bootstrap-environment' || kit.some((k) => globToRegex(k).test(name));
    }
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
  log('WRITE', `${p}: ${s.permissions.deny.length} deny rules${installed.length ? `, ${Object.values(s.enabledPlugins || {}).filter(Boolean).length}/${installed.length} plugins enabled` : ''}`);
  console.log('Verify (R14): open this session\'s skill/tool list and confirm it shows only its kit.');
}

// A session acts only as its own role. Outside a session (no .bootstrap/session.json) it is the owner at
// a terminal, who may record anything. Inside one, record commands are limited the same way the guard is.
function kitVersion() {
  try { return JSON.parse(readFileSync(join(KIT, 'package.json'), 'utf8')).version; } catch { return 'unknown'; }
}
function installedVersion(root) {
  try { return JSON.parse(readFileSync(join(root, '.bootstrap', 'kit.json'), 'utf8')).version; } catch { return 'before 0.6.0'; }
}

// Run from the NEWER kit (the plugin) inside the project: refresh the kit's own files, keep everything the
// project owns (policy, flow, roles it edited, records). The push needs the owner's yes: `bootstrap kit apply`.
function upgrade(root, args) {
  mustBe(root, ['chief-of-staff'], '`bootstrap upgrade`');
  if (!loadPolicy(root)) { console.error('This project is not bootstrapped yet: run `bootstrap init` instead.'); process.exit(1); }
  const from = installedVersion(root), to = kitVersion();
  init(root, args.filter((a) => a !== "--project-hooks"), { upgrading: true });
  const changed = (git(['status', '--porcelain', '--', ...KIT_UPGRADE_DIRS], root) || '').split('\n').filter(Boolean);
  console.log(`\nKit ${from} → ${to}: ${changed.length} kit file(s) changed.`);
  console.log(changed.length
    ? 'Next (Chief of Staff): tell the owner what this upgrade changes (CHANGELOG.md of the kit), ask "Apply the kit upgrade?", and on their yes run\n  bootstrap kit apply --words "<their words>" --question "<what you asked>"\nthen commit the kit files with the record and push.'
    : 'Nothing to apply: the project already has this kit.');
}

const KIT_UPGRADE_DIRS = ['.bootstrap/bin', '.bootstrap/flow', '.bootstrap/ui', '.bootstrap/roles', '.bootstrap/kit.json', '.githooks', '.claude/settings.json', '.gitignore'];

// The owner said yes to a kit upgrade: record every kit file's sha256 (and files the upgrade removed).
function kitApply(root, args) {
  mustBe(root, ['chief-of-staff'], '`bootstrap kit apply`');
  const missing = ['words', 'question'].filter((n) => !arg(args, n));
  if (missing.length) { console.error(`missing --${missing.join(', --')}: the owner's exact words and the question you asked`); process.exit(1); }
  const listed = (git(['ls-files', '--cached', '--others', '--exclude-standard', '--', ...KIT_UPGRADE_DIRS], root) || '').split('\n').filter(Boolean);
  const files = [...new Set(listed)].sort().map((f) => {
    const p = join(root, f);
    return `${f}@${existsSync(p) ? hashText(readFileSync(p, 'utf8')) : 'deleted'}`;
  });
  const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
  const ver = installedVersion(root);
  const p = join(root, KIT_CHANGES_DIR, `${today()}-kit-${String(ver).replace(/[^\w.-]/g, '_')}.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\nkit_version: ${ver}\nowner_words: ${q(arg(args, 'words'))}\nquestion: ${q(arg(args, 'question'))}\nsaid_at: ${arg(args, 'said-at', new Date().toISOString())}\nrelayed_by: ${arg(args, 'relayed-by', 'chief-of-staff')}\nfiles:\n${files.map((f) => `  - ${f}`).join('\n')}\n---\n`);
  log('CREATE', p);
  console.log(`Recorded the owner's yes for ${files.length} kit file(s). Commit them with ${p.slice(root.length + 1).replace(/\\/g, '/')} and push; the push check accepts a kit-only change with this record.`);
}

function mustBe(root, allowed, what) {
  const me = currentRole(root);
  if (me !== 'unassigned' && !allowed.includes(me)) { console.error(`${what} is for ${allowed.join(' / ')} only; this session is "${me}".`); process.exit(1); }
  return me;
}

function signoff(root, piece, args) {
  const me = currentRole(root);
  const r = arg(args, 'role', me);
  if (me !== 'unassigned' && r !== me) { console.error(`This session is "${me}"; it cannot sign as "${r}". A session signs only as itself.`); process.exit(1); }
  // Sign the code, not the tip: other sessions' sign-off commits (docs only) sit on top of it.
  const policy = loadPolicy(root);
  const sha = arg(args, 'sha', (policy && newestCode(root, policy)) || git(['rev-parse', 'HEAD'], root));
  const verdict = (arg(args, 'verdict', '') || '').toUpperCase();
  if (!['PASS', 'FAIL'].includes(verdict)) { console.error('--verdict PASS|FAIL is required'); process.exit(1); }
  if (r === 'unassigned') { console.error('no role: run `bootstrap role <id>` (or, as the owner outside a session, pass --role)'); process.exit(1); }
  const evidence = arg(args, 'evidence-file') ? readFileSync(arg(args, 'evidence-file'), 'utf8').trim() : (arg(args, 'note', '') || '').trim();
  if (verdict === 'PASS' && evidence.length < 20) { console.error('A PASS needs evidence: --note "<command and its output, or file:line>" (20+ characters) or --evidence-file <file>. Without it the push check ignores the sign-off.'); process.exit(1); }
  const p = join(root, 'docs', 'signoffs', piece, `${r}.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\npiece: ${piece}\nrole: ${r}\nsha: ${sha}\nverdict: ${verdict}\ndate: ${today()}\n---\n\n${evidence || '<evidence: command, output, file:line>'}\n`);
  log('WRITE', `${p} (${verdict} @ ${sha.slice(0, 9)}) — commit it as a docs-only commit`);
}

function approve(root, piece, args) {
  mustBe(root, ['chief-of-staff'], '`bootstrap approve`');
  const word = arg(args, 'word', 'approve');
  if (!['approve', 'go'].includes(word)) { console.error('--word approve|go'); process.exit(1); }
  const missing = ['words', 'question', 'said-at'].filter((n) => !arg(args, n));
  if (word === 'approve' && !arg(args, 'artifact')) missing.push('artifact');
  if (missing.length) { console.error(`missing --${missing.join(', --')}  (the owner's exact words, the question exactly as asked, when${word === 'approve' ? ', and the approved artifact link' : ''})`); process.exit(1); }
  const relayed = arg(args, 'relayed-by', 'none (typed in this chat)');
  const { flow } = loadFlow(root);
  if (relayed.startsWith('chief-of-staff') && flow.words[word] && flow.words[word].relay === false) { console.error(`Relays of "${word}" are turned off in the flow; the owner must type it in the acting session.`); process.exit(1); }
  const p = join(root, 'docs', 'signoffs', piece, `_${word}.md`);
  mkdirSync(dirname(p), { recursive: true });
  const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
  writeFileSync(p, `---\npiece: ${piece}\nword: ${word}\nowner_words: ${q(arg(args, 'words'))}\nquestion: ${q(arg(args, 'question'))}\nsaid_at: ${arg(args, 'said-at')}\nrelayed_by: ${relayed}\n${word === 'approve' ? `artifact: ${arg(args, 'artifact')}\n` : ''}date: ${today()}\n---\n`);
  log('WRITE', `${p} — commit it as a docs-only commit`);
}

function requireRoles(root, piece, roles) {
  mustBe(root, ['chief-of-staff', 'security'], '`bootstrap require`');
  const p = join(root, 'docs', 'signoffs', piece, '_required.md');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\npiece: ${piece}\nroles: [${roles.join(', ')}]\nset_by: ${currentRole(root)}\ndate: ${today()}\n---\n`);
  log('WRITE', `${p}: ${roles.join(', ')}`);
}

function release(root, scope, args) {
  mustBe(root, ['chief-of-staff', 'release-ops', 'hotfix'], '`bootstrap release`');
  const need = ['shas', 'words', 'question', 'said-at', 'check'];
  const missing = need.filter((n) => !arg(args, n));
  if (missing.length) { console.error(`missing --${missing.join(', --')}  (7E: words + question + date, shas, pasted check)`); process.exit(1); }
  const check = readFileSync(arg(args, 'check'), 'utf8').trim();
  if (!check) { console.error('the pre-release check output is empty: no pasted check, no release'); process.exit(1); }
  const shas = arg(args, 'shas').split(',').map((s) => s.trim()).filter(Boolean);
  const slug = scope.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const p = join(root, 'docs', 'releases', `${today()}-${slug}.md`);
  writeOnce(p, `---\nscope: ${scope}\nword: release ${scope}\nowner_words: "${arg(args, 'words').replace(/"/g, "'")}"\nquestion: "${arg(args, 'question').replace(/"/g, "'")}"\nsaid_at: ${arg(args, 'said-at')}\nrelayed_by: ${arg(args, 'relayed-by', 'none (typed in this chat)')}\nshas: [${shas.join(', ')}]\n---\n\n## Pre-release check\n\n\`\`\`\n${check}\n\`\`\`\n`);
}

function status(root) {
  const policy = loadPolicy(root);
  console.log(`role:        ${currentRole(root)}`);
  console.log(`policy:      ${policy ? `live=${policy.branches.live} dev=${policy.branches.dev || 'none'}` : 'NOT BOOTSTRAPPED'}`);
  console.log(`hooksPath:   ${git(['config', 'core.hooksPath'], root) || 'UNSET (pre-push checks will not run)'}`);
  if (policy) {
    const hasFlow = existsSync(join(root, '.bootstrap', 'flow.json'));
    const { flow, findings } = loadFlow(root);
    console.log(`flow:        ${hasFlow ? `${flow.lanes.map((l) => l.id).join(', ')} (preset ${flow.preset})` : 'built-in defaults (no .bootstrap/flow.json)'}${flow.company ? ` · inherits ${flow.company.name}` : ''}`);
    const errs = findings.filter((f) => f.level === 'error');
    if (errs.length) console.log(`flow errors: ${errs.map((f) => f.msg).join(' | ')}`);
    const head = git(['rev-parse', 'HEAD'], root);
    const done = head ? completeSignoffs(root, head, policy) : [];
    console.log(`signed off:  ${done.length ? done.map((d) => `${d.piece}@${d.sha.slice(0, 9)}`).join(', ') : 'nothing complete at HEAD (legacy count; the pre-push hook applies the flow per piece)'}`);
  }
}

function piece(root, id, args) {
  if (args.includes('--suggest')) { const f = arg(args, 'files'); return console.log(suggest(root, id, f ? f.split(',').map((x) => x.trim()) : null)); }
  mustBe(root, ['chief-of-staff'], '`bootstrap piece`');
  const laneId = arg(args, 'lane', null);
  if (!laneId) { console.error('--lane <lane-id> is required: the Chief of Staff decides the lane for every piece.'); process.exit(1); }
  const { flow } = loadFlow(root);
  if (!flow.lanes.some((l) => l.id === laneId)) { console.error(`no lane "${laneId}"; lanes: ${flow.lanes.map((l) => l.id).join(', ')}`); process.exit(1); }
  const p = join(root, 'docs', 'signoffs', id, '_piece.md');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\npiece: ${id}\nlane: ${laneId}\ntitle: "${(arg(args, 'title', '') || '').replace(/"/g, "'")}"\nset_by: ${currentRole(root)}\ndate: ${today()}\n---\n`);
  log('WRITE', `${p}: lane ${laneId} — commit it as a docs-only commit`);
}

// The owner said yes to a flow change (in chat with the Chief of Staff, or saved in the editor and confirmed).
function flowApply(root, args) {
  mustBe(root, ['chief-of-staff'], '`bootstrap flow apply`');
  const missing = ['words', 'question'].filter((n) => !arg(args, n));
  if (missing.length) { console.error(`missing --${missing.join(', --')}: the owner's exact words and the question you asked`); process.exit(1); }
  const fp = join(root, '.bootstrap', 'flow.json');
  if (!existsSync(fp)) { console.error('no .bootstrap/flow.json to apply'); process.exit(1); }
  const { flow, findings } = loadFlow(root);
  const errs = findings.filter((f) => f.level === 'error');
  if (errs.length) { console.error(`the flow has errors; fix them before asking the owner:\n  ${errs.map((f) => f.msg).join('\n  ')}`); process.exit(1); }
  writeFileSync(join(root, 'docs', 'flow.md'), renderMarkdown(flow));
  const flowHash = hashText(readFileSync(fp, 'utf8'));
  const cp = join(root, '.bootstrap', 'company.json');
  const q = (s) => `"${String(s).replace(/"/g, "'")}"`;
  const p = join(root, FLOW_CHANGES_DIR, `${today()}-${flowHash.slice(0, 8)}.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\nowner_words: ${q(arg(args, 'words'))}\nquestion: ${q(arg(args, 'question'))}\nsaid_at: ${arg(args, 'said-at', new Date().toISOString())}\nrelayed_by: ${arg(args, 'relayed-by', 'chief-of-staff')}\nflow_sha256: ${flowHash}\n${existsSync(cp) ? `company_sha256: ${hashText(readFileSync(cp, 'utf8'))}\n` : ''}---\n\n${arg(args, 'summary', '')}\n`);
  log('CREATE', `${p}`);
  log('UPDATE', 'docs/flow.md');
  console.log(`Commit .bootstrap/flow.json, docs/flow.md and ${p.slice(root.length + 1).replace(/\\/g, '/')} together, then push. The push check accepts a flow-only change with this record.`);
}

function flowCmd(root, args) {
  if (args[0] === 'apply') return flowApply(root, args.slice(1));
  if (args[0] === 'check') {
    const { findings } = loadFlow(root);
    for (const f of findings) console.log(`${f.level.toUpperCase().padEnd(7)} ${f.msg}${f.fix ? `\n        fix: ${f.fix}` : ''}`);
    const errs = findings.filter((f) => f.level === 'error').length;
    console.log(errs ? `flow check FAILED (${errs})` : 'flow check OK');
    process.exit(errs ? 1 : 0);
  }
  if (args[0] === 'sources') {
    const { flow } = loadFlow(root);
    for (const r of Object.values(flow.roles)) {
      if (args[1] && r.id !== args[1]) continue;
      const ok = (r.source_list || []).filter((s) => s.ok);
      if (!ok.length && args[1] === undefined) continue;
      console.log(`${r.id}:`);
      for (const s of r.source_list || []) console.log(`  ${s.ok ? (s.required ? 'REQUIRED' : s.from === 'company' ? 'COMPANY ' : 'PREFER  ') : s.blocked ? 'BLOCKED ' : 'INVALID '} ${s.ok ? s.slug : s.line}${s.ok && !s.official ? '  (trust-check before install)' : ''}`);
    }
    return;
  }
  return runFlowUi(args);
}

function familyCmd(root) {
  const { flow } = loadFlow(root);
  const f = family(flow), h = helpersOf(flow);
  const name = (id) => `${flow.roles[id].name} (${id})`;
  console.log(`On from the start: ${f.on.map(name).join(', ')}`);
  console.log(`Optional (the Chief of Staff starts one when a piece needs it, or the owner asks): ${f.optional.map(name).join(', ') || 'none'}`);
  if (f.off.length) console.log(`Off: ${f.off.map(name).join(', ')}`);
  console.log(`Branches: live ${flow.branches.live} · dev ${flow.branches.dev || 'none (pieces go to live through a release)'}`);
  console.log(`Helpers: at most ${h.max_per_session} per session, model ${h.model}`);
}

function companyInit(dir, args) {
  const p = join(resolve(dir), 'company.json');
  writeOnce(p, JSON.stringify({
    version: 1,
    name: arg(args, 'name', 'Company'),
    defaults: { preset: 'full', blocked_sources: [] },
    floor: { signoffs: { '*': ['tech-lead'], high: ['security'] }, no_relay: [] },
    sources: {},
  }, null, 2) + '\n');
  console.log(`Edit it with: bootstrap flow --company ${dir}\nProjects inherit it by setting "Defaults live in" to github:<owner>/<repo>@<sha> (or a path) in their flow editor.`);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === 'company' && args[0] === 'init' && args[1]) return companyInit(args[1], args.slice(2));
  if (cmd === 'flow' && args.includes('--company')) return runFlowUi(args);
  const root = repoRoot(process.cwd());
  if (!root) { console.error('not inside a git repository'); process.exit(1); }
  if (cmd === 'init') init(root, args);
  else if (cmd === 'piece' && args[0]) piece(root, args[0], args.slice(1));
  else if (cmd === 'approve' && args[0]) approve(root, args[0], args.slice(1));
  else if (cmd === 'flow') flowCmd(root, args);
  else if (cmd === 'role' && args[0]) role(root, args[0]);
  else if (cmd === 'signoff' && args[0]) signoff(root, args[0], args.slice(1));
  else if (cmd === 'require' && args[1]) requireRoles(root, args[0], args.slice(1));
  else if (cmd === 'release' && args[0]) release(root, args[0], args.slice(1));
  else if (cmd === 'status') status(root);
  else if (cmd === 'brief' && args[0]) process.stdout.write(brief(root, args[0]));
  else if (cmd === 'next' && args[0]) { const f = arg(args, 'files'); console.log(next(root, args[0], f ? f.split(',').map((x) => x.trim()) : null)); }
  else if (cmd === 'board' && args[0] === '--mine') console.log(boardMine(root));
  else if (cmd === 'board' && args[0] === 'archive') console.log(boardArchive(root, Number(arg(args, 'keep', 10))));
  else if (cmd === 'cost') console.log(cost(root));
  else if (cmd === 'family') familyCmd(root);
  else if (cmd === 'upgrade') upgrade(root, args);
  else if (cmd === 'kit' && args[0] === 'apply') kitApply(root, args.slice(1));
  else { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1).filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//'))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

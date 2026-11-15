#!/usr/bin/env node
// bootstrap — install the toolkit into a project and keep its records in the shape the checks read.
//
//   bootstrap init [--live main] [--dev dev] [--project-hooks]   scaffold, never overwrite
//   bootstrap role <role-id>                                     mark this worktree's session role + narrow its kit
//   bootstrap signoff <piece> --verdict PASS|FAIL [--sha S] [--role R] [--note "..."]
//   bootstrap require <piece> <role> [<role>...]                 set which roles must sign a piece
//   bootstrap release <scope> --shas a,b --words "..." --question "..." --said-at "..." --check <file> [--relayed-by chief-of-staff]
//   bootstrap status                                             role, policy, hooksPath, sign-offs at HEAD
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFrontmatter } from './lib/fm.mjs';
import { DEFAULT_POLICY, currentRole, git, globToRegex, loadPolicy, repoRoot } from './lib/policy.mjs';
import { completeSignoffs } from './prepush.mjs';

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

function init(root, args) {
  const live = arg(args, 'live', DEFAULT_POLICY.branches.live);
  const dev = arg(args, 'dev', DEFAULT_POLICY.branches.dev);
  // Toolkit code is refreshed on every init (it is ours); everything else is written once.
  copyTree(join(KIT, 'bin'), join(root, '.bootstrap', 'bin'), { overwrite: true });
  copyTree(join(KIT, 'roles'), join(root, '.bootstrap', 'roles'));
  writeOnce(join(root, '.bootstrap', 'policy.json'),
    JSON.stringify({ version: 1, branches: { live, dev }, destructive_commands: [], deny_all: DEFAULT_POLICY.deny_all }, null, 2) + '\n');
  copyTree(join(KIT, 'templates', 'project'), root);
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
  const add = ['.bootstrap/session.json', '.claude/settings.local.json', '*.bak-*'].filter((l) => !have.split(/\r?\n/).includes(l));
  if (add.length) { writeFileSync(gi, have + (have && !have.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n'); log('APPEND', `.gitignore: ${add.join(', ')}`); }

  if (args.includes('--project-hooks')) {
    const p = join(root, '.claude', 'settings.json');
    const s = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
    const cmd = 'node "$CLAUDE_PROJECT_DIR/.bootstrap/bin/guard.mjs"';
    s.hooks ||= {};
    s.hooks.PreToolUse ||= [];
    if (!JSON.stringify(s.hooks.PreToolUse).includes('guard.mjs')) {
      backup(p);
      s.hooks.PreToolUse.push({ matcher: 'Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit', hooks: [{ type: 'command', command: cmd, timeout: 10 }] });
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
      log('UPDATE', `${p}: PreToolUse guard (works without the plugin, e.g. cloud sessions)`);
    } else log('SKIP', `${p} already has the guard`);
  }
  console.log('\nNext: edit .bootstrap/policy.json destructive_commands with the answers to Phase 0H, then `bootstrap role <id>` in each worktree.');
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
  const kit = Array.isArray(data.kit_plugins) ? data.kit_plugins : [];
  const projectSettings = join(root, '.claude', 'settings.json');
  const installed = existsSync(projectSettings) ? Object.keys(JSON.parse(readFileSync(projectSettings, 'utf8')).enabledPlugins || {}) : [];
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

function signoff(root, piece, args) {
  const r = arg(args, 'role', currentRole(root));
  const sha = arg(args, 'sha', git(['rev-parse', 'HEAD'], root));
  const verdict = (arg(args, 'verdict', '') || '').toUpperCase();
  if (!['PASS', 'FAIL'].includes(verdict)) { console.error('--verdict PASS|FAIL is required'); process.exit(1); }
  if (r === 'unassigned') { console.error('no role: run `bootstrap role <id>` or pass --role'); process.exit(1); }
  const p = join(root, 'docs', 'signoffs', piece, `${r}.md`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\npiece: ${piece}\nrole: ${r}\nsha: ${sha}\nverdict: ${verdict}\ndate: ${today()}\n---\n\n${arg(args, 'note', '') || '<evidence: command, output, file:line>'}\n`);
  log('WRITE', `${p} (${verdict} @ ${sha.slice(0, 9)}) — commit it as a docs-only commit`);
}

function requireRoles(root, piece, roles) {
  const p = join(root, 'docs', 'signoffs', piece, '_required.md');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `---\npiece: ${piece}\nroles: [${roles.join(', ')}]\nset_by: ${currentRole(root)}\ndate: ${today()}\n---\n`);
  log('WRITE', `${p}: ${roles.join(', ')}`);
}

function release(root, scope, args) {
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
  console.log(`policy:      ${policy ? `live=${policy.branches.live} dev=${policy.branches.dev}` : 'NOT BOOTSTRAPPED'}`);
  console.log(`hooksPath:   ${git(['config', 'core.hooksPath'], root) || 'UNSET (pre-push checks will not run)'}`);
  if (policy) {
    const head = git(['rev-parse', 'HEAD'], root);
    const done = head ? completeSignoffs(root, head, policy) : [];
    console.log(`signed off:  ${done.length ? done.map((d) => `${d.piece}@${d.sha.slice(0, 9)}`).join(', ') : 'nothing complete at HEAD'}`);
  }
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const root = repoRoot(process.cwd());
  if (!root) { console.error('not inside a git repository'); process.exit(1); }
  if (cmd === 'init') init(root, args);
  else if (cmd === 'role' && args[0]) role(root, args[0]);
  else if (cmd === 'signoff' && args[0]) signoff(root, args[0], args.slice(1));
  else if (cmd === 'require' && args[1]) requireRoles(root, args[0], args.slice(1));
  else if (cmd === 'release' && args[0]) release(root, args[0], args.slice(1));
  else if (cmd === 'status') status(root);
  else { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

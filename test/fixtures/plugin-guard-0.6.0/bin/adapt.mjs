#!/usr/bin/env node
// adapt — generate a tool's native files from the one source (AGENTS.md, skills/, roles/).
//   adapt <tool> [--dry-run]      tools: claude-code cursor codex copilot antigravity devin kiro opencode cline aider zed junie amp chatgpt
//   adapt list                    show tools and what each gets
// Never overwrites an existing file (SKIP is reported). Run from the project root after `bootstrap init`.
// Formats follow each vendor's docs as of 2026-11 (see docs/compatibility.md). Re-check them before relying on them (R14).
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseFrontmatter } from './lib/fm.mjs';
import { repoRoot } from './lib/policy.mjs';

const KIT = join(dirname(fileURLToPath(import.meta.url)), '..');
let DRY = false;

function out(root, rel, content) {
  const p = join(root, rel);
  if (existsSync(p)) return console.log(`SKIP    ${rel} exists`);
  if (DRY) return console.log(`WOULD   ${rel}`);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  console.log(`CREATE  ${rel}`);
}

function copyDir(root, src, relDst) {
  for (const e of readdirSync(src)) {
    const s = join(src, e);
    if (statSync(s).isDirectory()) copyDir(root, s, `${relDst}/${e}`);
    else out(root, `${relDst}/${e}`, readFileSync(s));
  }
}

function roles(root) {
  const dir = existsSync(join(root, '.bootstrap', 'roles')) ? join(root, '.bootstrap', 'roles') : join(KIT, 'roles');
  return readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => {
    const { data, body } = parseFrontmatter(readFileSync(join(dir, f), 'utf8'));
    return { ...data, body: body.trim() };
  });
}

const docsOnly = (r) => r.may_push_dev === 'docs-only';
const oneLine = (r) => `${r.title}: ${(r.body.match(/\*\*Job\.\*\*\s*([^.]*\.)/) || [, r.title])[1]}`.replace(/"/g, "'");
const POINTER = 'Follow AGENTS.md (standing rules) and your role brief in .bootstrap/roles/<role-id>.md. The pre-push hook in .githooks enforces sign-offs and release records; never bypass it with --no-verify.\n';

// Shared: the skill in the cross-tool location (.agents/skills is read by Codex, Cursor, Copilot, Antigravity, Devin, OpenCode, Amp).
const sharedSkill = (root) => copyDir(root, join(KIT, 'skills', 'bootstrap-environment'), '.agents/skills/bootstrap-environment');

const TOOLS = {
  'claude-code': {
    gets: 'CLAUDE.md importing AGENTS.md; plugin install line; project-level guard hook via `bootstrap init --project-hooks`',
    run(root) {
      out(root, 'CLAUDE.md', '@AGENTS.md\n');
      console.log('\nInstall: claude plugin marketplace add AnfalHaider/Bootstrap-environment && claude plugin install bootstrap-environment@bootstrap-environment --scope project');
    },
  },
  cursor: {
    gets: '.cursor/rules/bootstrap.mdc (always on), .cursor/agents/<role>.md subagents (docs roles readonly), skill in .agents/skills',
    run(root) {
      sharedSkill(root);
      out(root, '.cursor/rules/bootstrap.mdc', `---\ndescription: Session family rules (bootstrap-environment)\nalwaysApply: true\n---\n\n${POINTER}`);
      for (const r of roles(root)) {
        out(root, `.cursor/agents/${r.id}.md`, `---\nname: ${r.id}\ndescription: "${oneLine(r)}"\nreadonly: ${docsOnly(r) ? 'true' : 'false'}\n---\n\n${r.body}\n`);
      }
      console.log('\nDegrades: per-agent permissions are only `readonly`; the role limits are enforced by .githooks/pre-push. Wire bin/guard.mjs into .cursor/hooks.json (beforeShellExecution) by hand after checking the current schema.');
    },
  },
  codex: {
    gets: 'AGENTS.md (native), skill in .agents/skills, .codex/rules/bootstrap.rules forbidding force-push and hook bypass',
    run(root) {
      sharedSkill(root);
      out(root, '.codex/rules/bootstrap.rules',
        '# bootstrap-environment: commands no role runs (AGENTS.md). Live pushes are refused by .githooks/pre-push.\n' +
        'prefix_rule(pattern=["git", "push", "--force"], decision="forbidden")\n' +
        'prefix_rule(pattern=["git", "push", "-f"], decision="forbidden")\n' +
        'prefix_rule(pattern=["git", "push", "--no-verify"], decision="forbidden")\n' +
        'prefix_rule(pattern=["git", "reset", "--hard"], decision="forbidden")\n');
      console.log('\nDegrades: no LSP (bridge via MCP); per-role sandboxes need separate launches/profiles; AGENTS.md must stay under 32 KiB. Plugin: codex plugin marketplace add AnfalHaider/Bootstrap-environment');
    },
  },
  copilot: {
    gets: '.github/copilot-instructions.md, .github/agents/<role>.agent.md custom agents, skill in .agents/skills',
    run(root) {
      sharedSkill(root);
      out(root, '.github/copilot-instructions.md', POINTER);
      for (const r of roles(root)) {
        out(root, `.github/agents/${r.id}.agent.md`, `---\nname: ${r.id}\ndescription: "${oneLine(r)}"\n---\n\n${r.body}\n`);
      }
      console.log('\nDegrades: the cloud agent only uses MCP tools and treats "ask" as deny. Add a `tools:` allowlist per agent and .github/hooks/*.json (preToolUse → bin/guard.mjs) after checking the current schema. Plugin: copilot plugin install AnfalHaider/Bootstrap-environment');
    },
  },
  antigravity: {
    gets: 'AGENTS.md (native), .agents/rules/bootstrap.md (trigger: always_on), .agents/agents/<role>.md, skill in .agents/skills',
    run(root) {
      sharedSkill(root);
      out(root, '.agents/rules/bootstrap.md', `---\ntrigger: always_on\n---\n\n${POINTER}`);
      for (const r of roles(root)) out(root, `.agents/agents/${r.id}.md`, `---\nname: ${r.id}\ndescription: "${oneLine(r)}"\n---\n\n${r.body}\n`);
      console.log('\nDegrades: shell deny rules are user-global, so per-project limits rely on hooks (.agents/hooks.json) and .githooks/pre-push. Plugin: agy plugin install https://github.com/AnfalHaider/Bootstrap-environment');
    },
  },
  devin: {
    gets: 'AGENTS.md (native), skill in .agents/skills; the Claude plugin installs directly',
    run(root) {
      sharedSkill(root);
      console.log('\nPlugin: devin plugins install AnfalHaider/Bootstrap-environment. Degrades: plugin-bundled hooks fail open — wire bin/guard.mjs as a PROJECT hook (.devin/hooks.v1.json) and keep .githooks/pre-push.');
    },
  },
  kiro: {
    gets: '.kiro/steering/bootstrap.md (always included), skill in .kiro/skills',
    run(root) {
      copyDir(root, join(KIT, 'skills', 'bootstrap-environment'), '.kiro/skills/bootstrap-environment');
      out(root, '.kiro/steering/bootstrap.md', `---\ninclusion: always\n---\n\n${POINTER}`);
      console.log('\nDegrades: custom agents load no skills by default — add skill:// resources and permissions.rules per role in .kiro/agents/<role>.json after checking the current schema.');
    },
  },
  opencode: {
    gets: 'AGENTS.md (native), skill in .agents/skills; per-agent permissions go in opencode.json',
    run(root) {
      sharedSkill(root);
      console.log('\nNext: add agents.<role>.permissions (deny "git push *" for docs-only roles) and "lsp": true to opencode.json; the last matching rule wins.');
    },
  },
  cline: {
    gets: '.clinerules/bootstrap.md, skill in .cline/skills',
    run(root) {
      copyDir(root, join(KIT, 'skills', 'bootstrap-environment'), '.cline/skills/bootstrap-environment');
      out(root, '.clinerules/bootstrap.md', POINTER);
      console.log('\nDegrades: no per-agent permissions and hooks do not run on Windows — run single-agent; .githooks/pre-push is the enforcement.');
    },
  },
  aider: {
    gets: '.aider.conf.yml reading AGENTS.md',
    run(root) {
      out(root, '.aider.conf.yml', 'read:\n  - AGENTS.md\n');
      console.log('\nDegrades: no skills, MCP, hooks or sub-agents. Run the procedures as scripts (/run node .bootstrap/bin/…); enforcement is .githooks/pre-push only.');
    },
  },
  zed: { gets: 'AGENTS.md only (remove any .rules file — it shadows AGENTS.md)', run() { console.log('Enforcement: .githooks/pre-push.'); } },
  junie: { gets: 'AGENTS.md (or .junie/AGENTS.md)', run() { console.log('Enforcement: .githooks/pre-push.'); } },
  amp: { gets: 'AGENTS.md (native), skill in .agents/skills', run(root) { sharedSkill(root); } },
  chatgpt: {
    gets: 'chatgpt-export/: Project instructions (Chief of Staff + Librarian as advisors) and the skill folder to zip and upload',
    run(root) {
      const cos = roles(root).find((r) => r.id === 'chief-of-staff');
      out(root, 'chatgpt-export/project-instructions.md',
        `# Project instructions (paste into a ChatGPT Project)\n\nChatGPT has no filesystem, shell, hooks or worktrees here, so it advises and does not build.\n` +
        `Act as the Chief of Staff and Librarian for this project: turn asks into board rows, keep decisions with dates, ` +
        `write briefs for the coding agent (Codex or another tool) from the role files, and never claim something ran.\n\n${cos ? cos.body : ''}\n`);
      copyDir(root, join(KIT, 'skills', 'bootstrap-environment'), 'chatgpt-export/bootstrap-environment');
      console.log('\nZip chatgpt-export/bootstrap-environment and upload it as a skill. Real work goes to Codex or another tool with a shell.');
    },
  },
};

function main() {
  const args = process.argv.slice(2);
  DRY = args.includes('--dry-run');
  const tool = args.find((a) => !a.startsWith('--'));
  if (!tool || tool === 'list') {
    for (const [k, v] of Object.entries(TOOLS)) console.log(`${k.padEnd(12)} ${v.gets}`);
    process.exit(tool ? 0 : 1);
  }
  if (!TOOLS[tool]) { console.error(`unknown tool "${tool}"; try: adapt list`); process.exit(1); }
  const root = repoRoot(process.cwd());
  if (!root) { console.error('run inside the project (a git repository)'); process.exit(1); }
  if (!existsSync(join(root, 'AGENTS.md'))) console.log('NOTE    no AGENTS.md yet — run `bootstrap init` first');
  TOOLS[tool].run(root);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();

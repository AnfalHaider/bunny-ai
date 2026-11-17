// Landing rehearsal: a throwaway clone of origin/main, merge K-1+K-2, staged upgrade, staged policy.json,
// then a PreToolUse payload through BOTH guards (project hook and the plugin's 0.6.0 hook) for five cases.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [SRC, SHA, OUT] = process.argv.slice(2); // the repo to clone from, the sha to merge, the evidence file
const PLUGIN = join(process.env.USERPROFILE, '.claude', 'plugins', 'cache', 'bootstrap-environment', 'bootstrap-environment', '0.6.0');
const fwd = (p) => p.split(String.fromCharCode(92)).join('/');
const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };

const root = mkdtempSync(join(tmpdir(), 'bunny-rehearsal-'));
const clone = join(root, 'main');
g(root, 'clone', '-q', '--no-checkout', SRC, clone);
g(clone, 'fetch', '-q', 'origin', 'refs/remotes/origin/main:refs/remotes/origin/main', 'refs/heads/claude/builder-a-k2:refs/remotes/origin/claude/builder-a-k2');
g(clone, 'checkout', '-q', '-B', 'rehearsal', 'origin/main');
g(clone, 'config', 'user.email', 'rehearsal@example.test');
g(clone, 'config', 'user.name', 'Rehearsal');
const before = g(clone, 'rev-parse', 'HEAD');
say(`# Landing rehearsal (throwaway clone ${fwd(clone)})`);
say(`origin/main at ${before.slice(0, 7)}; merging ${SHA}`);

// 1. the exact landing
g(clone, 'merge', '-q', '--no-edit', SHA);
say(`step 1 merge ${SHA}: ok, HEAD ${g(clone, 'rev-parse', '--short', 'HEAD')}`);
writeFileSync(join(clone, '.bootstrap', 'session.json'), JSON.stringify({ role: 'chief-of-staff' }));
const up = spawnSync(process.execPath, [join(clone, 'scripts', 'kit-next', '.bootstrap', 'bin', 'bootstrap.mjs'), 'upgrade'], { cwd: clone, encoding: 'utf8' });
say(`step 2 staged upgrade (as chief-of-staff): exit ${up.status}${up.status ? ' ' + (up.stdout + up.stderr).slice(0, 300) : ''}`);
cpSync(join(clone, 'scripts', 'kit-next', '.bootstrap', 'policy.json'), join(clone, '.bootstrap', 'policy.json'));
say('step 3 staged policy.json copied over .bootstrap/policy.json');
g(clone, 'add', '-A');
g(clone, 'commit', '-q', '--no-verify', '-m', 'rehearsal landing');
const landed = g(clone, 'rev-parse', 'HEAD');
say(`landing commit ${landed.slice(0, 7)} (rollback target ${before.slice(0, 7)})`);

// worktrees: a nested one under .claude/worktrees (design) and an external one (builder), a release-ops one
const role = (wt, r) => { writeFileSync(join(g(wt, 'rev-parse', '--absolute-git-dir'), 'bootstrap-role'), r + '\n'); writeFileSync(join(wt, '.bootstrap', 'session.json'), JSON.stringify({ role: r })); };
mkdirSync(join(clone, '.claude', 'worktrees'), { recursive: true });
const wDesign = join(clone, '.claude', 'worktrees', 'design-x');
const wBuilder = join(root, 'external-builder');
const wRelease = join(root, 'external-release');
g(clone, 'worktree', 'add', '-q', '-b', 'claude/design-x', wDesign);
g(clone, 'worktree', 'add', '-q', '-b', 'claude/builder-x', wBuilder);
g(clone, 'worktree', 'add', '-q', '-b', 'claude/release-x', wRelease);
role(wDesign, 'design');
role(wBuilder, 'builder');
role(wRelease, 'release-ops');
g(clone, 'branch', '-f', 'main', 'rehearsal'); // the landing commit as local main, so `git push origin main` is a real push
// a local bare origin so `git push origin main` is a real push attempt
const bare = join(root, 'origin.git');
g(root, 'init', '-q', '--bare', bare);
g(clone, 'remote', 'set-url', 'origin', bare);

function verdict(guardPath, env, payload) {
  const r = spawnSync(process.execPath, [guardPath], { input: JSON.stringify(payload), encoding: 'utf8', cwd: payload.cwd, env: { ...process.env, ...env, BOOTSTRAP_ROLE: '' }, timeout: 30000 });
  const reason = (r.stderr || '').trim().split(String.fromCharCode(10))[0].slice(0, 160);
  return `${r.status === 0 ? 'ALLOW ' : r.status === 2 ? 'REFUSE' : 'ERR' + r.status}${reason ? ' | ' + reason : ''}`;
}
const cases = [
  ['chief-of-staff Bash `git status`', clone, { tool_name: 'Bash', tool_input: { command: 'git status' } }, 'ALLOW'],
  ['chief-of-staff Write docs/x.md', clone, { tool_name: 'Write', tool_input: { file_path: join(clone, 'docs', 'x.md'), content: 'x' } }, 'ALLOW'],
  ['nested worktree (.claude/worktrees), role design, Write docs/x.md', wDesign, { tool_name: 'Write', tool_input: { file_path: join(wDesign, 'docs', 'x.md'), content: 'x' } }, 'ALLOW'],
  ['external worktree, role builder, Write src/x.js', wBuilder, { tool_name: 'Write', tool_input: { file_path: join(wBuilder, 'src', 'x.js'), content: 'x' } }, 'ALLOW'],
  ['release-ops `git push origin main` at PreToolUse (release-ops is a live pusher, so the call may start; the pre-push hook below judges sign-offs)', wRelease, { tool_name: 'Bash', tool_input: { command: 'git push origin main' } }, 'ALLOW'],
];
function runCases(title) {
  say('');
  say(`## ${title}`);
  say('| case | expected | ours (.claude/settings.json) | plugin 0.6.0 hooks.json | match |');
  say('|---|---|---|---|---|');
  let ok = true;
  for (const [name, cwd, p, expected] of cases) {
    const payload = { ...p, cwd, session_id: 'rehearsal' };
    const ours = verdict(join(clone, '.bootstrap', 'bin', 'guard.mjs'), { CLAUDE_PROJECT_DIR: clone }, payload);
    const plug = verdict(join(PLUGIN, 'bin', 'guard.mjs'), { CLAUDE_PROJECT_DIR: clone, CLAUDE_PLUGIN_ROOT: PLUGIN }, payload);
    // a call goes through only when BOTH allow
    const both = ours.startsWith('ALLOW') && plug.startsWith('ALLOW') ? 'ALLOW' : 'REFUSE';
    const match = both === expected;
    ok &&= match;
    say(`| ${name} | ${expected} | ${ours.replace(/\|/g, '/')} | ${plug.replace(/\|/g, '/')} | ${match ? 'yes' : 'NO (combined ' + both + ')'} |`);
  }
  return ok;
}
const afterOk = runCases('After landing (both guards wired as in real life)');

// the real pre-push hook: release-ops pushing main with no sign-offs and no release record
g(clone, 'config', 'core.hooksPath', '.githooks');
say('');
say('## The real pre-push hook (the refusal for release-ops lives here, not in the PreToolUse guard)');
const push = spawnSync('git', ['push', 'origin', 'main'], { cwd: wRelease, encoding: 'utf8', env: { ...process.env, BOOTSTRAP_ROLE: '' }, timeout: 60000 });
say('release-ops (external worktree) git push origin main: exit ' + push.status + ' ' + (push.status === 0 ? 'ALLOWED (UNEXPECTED)' : 'REFUSED') + ' | ' + (push.stderr || '').split(String.fromCharCode(10)).filter((l) => /pre-push|refus|blocked|sign/i.test(l)).slice(0, 4).join(' / ').slice(0, 600) + ' || full: ' + (push.stderr || '').replace(/s+/g, ' ').slice(0, 500));
const hookRefused = push.status !== 0;

// 3. rollback, proved in the clone
say('');
say('## Rollback');
const back = before.slice(0, 7);
say('If any step locks out the chief-of-staff: run these two commands in a terminal OUTSIDE Claude Code (the guards run only inside Claude Code sessions, so they cannot block a plain terminal), in the main checkout:');
say('    git rm -r -q -f --ignore-unmatch .bootstrap .githooks');
say('    git checkout ' + back + ' -- .bootstrap .githooks .claude');
say('(the files are then exactly as before the landing; commit them or leave them. scripts/kit-next stays, it is only a folder of files.)');
g(clone, 'rm', '-r', '-q', '-f', '--ignore-unmatch', '.bootstrap', '.githooks');
g(clone, 'checkout', back, '--', '.bootstrap', '.githooks', '.claude');
const diff = g(clone, 'diff', '--stat', back, '--', '.bootstrap', '.githooks', '.claude');
say('proved in the clone: git diff ' + back + ' for .bootstrap .githooks .claude after the two commands: ' + (diff === '' ? 'EMPTY (exactly the old kit)' : 'NOT EMPTY ' + diff.slice(0, 200)));
const rolledOk = diff === '';
g(clone, 'config', '--unset', 'core.hooksPath');
const rolled = verdict(join(clone, '.bootstrap', 'bin', 'guard.mjs'), { CLAUDE_PROJECT_DIR: clone }, { tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: clone, session_id: 'rehearsal' });
say('chief-of-staff git status through the rolled-back project guard: ' + rolled);
say('');
say('RESULT: after-landing rows ' + (afterOk ? 'ALL MATCH' : 'SOME DO NOT MATCH') + '; real pre-push refused: ' + hookRefused + '; rollback clean: ' + rolledOk);
writeFileSync(OUT, lines.join(String.fromCharCode(10)) + String.fromCharCode(10));

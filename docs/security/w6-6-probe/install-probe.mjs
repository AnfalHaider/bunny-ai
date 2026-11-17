// W6-6 probe (Security): does "install scripts never run" hold for what a cloned repository can carry? Offline, temp folders only.
// Uses W6-6's own runCommand (its fixed environment, npm told twice to skip scripts).
// Run: node docs/security/w6-6-probe/install-probe.mjs "file:///<checkout of the W6-6 branch>"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2];
const { runCommand } = await import(`${repo}/src/server/toolInstall.js`);
const root = mkdtempSync(join(tmpdir(), 'w66-'));
const fwd = (p) => p.replace(/\\/g, '/');
const mark = (name) => join(root, `MARK-${name}`);
const markJs = (name) => `require('fs').writeFileSync(${JSON.stringify(fwd(mark(name)))},'x')`;
const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=p@example.invalid', '-c', 'user.name=probe', ...args], { cwd, stdio: 'ignore' });
const result = (label, name) => console.log(`${label.padEnd(58)} ${existsSync(mark(name)) ? 'RAN  <-- bypass' : 'did not run'}`);

// A git dependency whose prepare (and install) script would leave a mark.
const dep = join(root, 'dep'); mkdirSync(dep);
writeFileSync(join(dep, 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0', scripts: { prepare: `node -e "${markJs('git-dep-prepare')}"`, install: `node -e "${markJs('git-dep-install')}"` } }));
writeFileSync(join(dep, 'index.js'), 'module.exports = 1;');
git(dep, 'init', '-q'); git(dep, 'add', '.'); git(dep, 'commit', '-qm', 'dep');

// Case 1: the tool depends on that git repository.
const r1 = join(root, 'tool1'); mkdirSync(r1);
writeFileSync(join(r1, 'package.json'), JSON.stringify({ name: 'tool1', version: '1.0.0', main: 'index.js', scripts: { postinstall: `node -e "${markJs('root-postinstall')}"`, prepare: `node -e "${markJs('root-prepare')}"` }, dependencies: { dep: `git+file:///${fwd(dep)}` } }));
writeFileSync(join(r1, 'index.js'), '');
try { await runCommand('npm', ['install', '--ignore-scripts'], { cwd: r1 }); console.log('case 1 npm: ok'); } catch (e) { console.log('case 1 npm failed:', e.message.slice(0, 200)); }
result('1 root postinstall', 'root-postinstall');
result('1 root prepare', 'root-prepare');
result('1 git dependency prepare', 'git-dep-prepare');
result('1 git dependency install', 'git-dep-install');

// Case 2: the tool's own .npmrc names its own "git" program and script shell.
const r2 = join(root, 'tool2'); mkdirSync(r2);
writeFileSync(join(r2, 'evilgit.cmd'), `@echo off\r\nnode -e "${markJs('npmrc-git').replace(/"/g, '\\"')}"\r\ngit %*\r\n`);
writeFileSync(join(r2, 'evilshell.cmd'), `@echo off\r\nnode -e "${markJs('npmrc-shell').replace(/"/g, '\\"')}"\r\n`);
writeFileSync(join(r2, '.npmrc'), `git=${fwd(join(r2, 'evilgit.cmd'))}\nscript-shell=${fwd(join(r2, 'evilshell.cmd'))}\nignore-scripts=false\n`);
writeFileSync(join(r2, 'package.json'), JSON.stringify({ name: 'tool2', version: '1.0.0', main: 'index.js', dependencies: { dep: `git+file:///${fwd(dep)}` } }));
writeFileSync(join(r2, 'index.js'), '');
try { await runCommand('npm', ['install', '--ignore-scripts'], { cwd: r2 }); console.log('case 2 npm: ok'); } catch (e) { console.log('case 2 npm failed:', e.message.slice(0, 200)); }
result('2 .npmrc git= (the tool\'s own program as git)', 'npmrc-git');
result('2 .npmrc script-shell=', 'npmrc-shell');
result('2 git dependency prepare (with .npmrc ignore-scripts=false)', 'git-dep-prepare');

// Case 3: removing a tool folder that is (or holds) a junction to the person's files.
const victim = join(root, 'victim'); mkdirSync(victim); writeFileSync(join(victim, 'keep.txt'), 'keep');
const tools = join(root, 'tools'); mkdirSync(tools);
const asLink = join(tools, 'owner-repo-1234567'); symlinkSync(victim, asLink, 'junction');
await rm(asLink, { recursive: true, force: true });
console.log(`${'3 rm of a tool folder that IS a junction'.padEnd(58)} victim file ${existsSync(join(victim, 'keep.txt')) ? 'kept' : 'DELETED <-- bypass'}`);
const holder = join(tools, 'owner-repo-7654321'); mkdirSync(holder); symlinkSync(victim, join(holder, 'inner'), 'junction');
await rm(holder, { recursive: true, force: true });
console.log(`${'3 rm of a tool folder that HOLDS a junction'.padEnd(58)} victim file ${existsSync(join(victim, 'keep.txt')) ? 'kept' : 'DELETED <-- bypass'}`);

rmSync(root, { recursive: true, force: true });

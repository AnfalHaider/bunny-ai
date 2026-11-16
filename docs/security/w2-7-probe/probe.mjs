// W2-7 review probe (Security, 2026-11-16): permission rules against what Windows PowerShell 5.1 really does.
// Part 1: for each command, the rule engine's view (permissionRules.js commandParts/checkCommand) versus PowerShell's own parser
//         (statements it will run). An "allow" that applies while PowerShell sees a second statement is a bypass; a "deny" that
//         does not fire while PowerShell runs the denied command is a bypass.
// Part 2: path rules against links, 8.3 names, trailing dots, streams, case, "..".
// Usage: node probe.mjs <checkout of 791dc98>      (throwaway folders in the temp directory only; nothing is executed)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const CO = process.argv[2].replace(/\\/g, '/');
const pr = await import(`file:///${CO}/src/server/permissionRules.js`);
const { createWorkspace, translateChains } = await import(`file:///${CO}/src/server/workspace.js`);

// ---- PowerShell's own parse: the command names of every pipeline element it would run (nothing is executed)
const ps = (command) => {
  const script = `$e=$null;$t=$null;$ast=[System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$t,[ref]$e);`
    + `$c=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true)|ForEach-Object{$_.GetCommandName()};`
    + `if($c){$c -join '|'}else{''}`;
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { input: command, encoding: 'utf8' }).trim();
};
const effect = (rules, cmd) => pr.checkCommand(rules, cmd)?.effect ?? 'none';
const R = (kind, effectName, pattern, ops) => ({ id: pattern, kind, effect: effectName, pattern, ops, scope: 'All folders' });
let bad = 0;
const flag = (s) => { bad += 1; console.log(`**BYPASS** ${s}`); };

console.log('--- Part 1a: an Allow must not cover a second command PowerShell will run');
const allow = [R('command', 'allow', 'npm test*'), R('command', 'allow', 'git status*'), R('command', 'allow', 'echo*')];
const sneaky = [
  'npm test \\; Remove-Item x', 'npm test \\| Remove-Item x', 'npm test \\& Remove-Item x', 'npm test \\\nRemove-Item x', 'echo "x\\" ; Remove-Item y ; echo "', 'echo "x\\" | Remove-Item y ; echo "',
  "echo 'a' ; Remove-Item y", 'npm test\u000bRemove-Item y', 'npm test\u000cRemove-Item y', 'npm test ; Remove-Item y', 'npm test； Remove-Item y',
  'npm test # ; ok\nRemove-Item y', 'npm test <# c #> ; Remove-Item y', 'echo @\'\nx\n\'@; Remove-Item y', 'echo @"\nx\n"@; Remove-Item y', 'npm test `\nRemove-Item y',
  'npm test -- --a="b`" ; Remove-Item y ; "', 'git status --porcelain=v1 ; Remove-Item y', 'echo ok & Remove-Item y', 'echo ok&&Remove-Item y', 'echo ok||Remove-Item y', 'echo ok;Remove-Item y',
  'echo ok -and (Remove-Item y)', 'echo $(Remove-Item y)', 'echo ok | Remove-Item y', 'echo ok > f.txt', 'echo ok >> f.txt', 'echo ok 2> f.txt', 'echo ok *> f.txt', 'echo ok 1> f.txt', 'echo ok>f.txt',
  'echo ok | Out-File f.txt', 'echo ok | tee f.txt', 'echo ok | Set-Content f.txt', 'npm test; ; Remove-Item y', 'echo ok &Remove-Item y', 'echo ok -- ; Remove-Item y', 'echo ${env:x}', 'echo $env:x',
];
for (const c of sneaky) {
  const verdict = effect(allow, c);
  let names = '?';
  try { names = ps(c); } catch { names = 'psparse-failed'; }
  const n = names ? names.split('|').length : 0;
  const risky = /remove-item/i.test(names) || /out-file|tee|set-content/i.test(names);
  if (verdict === 'allow' && (n > 1 || risky)) flag(`allow applied, PowerShell runs: ${names}   <- ${JSON.stringify(c)}`);
  else console.log(`  ok  ${verdict.padEnd(5)} PS:[${names}]  ${JSON.stringify(c).slice(0, 80)}`);
}

console.log('--- Part 1b: a Deny must fire when PowerShell would run the denied command');
const deny = [R('command', 'deny', 'Remove-Item*'), R('command', 'deny', 'git push*')];
const dodges = [
  'Remove-Item x', 'echo a \\; Remove-Item x', 'echo "a\\" ; Remove-Item x ; echo "', 'rm -r x', 'ri -r x', 'del x', 'erase x', 'rd x', 'rmdir x', 'Remove-Item -Recurse x', 'remove-item x', 'REMOVE-ITEM x',
  'Microsoft.PowerShell.Management\\Remove-Item x', '& Remove-Item x', '& "Remove-Item" x', '& (Get-Command Remove-Item) x', '. Remove-Item x', 'Remove-Item`  x', 'Re`move-Item x', '"Remove-Item" x', "'Remove-Item' x",
  '$c="Remove-Item"; & $c x', 'iex "Remove-Item x"', 'Invoke-Expression "Remove-Item x"', 'powershell -c "Remove-Item x"', 'pwsh -Command "Remove-Item x"', 'cmd /c del x', 'cmd /c "rd /s x"', 'start Remove-Item',
  'Get-ChildItem | Remove-Item', 'gci | ri', 'ls x | rm', '[IO.File]::Delete("x")', 'git push', 'git  push', 'git -C . push', 'git -c a=b push', 'git push origin main', '& git push', 'git.exe push', '"git" push', 'git `push', 'g`it push',
  '$g="git"; & $g push', 'cmd /c git push', 'powershell -c "git push"', 'git --no-pager push', 'git -P push', 'GIT_X=1 git push', '$env:X=1; git push', 'gh api -X PUT x',
  'if ($true) { Remove-Item x }', '$(Remove-Item x)', 'echo $(Remove-Item x)', 'echo `$(Remove-Item x)', '@(Remove-Item x)', '{ Remove-Item x }.Invoke()', 'foreach ($i in 1) { Remove-Item x }', 'echo 1 | % { Remove-Item x }',
  'Remove-Item -Path x', 'echo x ; Remove-Item x', 'echo x\nRemove-Item y', 'echo x\r\nRemove-Item y', 'echo x\rRemove-Item y',
];
for (const c of dodges) {
  const v = effect(deny, c);
  let names = '?';
  try { names = ps(c); } catch { names = 'psparse-failed'; }
  const runsDenied = /(^|\|)(remove-item|ri|rm|del|erase|rd|rmdir)(\||$)/i.test(names) || /git/i.test(names) && /push/i.test(c);
  if (v === 'none' && runsDenied) flag(`deny silent, PowerShell runs: ${names}   <- ${JSON.stringify(c)}`);
  else console.log(`  ok  ${v.padEnd(5)} PS:[${names}]  ${JSON.stringify(c).slice(0, 80)}`);
}

console.log('--- Part 2: path rules');
const top = mkdtempSync(join(tmpdir(), 'bunny-w27-'));
const root = join(top, 'ws');
mkdirSync(join(root, 'secrets'), { recursive: true });
mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'secrets', 'key.pem'), 'SECRET');
writeFileSync(join(root, '.env'), 'K=1');
writeFileSync(join(root, 'docs', 'a.md'), 'a');
const mk = (cmd) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { encoding: 'utf8' });
try { mk(`New-Item -ItemType Junction -Path '${join(root, 'link')}' -Target '${join(root, 'secrets')}' | Out-Null`); } catch { console.log('junction failed'); }
try { mk(`New-Item -ItemType Junction -Path '${join(root, 'docs', 'jl')}' -Target '${join(root, 'secrets')}' | Out-Null`); } catch { /* */ }
const short = mk(`(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${join(root, 'secrets')}').ShortName`).trim();
console.log('8.3 name of secrets:', short || '(none)');
const rules = [R('path', 'deny', 'secrets/**', 'reads'), R('path', 'deny', 'secrets/**', 'edits'), R('path', 'deny', '*.pem', 'reads'), R('path', 'deny', '.env', 'reads'), R('path', 'allow', 'docs/**', 'edits')];
const ws = createWorkspace(root, {});
const judge = async (name, path, op) => {
  const canon = await ws.canon(path).catch(() => null);
  const v = pr.checkToolCall(rules, name, { path }, canon);
  return { v: v?.effect ?? 'none', canon };
};
const must = { read_file: 'deny', write_file: 'deny' };
for (const p of ['secrets/key.pem', 'Secrets/Key.PEM', 'SECRETS\\key.pem', 'secrets/../secrets/key.pem', 'docs/../secrets/key.pem', './secrets/key.pem', 'secrets//key.pem', 'secrets/./key.pem',
  'link/key.pem', 'docs/jl/key.pem', `${short}/key.pem`, `${short.toLowerCase()}/key.pem`, 'secrets./key.pem', 'secrets /key.pem', 'secrets/key.pem.', 'secrets/key.pem ', 'secrets/key.pem::$DATA', 'secrets::$INDEX_ALLOCATION/key.pem',
  'secrets/key.pem:stream', '.env.', '.env ', '.env::$DATA', '.ENV', 'secrets/KEY~1.PEM', '\\\\?\\' + join(root, 'secrets', 'key.pem'), join(root, 'secrets', 'key.pem')]) {
  for (const [tool, want] of [['read_file', 'deny'], ['write_file', 'deny']]) {
    if (tool === 'write_file' && /^(\.env|\\\\)/.test(p)) continue;
    const r = await judge(tool, p, tool === 'read_file' ? 'reads' : 'edits');
    const target = /key|env|jl|link|secrets|ENV|SECRETS/i.test(p);
    const real = await ws.run('list_files', { path: '.' }).then(() => true, () => false);
    // would the tool really touch the protected file? (a read of the path: does it resolve to the secret?)
    let touches = false;
    try { if (tool === 'read_file') touches = /SECRET/.test(await ws.run('read_file', { path: p })); else touches = true; } catch { touches = false; }
    if (tool === 'write_file') touches = (await ws.canon(p).catch(() => null)) !== null && /secrets/i.test(String(await ws.canon(p).catch(() => ''))) ;
    if (r.v !== want && touches) flag(`${tool} ${JSON.stringify(p)} reaches the protected file (canon=${r.canon}) but the rule says ${r.v}`);
    else console.log(`  ok  ${tool.padEnd(10)} ${r.v.padEnd(5)} touches=${touches}  ${JSON.stringify(p)} canon=${r.canon}`);
  }
}
// allow path rule must not cover a path that really lands elsewhere
for (const p of ['docs/a.md', 'docs/../secrets/key.pem', 'docs/jl/key.pem', 'docs/./../secrets/x', 'DOCS/a.md']) {
  const r = await judge('write_file', p, 'edits');
  console.log(`  allow-edit ${r.v.padEnd(5)} ${JSON.stringify(p)} canon=${r.canon}`);
}
console.log(bad ? `BYPASSES: ${bad}` : 'NO BYPASS FOUND');
void translateChains;

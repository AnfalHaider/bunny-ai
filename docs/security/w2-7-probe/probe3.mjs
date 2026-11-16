// W2-7c probe 3 (Security): new spellings against 47e2312. Usage: node probe3.mjs <checkout>
import { execFileSync } from 'node:child_process';
const CO = process.argv[2].split(String.fromCharCode(92)).join('/');
const pr = await import(`file:///${CO}/src/server/permissionRules.js`);
const ps = (command) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$e=$null;$t=$null;$ast=[System.Management.Automation.Language.Parser]::ParseInput([Console]::In.ReadToEnd(),[ref]$t,[ref]$e);$c=$ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true)|ForEach-Object{$_.GetCommandName()};if($c){$c -join '|'}else{''}`], { input: command, encoding: 'utf8' }).trim();
const R = (effect, pattern) => ({ id: pattern, kind: 'command', effect, pattern, ops: 'all', scope: 'All folders' });
const BT = String.fromCharCode(96), BS = String.fromCharCode(92);
const eff = (rules, c) => pr.checkCommand(rules, c)?.effect ?? 'none';
let bad = 0;
const allow = [R('allow', 'npm test*'), R('allow', 'git status*'), R('allow', 'echo*')];
const a = [
  'npm test --% ; Remove-Item x', 'npm test --% & del x', "echo ‘a ; Remove-Item x ; ’", 'echo “a ; Remove-Item x ; ”', 'echo a' + BT + ';Remove-Item x', 'echo a' + BT + '\nRemove-Item x', 'echo a\u0085Remove-Item x', 'echo a\u2028Remove-Item x', 'echo a\u00a0; Remove-Item x',
  'npm test | ForEach-Object { Remove-Item x }', 'npm test 2>&1 | Remove-Item x', 'echo (Remove-Item x)', 'echo @(Remove-Item x)', 'echo "$(Remove-Item x)"', "echo 'a''b' ; Remove-Item x", 'echo "a""b" ; Remove-Item x', 'echo "a' + BT + '" ; Remove-Item x ; echo "',
  'npm test' + BS + '\nRemove-Item x', 'echo a' + BS + '"; Remove-Item x; echo "', 'echo a' + BS + "'; Remove-Item x; echo '", 'npm test&&Remove-Item x', 'npm test;Remove-Item x', 'echo a #' + '\nRemove-Item x', 'echo @"\nx\n"@ ; Remove-Item x', 'echo ok ;&Remove-Item x', 'echo ok ; & "Remove-Item" x', 'git status > x', 'git status | Set-Content x', 'echo a > x', 'echo a >x', 'echo a 1>x', 'echo a>>x', 'echo a *>x', 'npm test < x', 'echo $PROFILE', 'echo ${function:x}', 'echo a ' + BT + 'r' + BT + 'n Remove-Item x',
];
console.log('--- Allow: must not apply when PowerShell runs more than the allowed command (or redirects)');
for (const c of a) { const v = eff(allow, c); let n = ''; try { n = ps(c); } catch { n = '?'; } const cnt = n ? n.split('|').length : 0; const redir = />/.test(c.replace(/->/g, '')); const risky = /remove-item|del|set-content|out-file|tee/i.test(n) || redir; if (v === 'allow' && (cnt > 1 || risky)) { bad += 1; console.log('**BYPASS** allow applied; PS runs [' + n + '] ' + JSON.stringify(c)); } else console.log('  ok  ' + v.padEnd(5) + ' [' + n + '] ' + JSON.stringify(c).slice(0, 70)); }
const deny = [R('deny', 'Remove-Item*'), R('deny', 'git push*'), R('deny', 'gh release*')];
const d = [
  'ri x', 'rm x', 'del x', 'erase x', 'rd x', 'rmdir x', 'Remove-Item x -r', '& ri x', '&ri x', '& { Remove-Item x }', 'Invoke-Command { Remove-Item x }', 'icm { ri x }', 'Start-Process powershell -ArgumentList "-c ri x"', 'Start-Process git -ArgumentList push', 'start git push', 'saps git push', 'cmd /c del x', 'cmd.exe /c rd /s x', 'wsl git push', 'bash -c "git push"', 'sh -c "git push"', 'pwsh -c ri', 'powershell -enc AAAA', 'iex $x', 'Invoke-Expression $x', '. ./x.ps1', './x.ps1', '& ./x.ps1', 'node -e "1"', 'python -c "1"',
  'git -c alias.p=push p', 'git --git-dir=x push', 'git --work-tree=x push', 'git --exec-path push', 'git -c core.pager=x push', 'git --no-replace-objects push', 'git --literal-pathspecs push', '/usr/bin/git push', 'C:/Program Files/Git/cmd/git.exe push', '& "C:/Program Files/Git/cmd/git.exe" push', 'GIT push', 'Git.EXE Push', 'git push origin main', 'git' + BT + ' push', 'git ' + BT + 'push', '"git" "push"', "'git' push", 'git "push"', 'git p"ush"', 'git pu' + BT + 'sh', '$g = "git"; & $g push', '& (gcm git) push', 'git status; git push', 'echo x | git push', 'gh release create v1', 'GH release create v1', 'gh.exe release create v1', 'gh -R x/y release create v1', 'gh --repo x/y release create v1', 'gh rele' + BT + 'ase create', 'gh "release" create', 'gh api repos/x/y/releases -X POST',
  '[IO.File]::Delete("x")', '[System.IO.Directory]::Delete("x",$true)', 'Get-ChildItem | % { $_.Delete() }', 'del -Recurse x', 'Remove-Item', 'remove-item' + BT + 'x',
];
console.log('--- Deny/Ask: must fire (deny or ask) when PowerShell runs the denied command');
for (const c of d) { const v = eff(deny, c); let n = ''; try { n = ps(c); } catch { n = '?'; } const runsDenied = /(^|\|)(remove-item|ri|rm|del|erase|rd|rmdir)(\||$)/i.test(n) || (/(^|\|)git(\.exe)?(\||$)/i.test(n) && /push/i.test(c.replace(/["'`]/g, ''))) || (/(^|\|)gh(\.exe)?(\||$)/i.test(n) && /release/i.test(c.replace(/["'`]/g, ''))); if (v === 'none' && runsDenied) { bad += 1; console.log('**BYPASS** deny silent; PS runs [' + n + '] ' + JSON.stringify(c)); } else console.log('  ' + (v === 'none' ? 'none ' : v.padEnd(5)) + ' [' + n + '] ' + JSON.stringify(c).slice(0, 70)); }
console.log(bad ? 'BYPASSES: ' + bad : 'NO BYPASS FOUND');

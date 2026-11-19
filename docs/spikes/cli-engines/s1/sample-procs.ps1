# Spike helper: every 200 ms for N seconds, list the descendants (name + pid) of a process; writes distinct "name" lines to a file. Read-only.
param([int]$RootPid, [string]$Out, [int]$Seconds)
$seen = @{}
$end = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $end) {
  $all = Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name
  $kids = @($RootPid)
  $i = 0
  while ($i -lt $kids.Count) { foreach ($p in $all) { if ($p.ParentProcessId -eq $kids[$i] -and -not ($kids -contains $p.ProcessId)) { $kids += $p.ProcessId; $seen[$p.Name] = 1 } }; $i++ }
  Start-Sleep -Milliseconds 200
}
$seen.Keys | Sort-Object | Set-Content -LiteralPath $Out
if ($seen.Count -eq 0) { Set-Content -LiteralPath $Out -Value '(no child processes seen)' }

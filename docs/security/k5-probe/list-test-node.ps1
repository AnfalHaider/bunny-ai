# Lists node processes started from Security's temporary K-5 test copy (docs/security/k5-tmp), so a stopped run leaves nothing behind.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*k5-tmp*' -or $_.CommandLine -like '*guard-next-a1*' } |
  ForEach-Object { '{0}  {1}' -f $_.ProcessId, $_.CommandLine.Substring(0, [Math]::Min(140, $_.CommandLine.Length)) }

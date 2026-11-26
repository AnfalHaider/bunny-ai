param([string]$Dir)
# Read-only: Authenticode status of every exe and dll in the folder
$rows = Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Extension -in '.exe', '.dll' } | ForEach-Object {
  $s = Get-AuthenticodeSignature -LiteralPath $_.FullName
  [pscustomobject]@{ File = $_.Name; Status = [string]$s.Status; Signer = if ($s.SignerCertificate) { $s.SignerCertificate.Subject } else { '' } }
}
$rows | Group-Object Status, Signer | ForEach-Object { '{0} files: {1}' -f $_.Count, $_.Name }
'--- by file'
$rows | ForEach-Object { '{0} | {1} | {2}' -f $_.File, $_.Status, $_.Signer }

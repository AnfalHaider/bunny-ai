param([int]$ProcId, [string]$What)
# Read-only probes of one running process: its loaded modules (with paths), and its integrity level.
if ($What -eq 'modules') {
  (Get-Process -Id $ProcId).Modules | ForEach-Object { $_.FileName }
}
if ($What -eq 'integrity') {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class IL {
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, int pid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p, uint a, out IntPtr t);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr t, int c, IntPtr b, int len, out int ret);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid, uint n);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Of(int pid) {
    IntPtr p = OpenProcess(0x1000, false, pid); if (p == IntPtr.Zero) return "OpenProcess failed " + Marshal.GetLastWin32Error();
    IntPtr tok; if (!OpenProcessToken(p, 0x8, out tok)) return "OpenProcessToken failed " + Marshal.GetLastWin32Error();
    int len; GetTokenInformation(tok, 25, IntPtr.Zero, 0, out len);
    IntPtr buf = Marshal.AllocHGlobal(len);
    if (!GetTokenInformation(tok, 25, buf, len, out len)) return "GetTokenInformation failed";
    IntPtr sid = Marshal.ReadIntPtr(buf);
    int count = Marshal.ReadByte(GetSidSubAuthorityCount(sid));
    int rid = Marshal.ReadInt32(GetSidSubAuthority(sid, (uint)(count - 1)));
    CloseHandle(tok); CloseHandle(p);
    return "0x" + rid.ToString("X4");
  }
}
"@
  'integrity RID: ' + [IL]::Of($ProcId) + '  (0x1000 Low, 0x2000 Medium, 0x3000 High)'
}

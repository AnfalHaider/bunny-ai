param([string]$Exe, [string]$ArgLine, [string]$Cwd, [int]$UseJob = 1, [int]$HoldMs = 9000)
# Starts the server, optionally puts it in a job object with KILL_ON_JOB_CLOSE, prints its pid, waits, then ends WITHOUT stopping it:
# with the job, closing this process's handle to the job must end the server; without it (the control) the server must survive.
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class Job {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr a, string n);
  [DllImport("kernel32.dll")] public static extern bool SetInformationJobObject(IntPtr j, int c, IntPtr i, int l);
  [DllImport("kernel32.dll")] public static extern bool AssignProcessToJobObject(IntPtr j, IntPtr p);
  public static IntPtr MakeKillOnClose() {
    IntPtr j = CreateJobObject(IntPtr.Zero, null);
    int size = 144; IntPtr buf = Marshal.AllocHGlobal(size);
    for (int i = 0; i < size; i++) Marshal.WriteByte(buf, i, 0);
    Marshal.WriteInt32(buf, 16, 0x2000); // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(j, 9, buf, size)) throw new Exception("SetInformationJobObject " + Marshal.GetLastWin32Error());
    return j;
  }
}
"@
$p = Start-Process -FilePath $Exe -ArgumentList $ArgLine -WorkingDirectory $Cwd -WindowStyle Hidden -PassThru
if ($UseJob -eq 1) {
  $j = [Job]::MakeKillOnClose()
  $ok = [Job]::AssignProcessToJobObject($j, $p.Handle)
  "assigned to job: $ok"
}
"server pid: $($p.Id)"
Start-Sleep -Milliseconds $HoldMs
"parent ending now"

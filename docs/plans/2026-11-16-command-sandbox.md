# Command sandbox for `run_command` on Windows 10 and 11 (W3-7)

Researcher, 2026-11-16. Brief from the Chief of Staff (plan `207c410`, W3-7). Research only: nothing in `src/` changed, nothing installed system-wide.
Placed in `docs/plans/` instead of `docs/research/`, because `docs/research/` is excluded from git for every worktree (`.git/info/exclude`).

## Recommendation

**Use a low-integrity child process, started through a small precompiled helper, with the workspace folder labelled low-integrity once.** I built and ran a prototype on this Windows 11 Pro machine as a normal (non-admin) user. It blocked writes outside the folder and to the home directory, blocked registry writes, and ran node, git and PowerShell inside the folder. It needed no admin and no install. It does **not** block network or reads.

For the network there is no free, no-admin option that is both strong and compatible with developer tools: AppContainer cuts the network but breaks most tools (not tested), and per-program firewall rules need admin. So: ship low-integrity for the file and registry boundary, keep the existing permission prompts as the network control, and treat a network boundary as a separate later decision. Windows Sandbox and WSL2 are real isolation, but need admin to enable, are missing on some machines, and change what a command means.

## What was measured (this machine, not a lab)

| Fact | Evidence |
|---|---|
| Windows 11 Pro 10.0.26300, PowerShell 5.1, not elevated | `Get-CimInstance Win32_OperatingSystem`; `IsInRole('Administrator')` gave False |
| `WindowsSandbox.exe` is not present (feature not enabled) | `Test-Path C:\Windows\System32\WindowsSandbox.exe` gave False |
| `wsl.exe` and .NET Framework 4 `csc.exe` are present | `Test-Path` gave True for both |
| `Add-Type` compile of a tiny class: about 460 ms. Starting `cmd /c echo`: about 56 ms | Stopwatch in PowerShell 5.1 |
| Whole low-integrity prototype run (PowerShell start, compile, child, wait): about 1.8 s | `time` around the script below |

## Prototype result: low-integrity child (no admin, no install)

The helper copies the caller's own token, sets its integrity level to Low (`S-1-16-4096`) and starts the command with `CreateProcessAsUser`. The work folder was labelled once with `icacls <folder> /setintegritylevel "(OI)(CI)L"`. All paths were invented temporary folders in the session scratchpad.

| Test run inside the low-integrity child | Result |
|---|---|
| Write a file inside the labelled work folder | **allowed** |
| Write a file in a sibling folder outside it | **blocked** (file not created) |
| Write `%USERPROFILE%\probe.txt` | **blocked** |
| `reg add HKCU\Software\...` | **blocked** ("Access is denied"; key not created) |
| Network: `curl.exe https://example.com` | **allowed** (HTTP 200) |
| `node -e`, `git --version`, `git init` in the folder, `powershell -Command` | **worked** |
| `npm install` | **failed**: `EPERM` writing the npm cache in `%LOCALAPPDATA%` (outside the folder). Redirecting `npm_config_cache` into a labelled folder is the expected fix (not tested) |

This matches Microsoft's rule that a low-integrity principal cannot write to a medium-integrity object even if the ACL allows it ([Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)). Reads are not blocked: a low-integrity process can still read your documents.

## The options compared

Per-command cost for A is my estimate once the helper is precompiled; the 1.8 s above includes PowerShell start-up and a 0.5 s compile. Rows marked "not tested" come from Microsoft's documentation or reasoning, not from running them.

| Option | Blocks writes outside folder | Blocks network | Blocks registry | Admin or paid? | Node/Electron without a native module? | Cost per command | Fit with developer tools |
|---|---|---|---|---|---|---|---|
| **A. Low-integrity child** | **Yes** (measured) | No (measured) | **Yes**, writes (measured) | No admin, free. One-off folder label (`icacls`, user level) | **Yes**: PowerShell `Add-Type` P/Invoke, which Bunny already uses for computer use (`src/server/computer.js`). Precompiling with `csc.exe` removes the 0.5 s compile | about 0.1 to 0.2 s once precompiled (estimate) | Good inside the folder. Caches and temp outside it fail (npm cache EPERM) and must be redirected |
| **B. Restricted token** (restricting SIDs) | Yes if the folder ACL grants the restricting SID (more setup than A) | No | Partly | No admin, free | Same P/Invoke route | Same as A | Not tested. Restricted tokens can break tools that open many system files |
| **C. Job Object alone** | **No** (limits processes, memory, CPU, UI; kill on close) | **No** | **No** | No admin, free | P/Invoke only; Node has no job API. Bunny kills trees with `taskkill /T` today (`workspace.js:304`) | Near zero | Not a security boundary; useful for limits and cleanup ([Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)) |
| **D. AppContainer** | Yes: only objects granted to the container SID are writable, so the folder needs an ACL grant | **Yes**: no network unless a capability such as `internetClient` is granted ([AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)) | Yes (own hive) | No admin to create a profile (per docs, not tested); free | P/Invoke with an extended startup-info attribute list: possible, more code than A. **Not prototyped** | Profile once, then close to A (estimate) | Likely poor: tools expect the user profile and `%TEMP%`; loopback to a local dev server is blocked unless exempted, which I believe needs admin. Not tested |
| **E. Per-program firewall rule** | No | **Yes**, for the named program only | No | **Needs admin** (`netsh advfirewall`) | `netsh`: no native module | Rule creation once per program | Cannot cover every child (`curl`, `git`, `node` each need rules). Ruled out by admin |
| **F. Windows Sandbox profile (.wsb)** | **Yes**: separate disposable VM; only mapped folders cross | **Yes** with `<Networking>Disable</Networking>` ([config](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-configure-using-wsb-file)) | Yes (own VM) | **Not on Windows Home**; Pro, Enterprise, Education only ([overview](https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-overview)). Enabling the feature is a system-wide change (admin, reboot; stated from general knowledge, not checked in the page); not enabled here (verified) | Yes: start `WindowsSandbox.exe file.wsb` | A VM boot per session, seconds not milliseconds (not measured) | A clean VM has none of the user's tools; the toolchain would need installing inside it. Poor fit for `run_command` |
| **G. WSL2** (Cursor's Windows answer) | Yes, via the Linux sandbox inside | Configurable | n/a | Free; installing WSL needs admin; present here | Yes | Process start in the distro | Runs Linux commands, not the PowerShell 5.1 that `run_command` uses (`workspace.js:117`) |

Out of scope: Sandboxie-Plus (installs a kernel driver, needs admin), Docker Desktop (licence limits, needs WSL2), and any paid tool.

## How Claude Code and Cursor do it on Windows

| Product | Windows behaviour | Source |
|---|---|---|
| Claude Code | "The sandbox runs on macOS, Linux, and WSL2. On native Windows, Claude Code runs commands unsandboxed." Windows users are told to use WSL2. macOS uses Seatbelt, Linux and WSL2 use bubblewrap and socat; network goes through a proxy with a domain allowlist | <https://code.claude.com/docs/en/sandboxing.md> |
| Cursor | On Windows it runs its Linux sandbox inside WSL2, and says a native Windows sandbox is "significantly harder because most existing sandboxing primitives are tailored to browsers and do not support general-purpose developer tools". It is working with Microsoft on this. The run-modes doc lists macOS (Seatbelt) and Linux (Landlock, seccomp), and falls back to asking for approval where the sandbox cannot run | <https://cursor.com/blog/agent-sandboxing>, <https://cursor.com/docs/agent/security/run-modes.md> |

Neither has a native Windows sandbox; both rely on approval prompts where sandboxing is unavailable. Bunny already has permission modes (`src/server/app.js:1509-1512`), so option A would put it ahead of Claude Code on native Windows for file and registry writes.

## Risks and limits of the recommendation

1. **Not a full sandbox.** Network and reads stay open (measured). A prompt-injected command can still send readable files out. The UI must say so and not call it "sandboxed" without qualification.
2. **The folder label is a persistent change** to the user's folder (an integrity label on it and its children). It is reversible (`icacls <folder> /setintegritylevel M`), but Bunny must ask once and record it. How long labelling a large tree takes: not measured.
3. **Tools that write outside the folder fail**: npm cache, `%TEMP%`, git global config, pip cache. The fix is setting cache and temp variables to a labelled folder per workspace; only the npm failure was observed.
4. Low integrity is a boundary against mistakes and simple malice, not against a determined exploit.
5. Not tested: antivirus reaction to a helper calling `CreateProcessAsUser`; a UNC or network drive as the workspace; programs that must write to `%LOCALAPPDATA%` (Electron apps, some compilers); Windows 10 (I only had Windows 11).

## Suggested next steps (Tech Lead to pick)

1. Precompile the helper with `csc.exe` and time 20 runs of `node`, `git` and `npm test` on an invented project; repeat on a Windows 10 machine.
2. Prototype AppContainer on a throwaway profile to answer the network question (row D, UNKNOWN).
3. Decide the user experience: a one-time folder-label prompt, a setting such as "Limit what commands can change", and a clear message when a command fails because of the boundary.

## Appendix: the prototype (`lowil.ps1`)

```powershell
param([string]$Cmd)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class LowIL {
  [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFO { public int cb; public string r1,desktop,title; public int x,y,xs,ys,xc,yc,fill,flags; public short show,r2; public IntPtr r3,i,o,e; }
  [StructLayout(LayoutKind.Sequential)] public struct PI { public IntPtr hP,hT; public int pid,tid; }
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool DuplicateTokenEx(IntPtr t,uint a,IntPtr sa,int il,int tt,out IntPtr n);
  [DllImport("advapi32.dll",SetLastError=true,EntryPoint="SetTokenInformation")] static extern bool SetTokenInformationRaw(IntPtr t,int c,IntPtr i,int l);
  [DllImport("advapi32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern bool CreateProcessAsUserW(IntPtr t,string app,string cmd,IntPtr pa,IntPtr ta,bool inh,uint fl,IntPtr env,string cwd,ref STARTUPINFO si,out PI pi);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool ConvertStringSidToSidW([MarshalAs(UnmanagedType.LPWStr)]string s,out IntPtr sid);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h,out uint c);
  public static string Run(string cmd,string cwd){
    IntPtr t,n,sid; OpenProcessToken(GetCurrentProcess(),0x2|0x8|0x80|0x1,out t);
    if(!DuplicateTokenEx(t,0x2000000,IntPtr.Zero,2,1,out n)) return "dup fail "+Marshal.GetLastWin32Error();
    ConvertStringSidToSidW("S-1-16-4096",out sid);                       // Low integrity
    IntPtr buf=Marshal.AllocHGlobal(16); Marshal.WriteIntPtr(buf,0,sid); Marshal.WriteInt32(buf,8,0x20);
    if(!SetTokenInformationRaw(n,25,buf,16)) return "setil fail "+Marshal.GetLastWin32Error();   // TokenIntegrityLevel
    STARTUPINFO si=new STARTUPINFO(); si.cb=Marshal.SizeOf(si); PI pi;
    if(!CreateProcessAsUserW(n,null,cmd,IntPtr.Zero,IntPtr.Zero,false,0x08000000,IntPtr.Zero,cwd,ref si,out pi)) return "create fail "+Marshal.GetLastWin32Error();
    WaitForSingleObject(pi.hP,60000); uint c; GetExitCodeProcess(pi.hP,out c); return "exit "+c;
  }
}
"@
[LowIL]::Run($Cmd,(Get-Location).Path)
```

Run only on invented temporary folders, after `icacls <folder> /setintegritylevel "(OI)(CI)L"`. Never against `%LOCALAPPDATA%\BunnyAI` or the owner's real folders.

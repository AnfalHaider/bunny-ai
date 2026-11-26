/**
 * LOCAL-MODELS LM-10 and Security's SP-6: the small program that starts the model runtime (llama-server) as a LOW integrity child, inside a KILL-ON-CLOSE job object, and ends it when Bunny is gone.
 *
 *   bunny-model-run.exe <bunny pid> <cwd> <command line>
 *
 *  1. It puts ITSELF in a job object whose limit is "kill everything in the job when the last handle closes". The server it starts inherits that job (no breakaway), so the job is the helper plus the server.
 *  2. It starts the command with the same restricted, privilege-free Low token as the F13 helper (confineHelper.js), inheriting this process's standard handles.
 *  3. It waits for the server AND for Bunny's own process. If Bunny ends, however it ends (a crash, a kill, a power loss of the window), the helper ends too, the job's last handle closes with it, and
 *     Windows kills the server. Exit code: the server's own, 126 when Bunny went first, 125 when it could not start anything.
 *
 * It is compiled once into the data folder with Windows PowerShell's Add-Type (as the F13 helper is), and its sha256 is checked before every use. Read the code: it is short on purpose.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { powershellPath } from './safeExec.js';

export const RUNNER_SOURCE = String.raw`using System;
using System.Runtime.InteropServices;
using System.Text;

public static class BunnyModelRun {
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFO { public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags; public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public int dwProcessId, dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinWs, MaxWs; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMIT { public BASIC_LIMIT Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr tok, uint flags, uint a, IntPtr b, uint c, IntPtr d, uint e, IntPtr f, out IntPtr newTok);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool DuplicateTokenEx(IntPtr t, uint access, IntPtr attrs, int impLevel, int type, out IntPtr newTok);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr t, int cls, IntPtr info, int len);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr tok, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForMultipleObjects(uint n, IntPtr[] handles, bool all, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr h, out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attrs, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXTENDED_LIMIT info, int len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);

  static int Fail(string why) { Console.Error.WriteLine("bunny-model-run: " + why); return 125; }

  public static int Main(string[] args) {
    if (args.Length != 3) return Fail("usage: bunny-model-run <bunny pid> <cwd> <command line>");
    int ppid; if (!int.TryParse(args[0], out ppid) || ppid <= 0) return Fail("bad pid");
    // 1. the job: when its last handle closes (this process ends, however it ends), Windows kills every process in it
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) return Fail("CreateJobObject " + Marshal.GetLastWin32Error());
    EXTENDED_LIMIT limit = new EXTENDED_LIMIT(); limit.Basic.LimitFlags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if (!SetInformationJobObject(job, 9, ref limit, Marshal.SizeOf(typeof(EXTENDED_LIMIT)))) return Fail("SetInformationJobObject " + Marshal.GetLastWin32Error());
    if (!AssignProcessToJobObject(job, GetCurrentProcess())) return Fail("AssignProcessToJobObject " + Marshal.GetLastWin32Error());
    // 2. a handle on Bunny's process to wait for (SYNCHRONIZE)
    IntPtr parent = OpenProcess(0x00100000, false, ppid);
    if (parent == IntPtr.Zero) return Fail("OpenProcess " + Marshal.GetLastWin32Error());
    // 3. the Low token, as the F13 helper makes it: no privileges, integrity S-1-16-4096
    IntPtr tok, restricted, low;
    if (!OpenProcessToken(GetCurrentProcess(), 0x2 | 0x8 | 0x1, out tok)) return Fail("OpenProcessToken " + Marshal.GetLastWin32Error());
    if (!CreateRestrictedToken(tok, 0x1, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out restricted)) return Fail("CreateRestrictedToken " + Marshal.GetLastWin32Error());
    if (!DuplicateTokenEx(restricted, 0x2000000, IntPtr.Zero, 2, 1, out low)) return Fail("DuplicateTokenEx " + Marshal.GetLastWin32Error());
    IntPtr sid;
    if (!ConvertStringSidToSid("S-1-16-4096", out sid)) return Fail("ConvertStringSidToSid " + Marshal.GetLastWin32Error());
    SID_AND_ATTRIBUTES label = new SID_AND_ATTRIBUTES { Sid = sid, Attributes = 0x20 };
    int size = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
    IntPtr buf = Marshal.AllocHGlobal(size);
    Marshal.StructureToPtr(label, buf, false);
    if (!SetTokenInformation(low, 25, buf, size)) return Fail("SetTokenInformation(integrity) " + Marshal.GetLastWin32Error());
    STARTUPINFO si = new STARTUPINFO(); si.cb = Marshal.SizeOf(typeof(STARTUPINFO)); si.dwFlags = 0x100;
    si.hStdInput = GetStdHandle(-10); si.hStdOutput = GetStdHandle(-11); si.hStdError = GetStdHandle(-12);
    PROCESS_INFORMATION pi;
    // CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT. No CREATE_BREAKAWAY_FROM_JOB: the server stays in the job.
    if (!CreateProcessAsUser(low, null, new StringBuilder(args[2]), IntPtr.Zero, IntPtr.Zero, true, 0x08000000 | 0x400, IntPtr.Zero, args[1], ref si, out pi)) return Fail("CreateProcessAsUser " + Marshal.GetLastWin32Error());
    // 4. wait for the server or for Bunny, whichever ends first
    uint which = WaitForMultipleObjects(2, new IntPtr[] { pi.hProcess, parent }, false, 0xFFFFFFFF);
    if (which == 1) return 126; // Bunny is gone: this process ends, the job closes, the server is killed
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    return (int)code;
  }
}
`;

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const run = (file, args, { timeout = 120_000, env = process.env } = {}) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout, env, maxBuffer: 1 << 20 }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
});

/** The compiled helper for model runs: built once, its sha256 checked before every use. */
export function createRunnerHelper({ dataDir, windows = process.platform === 'win32' } = {}) {
  const dir = join(dataDir, 'runtimes', 'helper');
  const exe = join(dir, 'bunny-model-run.exe');
  let expected = null;
  let building = null;

  async function compile() {
    await mkdir(dir, { recursive: true });
    await rm(exe, { force: true });
    const script = `Add-Type -TypeDefinition $env:BUNNY_RUNNER_SOURCE -OutputType ConsoleApplication -OutputAssembly '${exe.replace(/'/g, "''")}'`;
    const r = await run(powershellPath() ?? 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, BUNNY_RUNNER_SOURCE: RUNNER_SOURCE } });
    if (!r.ok) throw new Error(`the model runner helper could not be built: ${(r.stderr || r.stdout).slice(0, 200)}`);
    expected = sha256(await readFile(exe));
  }
  const rebuild = () => { building ??= compile().finally(() => { building = null; }); return building; };
  async function verify() {
    if (!windows) return { ok: false, why: 'The model runner is for Windows.' };
    if (!expected) return { ok: false, why: 'The helper has not been built yet.' };
    try { return sha256(await readFile(exe)) === expected ? { ok: true, path: exe } : { ok: false, why: 'The helper file changed.', changed: true }; } catch { return { ok: false, why: 'The helper file is missing.' }; }
  }
  /** Ready to use: built on first use, checked every time. */
  async function use() {
    if (!windows) return { ok: false, why: 'The model runner is for Windows.' };
    if (!expected) { try { await rebuild(); } catch (err) { return { ok: false, why: err.message }; } }
    const v = await verify();
    if (!v.ok) rebuild().catch(() => {});
    return v;
  }
  /** What to spawn: { file, args } for `command` (an already quoted command line), with Bunny's pid to watch. */
  async function wrap({ cwd, commandLine, bunnyPid = process.pid }) {
    const v = await use();
    if (!v.ok) return { ok: false, why: v.why };
    return { ok: true, file: v.path, args: [String(bunnyPid), cwd, commandLine] };
  }
  return { dir, exe, use, verify, rebuild, wrap, helperSha: () => expected };
}

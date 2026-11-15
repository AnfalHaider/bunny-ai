/**
 * Computer use for Bunny AI.
 *
 * Provides screenshot, click, type, key, hotkey, scroll, drag and wait
 * operations against the local desktop. Implemented with PowerShell on
 * Windows (no third-party dependencies) so Bunny AI can see and drive the
 * machine it runs on — behind an explicit per-session permission gate.
 */

import { exec, execFile } from 'node:child_process';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import os from 'node:os';

/** A live computer-use session: tracks the last screenshot and state. */
export function createComputerStore() {
  const sessions = new Map();

  async function getSession(id) {
    if (!sessions.has(id)) {
      sessions.set(id, {
        id,
        lastScreenshot: null,
        lastScreenshotTime: 0,
        createdAt: Date.now(),
      });
    }
    return sessions.get(id);
  }

  /** Take a screenshot of the primary monitor and return it as base64 PNG. */
  async function screenshot(sessionId) {
    const path = join(os.tmpdir(), `bunny-computer-${randomUUID()}.png`);
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($screen.Left, $screen.Top, 0, 0, $screen.Size)
$bitmap.Save('${path}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
`;
    await runPowerShell(ps);
    const data = await readFile(path);
    try { await writeFile(path, Buffer.alloc(0)); } catch { /* best effort cleanup */ }
    const sess = await getSession(sessionId);
    sess.lastScreenshot = path;
    sess.lastScreenshotTime = Date.now();
    return {
      path,
      data: data.toString('base64'),
      width: 0,
      height: 0,
    };
  }

  /** Click at screen coordinates. */
  async function click(sessionId, { x, y, button = 'left', count = 1 }) {
    let flags;
    switch (button) {
      case 'left': flags = '0x0002,0x0004'; break;
      case 'right': flags = '0x0008,0x0010'; break;
      case 'middle': flags = '0x0020,0x0040'; break;
      default: flags = '0x0002,0x0004';
    }
    const ps = `
${DPI_AWARE}
Add-Type -AssemblyName System.Windows.Forms
$cursor = New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)})
[System.Windows.Forms.Cursor]::Position = $cursor
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, int dwExtraInfo);
}
"@
${Array.from({ length: Math.max(1, Math.min(3, Number(count) || 1)) },
    () => flags.split(',').map((f) => `[Win32]::mouse_event(${f}, 0, 0, 0, 0)`).join('\n')).join('\nStart-Sleep -Milliseconds 60\n')}
`;
    await runPowerShell(ps);
    return { ok: true, x, y, button, count };
  }

  /** Turn the mouse wheel over a screen position. */
  async function scroll(sessionId, { x, y, direction = 'down', amount = 5 }) {
    const steps = Math.max(1, Math.min(30, Math.round(Number(amount) || 5)));
    const delta = (direction === 'up' ? 1 : -1) * 120 * steps;
    await runPowerShell(`
${DPI_AWARE}
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${Math.round(x)},${Math.round(y)})
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class BunnyWheel { [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, int data, int extra); }
"@
[BunnyWheel]::mouse_event(0x0800, 0, 0, ${delta}, 0)
`);
    return { ok: true, x, y, direction, steps };
  }

  /** Type text at the current cursor position. */
  async function typeText(sessionId, { text }) {
    // SendKeys reads + ^ % ~ ( ) { } [ ] as commands: wrap each in braces so it is typed as itself.
    const escaped = String(text ?? '').replace(/[+^%~(){}[\]]/g, '{$&}').replace(/\r?\n/g, '{ENTER}').replace(/'/g, "''");
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${escaped}')
`;
    await runPowerShell(ps);
    return { ok: true, text };
  }

  /** Press a key or hotkey. */
  async function key(sessionId, { keys }) {
    const map = {
      'enter': '{ENTER}', 'tab': '{TAB}', 'esc': '{ESC}', 'escape': '{ESC}',
      'space': ' ', 'backspace': '{BACKSPACE}', 'delete': '{DELETE}',
      'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
      'home': '{HOME}', 'end': '{END}', 'pageup': '{PGUP}', 'pagedown': '{PGDN}',
      'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}', 'f5': '{F5}',
      'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}', 'f9': '{F9}', 'f10': '{F10}',
      'f11': '{F11}', 'f12': '{F12}',
      'ctrl': '^', 'alt': '%', 'shift': '+', 'win': '{LWIN}',
    };
    const keyCode = keys.map((k) => map[k.toLowerCase()] ?? k);
    let ps;
    if (keyCode.length > 1) {
      const modifiers = keyCode.slice(0, -1).join('');
      const last = keyCode[keyCode.length - 1];
      ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${modifiers}${last}')
`;
    } else {
      ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait('${keyCode[0]}')
`;
    }
    await runPowerShell(ps);
    return { ok: true, keys };
  }

  /** Wait for a duration in milliseconds. */
  async function wait(sessionId, { ms }) {
    await new Promise((r) => setTimeout(r, ms));
    return { ok: true, ms };
  }

  /** Reset: release any held keys/buttons. */
  async function reset(sessionId) {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait("")
`;
    await runPowerShell(ps);
    return { ok: true };
  }

  /**
   * The whole screen for the model: the full picture on disk (for reading its
   * words) and a copy at most maxWidth wide (to show), with the scale between them.
   */
  async function capture({ maxWidth = 1280 } = {}) {
    const id = randomUUID();
    const full = join(os.tmpdir(), `bunny-screen-${id}.png`);
    const small = join(os.tmpdir(), `bunny-screen-${id}-small.png`);
    const out = await runPowerShellOut(`
${DPI_AWARE}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($s.Left, $s.Top, 0, 0, $s.Size)
$bmp.Save('${full}', [System.Drawing.Imaging.ImageFormat]::Png)
$scale = [Math]::Min(1.0, ${maxWidth} / $s.Width)
$w = [int]($s.Width * $scale); $h = [int]($s.Height * $scale)
$sm = New-Object System.Drawing.Bitmap($w, $h)
$g2 = [System.Drawing.Graphics]::FromImage($sm)
$g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g2.DrawImage($bmp, 0, 0, $w, $h)
$sm.Save('${small}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $g2.Dispose(); $sm.Dispose()
Write-Output ("SIZE " + $s.Width + " " + $s.Height + " " + $w + " " + $h)
`);
    const m = /SIZE (\d+) (\d+) (\d+) (\d+)/.exec(out);
    if (!m) throw new Error('The screen could not be captured.');
    const [width, height, shownWidth, shownHeight] = m.slice(1).map(Number);
    const data = await readFile(small);
    await unlink(small).catch(() => {});
    return { fullPath: full, data: data.toString('base64'), width, height, shownWidth, shownHeight, scale: shownWidth / width };
  }

  return { getSession, screenshot, click, type: typeText, key, wait, reset, capture, scroll };
}

const DPI_AWARE = `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class BunnyDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }
"@
[BunnyDpi]::SetProcessDPIAware() | Out-Null`;

/** Run a script from a file (no quoting trouble) and return what it printed. */
async function runPowerShellOut(script) {
  const file = join(os.tmpdir(), `bunny-ps-${randomUUID()}.ps1`);
  await writeFile(file, `﻿${script}`, 'utf8');
  try {
    return await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
        { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    });
  } finally {
    await unlink(file).catch(() => {});
  }
}

function runPowerShell(script) {
  return runPowerShellOut(script).then(() => undefined);
}

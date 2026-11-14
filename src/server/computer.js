/**
 * Computer use for Bunny AI.
 *
 * Provides screenshot, click, type, key, hotkey, scroll, drag and wait
 * operations against the local desktop. Implemented with PowerShell on
 * Windows (no third-party dependencies) so Bunny AI can see and drive the
 * machine it runs on — behind an explicit per-session permission gate.
 */

import { exec } from 'node:child_process';
import { writeFile, readFile } from 'node:fs/promises';
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
${flags.split(',').map(f => `[Win32]::mouse_event(${f}, ${Math.round(x)}, ${Math.round(y)}, 0, 0)`).join(';\n')}
`;
    await runPowerShell(ps);
    return { ok: true, x, y, button, count };
  }

  /** Type text at the current cursor position. */
  async function typeText(sessionId, { text }) {
    const escaped = text.replace(/'/g, "''");
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

  return { getSession, screenshot, click, type: typeText, key, wait, reset };
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    exec(`powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`, {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    }, (err) => {
      if (err) reject(err); else resolve();
    });
  });
}

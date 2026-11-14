/**
 * Speech with the voices built into Windows (System.Speech): free, offline, and
 * nothing leaves the computer. The model writes the words; this turns them into
 * a WAV file kept in the profile's audio folder.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_CHARS = 6000;

/** Markdown and code are for reading, not for saying aloud. */
export function speakableText(markdown) {
  return String(markdown ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_~>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

function powershell(script, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim().slice(0, 300))) : resolve(String(stdout))));
  });
}

export function createSpeech({ dataDir }) {
  const dir = join(dataDir, 'audio');
  const available = process.platform === 'win32';

  async function voices() {
    if (!available) return [];
    const out = await powershell('Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ($s.GetInstalledVoices() | Where-Object Enabled | ForEach-Object { $_.VoiceInfo.Name }) -join "`n"; $s.Dispose()', 20_000);
    return out.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
  }

  /** Turn text into a WAV file. Returns { id, url, bytes }. */
  async function synthesize(text, { voice } = {}) {
    if (!available) throw new Error('Speech uses the voices built into Windows, so it only works on Windows.');
    const words = speakableText(text);
    if (!words) throw new Error('There is nothing to say.');
    await mkdir(dir, { recursive: true });
    const id = randomUUID();
    const wav = join(dir, `${id}.wav`);
    // The text goes through a file, never through the command line.
    const input = join(dir, `${id}.txt`);
    await writeFile(input, words, 'utf8');
    const pick = voice ? `try { $s.SelectVoice('${String(voice).replace(/'/g, "''")}') } catch {}` : '';
    try {
      await powershell(`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${pick} $s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}'); $s.Speak([IO.File]::ReadAllText('${input.replace(/'/g, "''")}', [Text.Encoding]::UTF8)); $s.Dispose()`);
    } finally {
      await unlink(input).catch(() => {});
    }
    const { size } = await import('node:fs').then((fs) => fs.promises.stat(wav));
    return { id, url: `/api/audio/${id}.wav`, bytes: size };
  }

  return { available, voices, synthesize, dir };
}

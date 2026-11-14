/**
 * Reading the words in pictures with the text recognition built into Windows
 * (Windows.Media.Ocr): free, offline, nothing leaves the computer. It lets a
 * model that cannot see still read a screenshot, a photo of a page or a
 * scanned PDF, and gives a model that can see the exact words as well.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

const MAX_IMAGES = 12;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/webp': 'webp' };

const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw 'No text recognition language is installed in Windows.' }
foreach ($path in (Get-Content -LiteralPath $args[0] -Encoding UTF8)) {
  $text = ''
  try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $text = ($result.Lines | ForEach-Object { $_.Text }) -join "\`n"
    $stream.Dispose()
  } catch { $text = '' }
  'T:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
}
`;

export const ocrAvailable = process.platform === 'win32';

/**
 * The words in each picture (data URLs), in the same order; '' where none were found.
 * Never throws: text recognition is a help, not a requirement.
 */
export async function readTextInPictures(dataUrls) {
  const list = dataUrls.slice(0, MAX_IMAGES);
  if (!ocrAvailable || !list.length) return dataUrls.map(() => '');
  const dir = join(tmpdir(), `bunny-ocr-${randomUUID()}`);
  try {
    await mkdir(dir, { recursive: true });
    const paths = [];
    for (const [i, url] of list.entries()) {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(url));
      const ext = m && EXT[m[1].toLowerCase()];
      if (!ext) { paths.push(join(dir, `skip-${i}`)); continue; }
      const p = join(dir, `${i}.${ext}`);
      await writeFile(p, Buffer.from(m[2], 'base64'));
      paths.push(p);
    }
    const listFile = join(dir, 'list.txt');
    await writeFile(listFile, paths.join('\n'), 'utf8');
    const scriptFile = join(dir, 'ocr.ps1');
    await writeFile(scriptFile, `﻿${SCRIPT}`, 'utf8');
    const out = await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, listFile],
        { timeout: 90_000, windowsHide: true, maxBuffer: 8 << 20 },
        (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
    });
    const texts = out.split(/\r?\n/).filter((l) => l.startsWith('T:')).map((l) => Buffer.from(l.slice(2).trim(), 'base64').toString('utf8').trim());
    return dataUrls.map((_u, i) => texts[i] ?? '');
  } catch {
    return dataUrls.map(() => '');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

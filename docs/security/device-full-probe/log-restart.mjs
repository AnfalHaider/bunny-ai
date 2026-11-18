// R-DF2 probe (Security): does the device action log keep its history across a restart?
// A log file with one entry from "yesterday" stands for an earlier run; a fresh createRemoteAccess (a restart) then logs one action before anyone reads the log.
// Invented data only, in a temp folder. Usage: node log-restart.mjs <path to remoteAccess.js of the commit under review>
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { createRemoteAccess } = await import(pathToFileURL(process.argv[2]).href);
const dir = mkdtempSync(join(tmpdir(), 'sec-rdf2-'));
const logFile = join(dir, 'remote-actions.json');
try {
  const earlier = [{ at: new Date(Date.now() - 86_400_000).toISOString(), device: 'aaaaaaaaaaaaaaaa', label: 'Earlier device', kind: 'tool', tool: 'run_command' }];
  writeFileSync(logFile, JSON.stringify(earlier));
  const remote = createRemoteAccess({ logFile }); // a restart
  remote.logAction({ deviceId: 'bbbbbbbbbbbbbbbb', label: 'New device', level: 'everything' }, { kind: 'tool', tool: 'read_file' });
  await new Promise((r) => setTimeout(r, 300)); // let the write finish
  const onDisk = JSON.parse(readFileSync(logFile, 'utf8'));
  const kept = onDisk.some((a) => a.label === 'Earlier device');
  console.log(`entries on disk after a restart and one new action: ${onDisk.length}; the earlier entry is ${kept ? 'KEPT' : 'LOST  <-- finding'}`);
  const read = await remote.actions();
  console.log(`what the window then reads: ${read.length} entries (${read.map((a) => a.label).join(', ')})`);
} finally { rmSync(dir, { recursive: true, force: true }); }

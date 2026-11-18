// WEBAPP-SIGNIN (Security): can someone who is NOT signed in push a device's real actions out of the Activity log with refusals?
// Usage: node refusal-flood.mjs <path to src/server/remoteAccess.js>
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createRemoteAccess } = await import(pathToFileURL(process.argv[2]).href);
let t = Date.parse('2026-11-18T12:00:00Z');
const logFile = join(mkdtempSync(join(tmpdir(), 'sec-refusal-')), 'remote-actions.json');
const remote = createRemoteAccess({ logFile, now: () => t });
const on = await remote.enable({ lanHost: '192.168.1.20:5000', lanAddress: '192.168.1.20', passcode: 'correct horse battery 42' });
if (!on.ok) { console.log('could not enable', on); process.exit(2); }
remote.logAction({ deviceId: 'everything-phone', label: 'Android · Chrome', level: 'everything' }, { kind: 'tool', tool: 'run_command' });
const uas = ['Windows NT Chrome/1', 'Windows NT Firefox/1', 'Macintosh Safari/1', 'Android Chrome/1', 'iPhone Safari/1', 'Linux Firefox/1', 'Windows NT Edg/1', 'X11 Linux OPR/1'];
let minutes = 0;
const kept = async () => (await remote.actions()).some((e) => e.device === 'everything-phone');
while (minutes < 24 * 60 && (await kept())) {
  for (const reason of ['address', 'origin']) for (const ua of uas) remote.logRefusal(reason, ua); // wrong Host / Origin: needs no passcode
  t += 60_000; minutes += 1;
}
const all = await remote.actions();
console.log(`minutes of refusals from a requester that never signed in: ${minutes}`);
console.log(`log size: ${all.length}; refused entries: ${all.filter((e) => e.kind === 'refused').length}`);
console.log(`the Everything device's run_command entry is ${(await kept()) ? 'KEPT' : 'GONE (pushed out by refusals)'}`);

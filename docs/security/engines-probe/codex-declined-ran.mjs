// CLI-ENGINES (Security): does the Codex watchdog (CE-1.17) stop a run when a command Bunny DECLINED is reported as having run anyway?
// Usage: node codex-declined-ran.mjs <path to src/server/engines/codex.js>
import { pathToFileURL } from 'node:url';
const { createCodexDriver } = await import(pathToFileURL(process.argv[2]).href);
let watchdog = null;
const driver = createCodexDriver({ send: () => {}, judgeCommand: async () => ({ allow: false, reason: 'no' }), judgeChanges: async () => ({ allow: false }), schema: null, onWatchdog: (r) => { watchdog = r; } });
await driver.feed(JSON.stringify({ jsonrpc: '2.0', method: 'item/started', params: { item: { id: 'c1', type: 'commandExecution', command: 'type C:\secret.txt' } } }));
await driver.feed(JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'item/commandExecution/requestApproval', params: { itemId: 'c1', command: 'type C:\secret.txt' } }));
// Codex reports the declined item as completed, with exit 0 and no output deltas (a quiet command)
await driver.feed(JSON.stringify({ jsonrpc: '2.0', method: 'item/completed', params: { item: { id: 'c1', type: 'commandExecution', status: 'completed', exitCode: 0, aggregatedOutput: '' } } }));
console.log(`declined command reported as completed: watchdog ${watchdog ? 'TRIPPED (' + watchdog + ')' : 'did NOT trip'}`);

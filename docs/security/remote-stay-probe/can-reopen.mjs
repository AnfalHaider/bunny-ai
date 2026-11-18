// REMOTE-STAY (Security): does Bunny reopen to devices on a Public network it was never turned on with? Usage: node can-reopen.mjs <path to src/server/remoteAccess.js>
import { pathToFileURL } from 'node:url';
const { canReopen } = await import(pathToFileURL(process.argv[2]).href);
const noName = { enabled: true, address: '192.168.1.20', network: null }; // Windows could not name the network when access was turned on
console.log('no saved name, Public cafe Wi-Fi in the same /24:', JSON.stringify(canReopen(noName, '192.168.1.55', { name: 'CafeWiFi', category: 'Public' })));
console.log('no saved name, network unreadable now:', JSON.stringify(canReopen(noName, '192.168.1.55', null)));
console.log('saved name Home, Public cafe Wi-Fi:', JSON.stringify(canReopen({ address: '192.168.1.20', network: { name: 'Home', category: 'Public' } }, '192.168.1.55', { name: 'CafeWiFi', category: 'Public' })));

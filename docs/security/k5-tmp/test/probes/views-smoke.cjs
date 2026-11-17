// Starts views-smoke.mjs from a CommonJS entry, so its work does not block Electron's startup:  npx electron test/probes/views-smoke.cjs [folder]
const { pathToFileURL } = require('node:url');
const path = require('node:path');
process.argv.splice(1, 1); // drop this file's own path so the probe sees only the folder for its throwaway profile
import(pathToFileURL(path.join(__dirname, 'views-smoke.mjs')).href).catch((e) => { console.error('probe failed', e && e.stack); require('electron').app.exit(3); });

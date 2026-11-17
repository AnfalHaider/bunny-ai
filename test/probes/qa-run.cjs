// QA wrapper: starts the ESM probe from a CommonJS entry so the probe's top-level await does not block Electron's startup.
const { pathToFileURL } = require('node:url');
const path = require('node:path');
if (process.env.GPU_OFF) require('electron').app.commandLine.appendSwitch('disable-gpu');
process.argv.splice(1, 1); // drop this wrapper's own path so the probe sees only the userData folder
import(pathToFileURL(path.resolve(__dirname, process.env.PROBE || 'views-smoke.mjs')).href).catch((e) => { console.error('probe failed', e && e.stack, JSON.stringify(e, Object.getOwnPropertyNames(e || {}))); require('electron').app.exit(3); });

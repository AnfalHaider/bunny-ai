// Gate step "engine pins" (CLI-ENGINES §5.4): pins.json parses; every entry has an https URL on its host list and a sha256 for every file; Codex's schema file is present.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkPins, loadPins } from '../src/server/engines/pins.js';

const dir = fileURLToPath(new URL('../src/server/engines/', import.meta.url));
const problems = checkPins(loadPins(), { schemaExists: (f) => existsSync(dir + f), aboutText: readFileSync(fileURLToPath(new URL('../src/ui/settings.html', import.meta.url)), 'utf8') });
if (problems.length) { console.error(`engine pins: ${problems.length} problem(s)\n- ${problems.join('\n- ')}`); process.exit(1); }
console.log('engine pins: ok');

// BRAND-BUNNY (Security): what bunnyText does to commands and code inside a skill, and to its own placeholder. Usage: node rewrite.mjs <path to src/server/bunnyText.js>
import { pathToFileURL } from 'node:url';
const { bunnyText } = await import(pathToFileURL(process.argv[2]).href);
const cases = {
  'fenced shell command': '```sh\nrm -rf build/$ARGUMENTS\n```',
  'inline command': 'Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/fix.js` first.',
  'code sample': '```js\nconst Claude = require("x"); Claude.run();\n```',
  'url without a scheme': 'See github.com/acme/Claude/tree/main',
  'unclosed fence': 'Steps:\n```sh\ncp skill.md ~/.claude/skills/\n',
  'placeholder in the input': 'Visit https://example.com/a and \u00000\u0000 and \u00009\u0000. Claude rocks.',
};
for (const [name, text] of Object.entries(cases)) console.log(`${name}:\n  in : ${JSON.stringify(text)}\n  out: ${JSON.stringify(bunnyText(text))}`);

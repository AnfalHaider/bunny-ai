// S-8: print each advisory from an `npm audit --json` file. Usage: node summarize.mjs <audit.json>
import { readFileSync } from 'node:fs';
const a = JSON.parse(readFileSync(process.argv[2], 'utf8'));
console.log(JSON.stringify(a.metadata?.vulnerabilities));
for (const [name, v] of Object.entries(a.vulnerabilities ?? {})) {
  const via = v.via.map((x) => (typeof x === 'string' ? `<${x}>` : `${x.source}:${String(x.url).split('/').pop()}:${x.range}:${x.severity}:${x.title}`)).join(' | ');
  console.log(`${name} ${v.severity} direct=${v.isDirect} fix=${JSON.stringify(v.fixAvailable)}\n   via ${via}\n   nodes ${v.nodes.join(' ')}`);
}

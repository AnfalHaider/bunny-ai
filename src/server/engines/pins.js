/** CLI-ENGINES §4.3: the tested pins that ship with every Bunny release. Only tested versions; every pin change is a Security sign-off. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadPins(file = fileURLToPath(new URL('./pins.json', import.meta.url))) {
  return JSON.parse(readFileSync(file, 'utf8')).engines;
}

/** Problems with a pins object (empty list = fine): used by the gate step and the tests. */
export function checkPins(pins, { schemaExists = () => true, aboutText = null } = {}) {
  const problems = [];
  if (!pins || typeof pins !== 'object' || !Object.keys(pins).length) return ['no engines are pinned'];
  for (const [id, p] of Object.entries(pins)) {
    const say = (m) => problems.push(`${id}: ${m}`);
    if (!/^\d+\.\d+\.\d+$/.test(String(p.version))) say('no exact version');
    if (!p.entry) say('no entry program');
    if (!p.signature) say('no signature name');
    if (!Array.isArray(p.hosts) || !p.hosts.length) say('no download hosts');
    if (!Array.isArray(p.files) || !p.files.length) say('no files');
    for (const f of p.files ?? []) {
      let u = null; try { u = new URL(f.url); } catch { say(`bad url ${f.url}`); }
      if (u && u.protocol !== 'https:') say(`${f.url} is not https`);
      if (u && !p.hosts.includes(u.hostname)) say(`${u.hostname} is not on the host list`);
      if (!/^[a-f0-9]{64}$/.test(String(f.sha256))) say(`${f.name ?? f.url} has no sha256`);
      if (!['zip', 'tgz', 'file'].includes(f.kind)) say(`${f.name ?? f.url} has no kind`);
      if (f.integrity !== undefined && !/^sha512-[A-Za-z0-9+/]{86}==$/.test(String(f.integrity))) say(`${f.name ?? f.url} has an npm integrity value that is not sha512-<base64>`);
    }
    if (p.schema && !schemaExists(p.schema)) say(`schema file ${p.schema} is missing`);
    if (!p.licence) say('no licence text named');
    if (aboutText !== null && (!p.licenceName || !String(aboutText).includes(p.licenceName))) say(`its licence (${p.licenceName ?? 'unnamed'}) is not listed in Settings → About`);
    if (p.entrySha256 !== undefined && !/^[a-f0-9]{64}$/.test(String(p.entrySha256))) say('entrySha256 is not a sha256');
  }
  return problems;
}

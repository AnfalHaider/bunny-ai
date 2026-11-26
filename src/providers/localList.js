/** LOCAL-MODELS LM-5c and Security's SP-7: the curated list, frozen in source, and the checks every entry must pass. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadLocalList(file = fileURLToPath(new URL('./localModels.json', import.meta.url))) {
  return JSON.parse(readFileSync(file, 'utf8')).models;
}

/** Problems with a list (empty = fine). Used by the gate and the tests. */
export function checkLocalList(list, { sourcesText = null, forSigning = false } = {}) {
  const problems = [];
  if (!Array.isArray(list) || !list.length) return ['no models are listed'];
  const ids = new Set();
  for (const m of list) {
    const say = (t) => problems.push(`${m?.id ?? '?'}: ${t}`);
    if (!/^[a-z0-9][a-z0-9.-]{1,40}$/.test(String(m.id))) say('bad id');
    if (ids.has(m.id)) say('listed twice'); ids.add(m.id);
    if (!['apache-2.0', 'mit'].includes(m.licence)) say(`licence ${m.licence} is not apache-2.0 or mit`);
    if (m.gated !== false) say('gated is not false');
    if (!/^[0-9a-f]{40}$/.test(String(m.revision))) say('revision is not a 40-hex commit');
    if (!/^[0-9a-f]{64}$/.test(String(m.sha256))) say('no sha256');
    if (!(Number(m.size) > 0)) say('no size');
    if (!/^[A-Za-z0-9._-]{1,128}\.gguf$/.test(String(m.file))) say('the file is not a plain .gguf name');
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(String(m.repo))) say('the repo is not owner/name');
    if (!m.publisher || !m.name) say('no name or publisher');
    if (!(Number(m.kvBytesPerToken) > 0) || !(Number(m.nativeCtx) > 0)) say('no cache size per token or native context (read from the model, never guessed)');
    if (m.tools === true && !/S-LM2/.test(String(m.toolsProof ?? ''))) say('tools is true without a recorded S-LM2 result');
    if (sourcesText !== null && !(String(sourcesText).includes(m.sha256) && String(sourcesText).includes(m.revision))) say('is not in localModels.sources.md');
    if (m.template?.status === 'read' && !/^[0-9a-f]{64}$/.test(String(m.template.sha256))) say('its chat template is marked read but has no sha256');
    if (sourcesText !== null && m.template?.status === 'read' && !String(sourcesText).includes(m.template.sha256)) say('its chat template sha256 is not in localModels.sources.md');
    if (forSigning && m.template?.status !== 'read') say('its chat template has not been read (PENDING in localModels.sources.md)');
  }
  return problems;
}

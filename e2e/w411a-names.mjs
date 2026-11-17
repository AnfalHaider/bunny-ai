/**
 * QA, W4-11 slice A at 71f2f96, part 1: the name functions with tables (no server).
 * functionName: a function name an OpenAI-compatible endpoint accepts (letters, digits, _ and -, 1 to 64 characters).
 * connectorTools: every connector's tools at once, unique names, and an index from each offered name back to its server and real tool.
 *   node e2e/w411a-names.mjs
 */
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { functionName, connectorTools, toolPrefix } = await import(pathToFileURL(join(process.cwd(), 'src', 'server', 'mcp.js')).href);
const rows = [];
const check = (id, label, ok, detail = '') => { rows.push({ id, ok: Boolean(ok) }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  :: ' + String(detail).replace(/\s+/g, ' ').slice(0, 250) : ''}`); };
const VALID = /^[A-Za-z0-9_-]{1,64}$/;

const table = [
  ['search.web', 'dotted tool name'], ['files/read', 'slash'], ['get user (by id)', 'spaces and brackets'], ['naïve-tool', 'accent'], ['工具', 'non-latin'], ['emoji-😀-tool', 'emoji'], ['a:b;c,d', 'punctuation'],
  ['x'.repeat(100), '100 letters'], ['x'.repeat(64), 'exactly 64 with a prefix'], ['', 'empty name'], ['...', 'only dots'], ['UPPER_and-lower_123', 'already valid'], ['a\nb', 'newline'], ['a\u0000b', 'nul'], ['../../etc/passwd', 'path-like'],
];
for (const [name, label] of table) {
  const out = functionName('notes', name);
  check(`N1 ${label}`, `a tool name (${label}) with prefix notes gives letters, digits, _ and - only, 1 to 64 characters`, VALID.test(out), out);
}
check('N2', 'a short valid name is unchanged: notes__search_web', functionName('notes', 'search_web') === 'notes__search_web');
const a = functionName('notes', 'x'.repeat(100)); const b = functionName('notes', 'x'.repeat(99) + 'y');
check('N3', 'two long names that start alike stay apart (the cut carries a hash of the whole name)', a !== b && a.length === 64 && b.length === 64 && a.slice(0, 56) === b.slice(0, 56), `${a} | ${b}`);
check('N4', 'the same long name always gives the same function name', functionName('notes', 'x'.repeat(100)) === functionName('notes', 'x'.repeat(100)));
check('N5', 'a prefix of 24 characters with a 60-character tool name still fits in 64', VALID.test(functionName('a'.repeat(24), 'y'.repeat(60))));
check('N6', 'no prefix: the name alone is cleaned and kept (do.it gives do_it)', functionName('', 'do.it') === 'do_it', functionName('', 'do.it'));
check('N7', 'a tool name of exactly 64 with no prefix is not cut', functionName('', 'z'.repeat(64)) === 'z'.repeat(64));
const cut = functionName('', 'z'.repeat(65));
check('N8', 'a tool name of 65 is cut to 64 with the hash', cut.length === 64 && cut !== 'z'.repeat(64) && cut.startsWith('z'.repeat(56)), cut);
check('N9', 'toolPrefix cleans a connector name (Burrow Mail! gives burrow_mail) and keeps at most 24 characters', toolPrefix('Burrow Mail!') === 'burrow_mail' && toolPrefix('A'.repeat(40)).length === 24);
check('N10', 'a name made only of emoji does not crash the hash and is valid', VALID.test(functionName('p', '😀'.repeat(60))), functionName('p', '😀'.repeat(60)));
const empty = functionName('', '');
console.log(`INFO  an empty tool name with no prefix gives ${JSON.stringify(empty)} (${VALID.test(empty) ? 'valid' : 'NOT valid for a provider'}); the connector prefix is always present in practice`);

const tool = (name, readOnly = true) => ({ name, description: name, inputSchema: { type: 'object' }, readOnly });
const servers = [
  { id: 's1', name: 'Notes', tools: [tool('search.web'), tool('search_web'), tool('read')] },
  { id: 's2', name: 'notes', tools: [tool('read'), tool('write', false)] },
  { id: 's3', name: 'Notes!', tools: [tool('read')] },
  { id: 's4', name: '???', tools: [tool('ping')] },
  { id: 's5', name: '!!!', tools: [tool('ping')] },
  { id: 's6', name: 'x'.repeat(30), tools: [tool('a'), tool('b')] },
  { id: 's7', name: 'x'.repeat(30) + 'y', tools: [tool('a')] },
];
const out = connectorTools(servers);
const names = out.definitions.map((d) => d.function.name);
check('U1', 'all offered names are valid for a provider', names.every((n) => VALID.test(n)), names.join(' '));
check('U2', 'no name is offered twice (a provider refuses a request with two functions of one name)', new Set(names).size === names.length, `${names.length} names, ${new Set(names).size} distinct`);
check('U3', 'search.web and search_web (which clean to the same text) of one server both stay, the second as _2', names.includes('notes__search_web') && names.includes('notes__search_web_2'), names.filter((n) => /search/.test(n)).join());
check('U4', 'servers named Notes, notes and Notes! get the prefixes notes, notes_2 and notes_3', names.includes('notes__read') && names.includes('notes_2__read') && names.includes('notes_3__read'), names.filter((n) => /read/.test(n)).join());
check('U5', 'every offered name maps back to its OWN server and its REAL tool name (search.web keeps its dot)', out.index.get('notes__search_web')?.tool.name === 'search.web' && out.index.get('notes__search_web_2')?.tool.name === 'search_web' && out.index.get('notes_2__read')?.server.id === 's2' && out.index.get('notes_3__read')?.server.id === 's3');
check('U6', 'two servers whose names clean to nothing both get a prefix (connector, connector_2) and both ping tools stay', names.includes('connector__ping') && names.includes('connector_2__ping'), names.filter((n) => /ping/.test(n)).join());
check('U7', 'two long server names that share their first 24 characters stay apart', new Set(names.filter((n) => /^x/.test(n))).size === 3, names.filter((n) => /^x/.test(n)).join());
const plan = connectorTools(servers, { planMode: true });
check('U8', 'Plan mode leaves out the tool that is not read-only (write) and keeps the rest with the same names', !plan.definitions.some((d) => /write/.test(d.function.name)) && plan.index.has('notes_2__read'));
const many = Array.from({ length: 100 }, (_, i) => ({ id: `m${i}`, name: 'same', tools: [tool('t')] }));
const manyNames = connectorTools(many).definitions.map((d) => d.function.name);
check('U9', 'with 100 servers all named the same, 100 prefixes are all different and valid', manyNames.length === 100 && new Set(manyNames).size === 100 && manyNames.every((x) => VALID.test(x)), `${new Set(manyNames).size} distinct`);
check('U10', 'an empty or missing server list is fine', connectorTools([]).definitions.length === 0 && connectorTools(undefined).definitions.length === 0);
const clash = connectorTools([{ id: 'c', name: 'Docs', tools: [tool('a.b'), tool('a_b'), tool('a-b'), tool('a b')] }]).definitions.map((d) => d.function.name);
check('U11', 'four tool names (a.b, a_b, a-b, a b) are offered as four distinct valid names', new Set(clash).size === 4 && clash.every((x) => VALID.test(x)), clash.join(' '));
const longClash = connectorTools([{ id: 'c', name: 'Docs', tools: [tool('q'.repeat(70) + '.1'), tool('q'.repeat(70) + '_1')] }]).definitions.map((d) => d.function.name);
check('U12', 'two long names that clean to the same text but differ before cleaning stay distinct and at most 64', new Set(longClash).size === 2 && longClash.every((x) => VALID.test(x)), longClash.join(' '));
const lots = connectorTools([{ id: 'c', name: 'Docs', tools: Array.from({ length: 120 }, (_, i) => tool(i % 2 ? 'same.name' : 'same_name')) }]).definitions.map((d) => d.function.name);
check('U13', '120 tools that all clean to docs__same_name get 120 different valid names (the suffix never pushes a name over 64)', new Set(lots).size === 120 && lots.every((x) => VALID.test(x)), `${new Set(lots).size} distinct; longest ${Math.max(...lots.map((x) => x.length))}`);

const bad = rows.filter((r) => !r.ok);
console.log(`\n${rows.length - bad.length} of ${rows.length} passed`);
process.exit(bad.length ? 1 : 0);

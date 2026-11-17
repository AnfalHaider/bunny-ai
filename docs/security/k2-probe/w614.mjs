const K = process.env.KCO;
const m = await import('file:///' + K + '/src/server/mcpLocal.js');
const cases = [['npx', ['-y', 'x']], ['NPX', []], ['npx.cmd', []], ['npx.exe', []], ['C:/x/npx', []], ['./npx', []], ['npx && calc', []], ['npx;calc', []], ['npx\ncalc', []], [' node ', ['-e', 'x']], [['npx'], []], [{ toString: () => 'npx' }, []], ['cmd', ['/c', 'calc']], ['powershell', []], ['sh', []], ['bash', []], ['npx', 'a b'], ['npx', [1]], ['npx', [{}]], ['npx', null], ['n\u200bpx', []], ['npx\u0000', []], ['ｎｐｘ', []], ['docker', ['run', '--privileged']]];
for (const [c, a] of cases) { let r; try { const o = m.checkProposedCommand(c, a); r = 'ALLOWED ' + JSON.stringify(o); } catch (e) { r = 'refused (' + e.code + ')'; } console.log(r.padEnd(60), JSON.stringify(c).slice(0, 40), JSON.stringify(a)); }
const { createAppTools } = await import('file:///' + K + '/src/server/appTools.js');
const added = []; const t = createAppTools({ skills: {}, mcp: { add: async (x) => { added.push(x); return { ...x, type: x.command ? 'local' : 'remote' }; } }, getSettings: () => ({}), saveSettings() {}, stopConnector() {}, signOutConnector() {} });
for (const a of [{ name: 'a', command: 'npx', args: ['-y', 'p'], env: { X: '1' } }, { name: 'a', command: 'npx', args: ['-y', 'p'], env: {} }, { name: 'a', command: ['npx'], args: ['x'], env: null }, { name: 'a', command: 'npx', args: ['x'], url: 'https://e.com', env: undefined }, { name: 'a', command: 'bash' }]) {
  try { await t.run('add_connector', a); console.log('added', JSON.stringify(added.at(-1))); } catch (e) { console.log('refused:', e.message.slice(0, 80)); }
}

// W4-1d probe (Security): env leaked into a started program, and the supervisor gone after stopAll. Usage: node pg.mjs <checkout of 2525aed> <folder>   (prog.js is the started program; edit its path in line 5 to where this folder is)
// W4-1d probe (Security): env leak into the started program, and stand-in server killed hard.
const { createProcessStore } = await import('file:///' + process.argv[2] + '/src/server/processes.js');
const s = createProcessStore();
const p = s.start({ command: 'node ../p/prog.js', cwd: process.argv[3], owner: 'x' });
await new Promise((r) => setTimeout(r, 2500));
console.log(p.out.trim(), 'supervisor pid', p.child.pid);
await s.stopAll();
await new Promise((r) => setTimeout(r, 1500));
let alive = true; try { process.kill(p.child.pid, 0); } catch { alive = false; }
console.log('supervisor alive after stopAll:', alive);
process.exit(0);

// Stand-in for the Bunny server in proc-guard.test.js: starts one program, reports its pid, then idles until killed.
import { createProcessStore } from '../../src/server/processes.js';

const s = createProcessStore();
const p = s.start({ command: 'node -e "console.log(process.pid); setInterval(() => {}, 1000)"', cwd: process.argv[2], owner: 'x' });
const seen = setInterval(() => {
  const pid = parseInt(p.out, 10);
  if (pid) { console.log(`CHILD ${pid}`); clearInterval(seen); }
}, 100);
setInterval(() => {}, 1000);

// QA, W4-14b: the ask_user guard (asksToRunCommands) before (6ae82d6, copied below) and after (375d368) on a table of phrasings.
// Hand-offs to the person must be caught; decisions about what Bunny itself does must not be.
//   node e2e/w414b-guard.mjs
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const { asksToRunCommands: nu } = await import(pathToFileURL(join(process.cwd(), 'src', 'server', 'agentTools.js')).href);
// the guard as it was at 6ae82d6
const old = (q = {}) => {
  const text = [q.question, ...(Array.isArray(q.choices) ? q.choices.map((c) => c?.label ?? c) : [])].join(' ');
  return /\b(run|execute|paste|type|enter)\b[^.?!\n]{0,60}\b(commands?|scripts?)\b/i.test(text)
    || /\b(run|execute|paste|type|enter)\b[^.?!\n]{0,80}\b(in|into|using|from)\s+(a\s+|the\s+|your\s+)?(terminal|powershell|command prompt|cmd|shell|console)\b/i.test(text);
};
const T = true; const F = false;
const table = [
  // hand-offs: must be caught
  ['Can you run these commands in PowerShell for me?', T], ['Could you run npm install and tell me the result?', T], ['Would you please run the build?', T], ['Will you run the script and paste what it prints?', T],
  ['Please run npm install.', T], ['Please paste the output of this command from your terminal', T], ['Could you execute the script in cmd and tell me what it prints?', T],
  ['Run the following commands in your shell: npm install', T], ['Type these commands into a terminal window', T], ['You can run this in your terminal: git status', T], ['You need to run the migration yourself', T], ['You should run npm test and tell me', T],
  ['Paste the errors here when it fails', T], ['Paste the output below', T], ['Run these in PowerShell and send me the result', T], ['Paste this into PowerShell: Get-Process', T],
  ['I need you to run the installer', T], ['Open a terminal and run npm install', T], ["You'll need to run it yourself", T], ['Execute the following in your console', T], ['Kindly run the tests', T], ['Let me know when you have run npm install', T], ['Run npm install on your machine and tell me', T], ['Would you mind running the tests?', T],
  ['Can you copy the command and run it in a terminal?', T], ['Please type "npm start" in the console', T], ['Please enter the command in your shell', T],
  // decisions about what Bunny does: must NOT be caught
  ['Should I run the migration command now?', F], ['Do you want me to run the commands now?', F], ['I will run the commands now. Do you agree with the plan?', F], ['Do you want me to run the commands now or review them first?', F],
  ['Which framework do you want to use, React or Vue?', F], ['What should the project be called?', F], ['Should I use npm or pnpm?', F], ['Which folder should the project go in?', F], ['Do you want me to continue with the plan?', F],
  ['Which of these scripts should I run first: build or test?', F], ['Shall I run the tests after the change?', F], ['Is it OK if I execute the setup script?', F], ['May I run npm install in the project folder?', F], ['Do you want me to run it in the terminal here?', F],
  ['Can I run the build now?', F], ['Would you like me to type the command into the terminal?', F],
];
const extra = [
  [{ question: 'What next?', choices: [{ label: 'I will run the commands myself' }, { label: 'Cancel' }] }, T, 'a choice "I will run the commands myself"'],
  [{ question: 'How do you want to proceed?', choices: ['Run them for me', 'I will run them in my terminal'] }, T, 'a choice "I will run them in my terminal"'],
  [{ question: 'Pick one', choices: [{ label: 'Run the tests' }, { label: 'Skip the tests' }] }, F, 'choices "Run the tests" / "Skip the tests"'],
];
let missed = 0; let falseHits = 0; let oldMissed = 0; let oldFalse = 0;
for (const [q, want] of table) {
  const got = nu({ question: q }); const was = old({ question: q });
  if (want && !got) { missed += 1; console.log(`MISS  after: a hand-off that is not caught   "${q}"`); }
  if (!want && got) { falseHits += 1; console.log(`FALSE after: a decision caught wrongly       "${q}"`); }
  if (want && !was) oldMissed += 1; if (!want && was) oldFalse += 1;
}
for (const [arg, want, label] of extra) { const got = nu(arg); console.log(`${got === want ? 'PASS ' : 'FAIL '} ${label}: caught = ${got} (wanted ${want}); before: ${old(arg)}`); if (got !== want) { if (want) missed += 1; else falseHits += 1; } }
const n = table.length + extra.length;
console.log(`\nAFTER  (375d368): ${missed} hand-offs missed, ${falseHits} decisions caught wrongly, of ${n} phrasings`);
console.log(`BEFORE (6ae82d6): ${oldMissed} hand-offs missed, ${oldFalse} decisions caught wrongly (table only)`);
let crashed = false; for (const q of [{}, { question: null }, { question: 5, choices: null }, { question: 'x', choices: [null, 3, {}] }, undefined]) { try { nu(q); } catch { crashed = true; } }
console.log(crashed ? 'FAIL  the guard crashes on odd input' : 'PASS  the guard does not crash on odd input');

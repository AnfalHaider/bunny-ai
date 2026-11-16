/**
 * What the model reads of a chat: the conversation since the latest summary, with the
 * steps it took along the way.
 *
 * Tool steps (files written, commands run, pages read) are kept in the chat as their
 * own messages. They used to be left out of what the model read, so on the next message
 * it no longer knew what it had already done, and after a stop or a dropped connection
 * it started the job again. Now each turn's steps go back in, shortened, in front of
 * that turn's reply; a turn that was cut off says so, so the model can carry on.
 */
import { sinceSummary } from './sessions.js';
import { clip } from './clip.js';

// W6-18: a step's result is kept whole (within a budget), not cut to 300 characters, so a model that takes over
// (continue, another model after a failure) still knows what was read. The newest steps keep the most; a result
// that was saved to a file says where, so it can be read again.
const STEP_RESULT_NEW = 8000;   // characters of each of the newest steps' results
const STEP_RESULT_OLD = 400;    // characters of an older step's result
const NEWEST_STEPS = 12;
const STEPS_TOTAL = 60_000;     // characters of steps for one turn

const stepLine = (m, limit) => {
  const result = String(m.modelResult ?? m.result ?? '').replace(/[ \t]+/g, ' ').trim();
  const note = String(m.note ?? '').replace(/\s+/g, ' ').trim();
  const file = m.resultFile ? ` [full output saved in ${m.resultFile}: read_file it if you need the rest]` : '';
  return `${note ? `(you said: ${note.slice(0, 200)})\n` : ''}- ${m.tool ?? 'step'} (${m.status ?? 'done'})${result ? ` → ${clip(result, limit)}` : ''}${file}`;
};

// Steps are the stored tool_call messages of one turn, oldest first.
function stepsText(steps) {
  const lines = steps.map((m, i) => stepLine(m, steps.length - i <= NEWEST_STEPS ? STEP_RESULT_NEW : STEP_RESULT_OLD));
  let text = lines.join('\n');
  if (text.length > STEPS_TOTAL) text = `…\n${text.slice(-STEPS_TOTAL)}`;
  return text;
}

/**
 * @param {Array<object>} messages  the chat as stored
 * @param {(m: object) => object} toModel  turns one stored message into a model message
 * @returns {{ history: object[], interrupted: boolean }}
 *   interrupted: the turn before the latest message was cut off (stopped, dropped, or
 *   ended in the middle of its steps), so the model should continue it, not restart.
 */
export function buildHistory(allMessages, toModel) {
  // Errors are kept in the chat for the person; the model never reads them.
  const messages = allMessages.filter((m) => m.kind !== 'error');
  const start = sinceSummary(messages);
  const history = [];
  let steps = [];
  const flushCutOff = () => {
    if (!steps.length) return;
    history.push({ role: 'assistant', content: `[This reply was cut off before it finished. Steps already done:\n${stepsText(steps)}]` });
    steps = [];
  };

  for (const m of messages.slice(start)) {
    if (m.kind === 'permission_prompt') continue;
    if (m.kind === 'tool_call') { steps.push(m); continue; }
    if (m.kind === 'summary') {
      history.push({ role: 'system', content: `Summary of the earlier conversation (the older messages are not repeated here):\n${String(m.content ?? '')}` });
      continue;
    }
    if (m.role === 'user') {
      flushCutOff();
      history.push(toModel(m));
      continue;
    }
    // An assistant reply: its steps go in front of it, and a stopped one says so.
    const out = toModel(m);
    const prefix = steps.length ? `[Steps taken for this reply:\n${stepsText(steps)}]\n\n` : '';
    const suffix = m.kind === 'partial' ? '\n\n[This reply was stopped before it finished.]' : '';
    steps = [];
    if (typeof out.content === 'string') out.content = `${prefix}${out.content}${suffix}`;
    history.push(out);
  }
  // Steps after the latest message: this reply already started (another model, or a retry,
  // takes over). They go in as a note, never as a last assistant turn, which some providers
  // refuse and others read as a reply to finish with nothing.
  const tail = steps.length > 0 && messages.slice(start).filter((m) => m.kind !== 'tool_call' && m.kind !== 'permission_prompt').at(-1)?.role === 'user';
  if (tail) {
    history.push({ role: 'user', content: `[Note: work on this message already started. Steps already done:\n${stepsText(steps)}\n`
      + 'Do not redo them: check what is done and carry on from there.]' });
    steps = [];
  }
  flushCutOff();

  // Was the turn before the latest person's message cut off?
  const view = messages.slice(start);
  let lastUser = -1;
  for (let i = view.length - 1; i >= 0; i -= 1) if (view[i].role === 'user' && view[i].kind !== 'tool_call') { lastUser = i; break; }
  let prevUser = -1;
  for (let i = lastUser - 1; i >= 0; i -= 1) if (view[i].role === 'user' && view[i].kind !== 'tool_call') { prevUser = i; break; }
  let interrupted = false;
  if (lastUser > 0 && prevUser >= 0) {
    const turn = view.slice(prevUser + 1, lastUser);
    const replies = turn.filter((m) => m.role === 'assistant' && m.kind !== 'tool_call' && m.kind !== 'summary');
    const last = turn.at(-1);
    interrupted = !replies.length || replies.at(-1).kind === 'partial' || last?.kind === 'tool_call';
  }
  // The plan and the latest pictures of the turn that is being taken over (W6-18).
  const unfinished = view.slice(interrupted ? prevUser + 1 : lastUser + 1);
  const tasks = [...view].reverse().find((m) => m.tasks?.length)?.tasks ?? [];
  const pictures = unfinished.filter((m) => m.kind === 'tool_call').flatMap((m) => m.attachments ?? []).filter((a) => a.kind === 'image').slice(-2);
  if (tasks.length && (interrupted || tail || unfinished.some((m) => m.kind === 'tool_call'))) {
    history.push({ role: 'user', content: `[Your plan so far:\n${tasks.map((t) => `${t.done ? '[x]' : '[ ]'} ${t.text}`).join('\n')}\nKeep it up to date with update_tasks.]` });
  }
  return { history, interrupted, pictures };
}

/** Said to the model when the last turn was cut off. */
export const CONTINUE_NOTE = 'Your previous reply was cut off before it finished (stopped, or the connection dropped). '
  + 'Its steps are listed above. Do not start again: check what is already done (files, the plan, the workspace notes) '
  + 'and carry on from where it stopped, unless the person asks for something else.';

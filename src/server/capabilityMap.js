/**
 * AGENT-FLOW F2: what the model is told about which of Bunny's abilities are on right now, which are off, and how to get each one. It is fixed wording built from the real state, so the model
 * asks ("I can switch that on, may I?") or tells the person the one step, instead of saying "I can't". Pure: no files, no settings values beyond on/off, no names except the connectors' own
 * (cleaned). It adds no tool and grants nothing: every way to get an ability is the card or the Settings step that already exists.
 *
 * state: { code, computer, build, browser, pc, google, github, device, plan, connectors } with each of the first seven true or false, `device` true on a phone or other computer
 * (some abilities are the window's only), `plan` true in Plan mode, and connectors: [{ name, state: 'off' | 'needsSignIn' | 'failed' }] for the ones installed but not working (the working ones are
 * already named in the "Connectors:" line).
 */
const plain = (t) => String(t ?? '').replace(/[^\w .,:'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'a connector';

export function capabilityMap(state = {}) {
  const on = [];
  const how = [];
  const mark = (flag, name, whenOff) => { if (flag) on.push(name); else if (whenOff) how.push(`${name}: ${whenOff}`); };
  mark(state.code, 'files and commands', state.device ? 'a folder must be chosen in the window first' : 'off; call request_capability with code_mode (the person chooses a folder)');
  mark(state.computer, 'control of this computer', state.device ? 'only in the window' : 'off; call request_capability with computer_use');
  mark(state.build, 'building tools', state.device ? 'only in the window' : 'off; call request_capability with custom_tools');
  mark(state.browser, 'the browser panel', 'only in the desktop window; not here');
  mark(state.pc, 'searching this PC', state.device ? 'only in the window' : "off; tell the person to turn on Search this PC in Settings › Capabilities");
  const win = state.device ? " (in Bunny's window)" : '';
  mark(state.google, 'Gmail, Calendar and Drive', `not signed in; tell the person to sign in to Google in Settings › Profile${win}`);
  mark(state.github, 'GitHub', `not signed in; tell the person to sign in to GitHub in Settings › Profile${win}`);
  const parts = [`Abilities now. On: ${on.length ? on.join(', ') : 'none beyond chatting, web search and reading pages'}.`];
  if (how.length) parts.push(`Off, and how to get each: ${how.join('; ')}.`);
  const waiting = (state.connectors ?? []).slice(0, 6);
  if (waiting.length) {
    const word = { off: 'switched off', needsSignIn: 'needs sign-in', failed: 'did not start' };
    parts.push(`Connectors installed but not working: ${waiting.map((c) => `${plain(c.name)} (${word[c.state] ?? 'not working'})`).join(', ')}; the person switches them on or signs in under Settings › Customize.`);
  }
  parts.push('When a task needs something that is off, ask for it or say the one step: do not just say you cannot.');
  return parts.join(' ');
}

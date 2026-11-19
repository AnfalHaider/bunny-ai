/**
 * BRAND-BUNNY (v0.1.14; the owner: "when i ask the plugins and skills ... they say claude skills or md ... they are all supposed to be bunny and function for bunny properly").
 *
 * Skills, commands and plugins written for other apps (the common layout: SKILL.md, commands/*.md, CLAUDE.md, .claude-plugin/plugin.json) are imported as they are and
 * kept as they were. When one is READ (handed to the model, listed, previewed) its prose is said in Bunny's words, so the model and the person never meet another app's name
 * or paths as if they were Bunny's own: the assistant is Bunny, the instructions file is Bunny's instructions, the places a skill says to put files are Customize in Settings.
 *
 * Never changed (Security BB-1, BB-3):
 *  - code: fenced blocks and inline code spans stay exactly as written, so a command or a sample still runs and means what it said;
 *  - a model id (claude-sonnet-4), a model's own name (Claude 3.5 Sonnet), a web address or one without a scheme (github.com/acme/Claude/...), a domain, a lower-case command word.
 * $ARGUMENTS and ${CLAUDE_PLUGIN_ROOT} are not replaced where they stand: one fixed note in front of the text says what they mean (they may sit inside a command).
 */

// What stays as it is, found first and put back unchanged. Code comes first so nothing inside it is looked at again.
const KEEP = [
  /```[\s\S]*?```|~~~[\s\S]*?~~~/g,                                  // a fenced block
  /`[^`\n]+`/g,                                                      // an inline code span
  /\bhttps?:\/\/[^\s)>\]"'`]+/gi,                                    // a web address
  /\b(?:[a-z0-9-]+\.)+(?:com|org|net|io|ai|dev|app|co|gg|xyz|sh)\/[^\s)>\]"'`]*/gi, // a web address with no scheme: github.com/acme/Claude/tree/main
  /\b(?:[a-z0-9-]+\.)*(?:claude\.(?:ai|com)|anthropic\.com)\b[^\s)>\]"'`]*/gi, // a domain of that app
  /\bclaude-[a-z0-9][a-z0-9._-]*/gi,                                 // a model id: claude-sonnet-4, claude-3-5-haiku
  /\bClaude[ -]\d[\w.]*(?:[ -](?:Sonnet|Opus|Haiku|Instant)\b)?/g,   // Claude 3.5 Sonnet
  /\bClaude[ -](?:Sonnet|Opus|Haiku|Instant)\b(?:[ -]\d[\w.]*)?/g,   // Claude Sonnet 4, Claude Opus
];

const BUNNY_PLACE = "Bunny's Customize (Settings)";

// Applied in this order to everything else (prose only).
const RULES = [
  [/(?:~[\\/]|\$HOME[\\/]|%USERPROFILE%[\\/])?\.claude(?![-\w])(?:[\\/][\w.\\/-]*)?/g, BUNNY_PLACE],
  [/\bCLAUDE\.md\b/gi, "Bunny's instructions"],
  [/\bSKILL\.md\b/g, 'skill file'],
  [/\bClaude Code\b/g, 'Bunny'],
  [/\bClaude\b(?![-\w])/g, 'Bunny'],
];

const HAS_ARGUMENTS = /\$\{?ARGUMENTS\}?/;
const HAS_PLUGIN_ROOT = /\$\{?CLAUDE_PLUGIN_ROOT\}?/;
const NOTE_ARGUMENTS = "In this skill $ARGUMENTS stands for what the person typed after the command.";
const NOTE_PLUGIN_ROOT = "In this skill ${CLAUDE_PLUGIN_ROOT} is the plugin's own folder, which Bunny does not provide.";

/** Say a piece of third-party text in Bunny's words. Text with nothing to change comes back as it was. */
export function bunnyText(text) {
  // a stray NUL could pass for one of the placeholders below: none is kept
  const input = String(text ?? '').replace(/\u0000/g, '');
  const notes = [HAS_ARGUMENTS.test(input) ? NOTE_ARGUMENTS : null, HAS_PLUGIN_ROOT.test(input) ? NOTE_PLUGIN_ROOT : null].filter(Boolean);
  if (!/claude|SKILL\.md/i.test(input)) return notes.length ? `${notes.join(' ')}\n\n${input}` : input;
  const kept = [];
  let work = input;
  for (const re of KEEP) {
    work = work.replace(re, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  }
  for (const [re, to] of RULES) work = work.replace(re, to);
  const said = work.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
  return notes.length ? `${notes.join(' ')}\n\n${said}` : said;
}

/** One line Bunny gives the model beside any skill or plugin text: what they are called here. */
export const SKILL_NAMING_NOTE = "These are Bunny's skills. If one names another assistant or app, it means you, Bunny; never describe them as another app's skills or files.";

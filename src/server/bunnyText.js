/**
 * BRAND-BUNNY (v0.1.14; the owner: "when i ask the plugins and skills ... they say claude skills or md ... they are all supposed to be bunny and function for bunny properly").
 *
 * Skills, commands and plugins written for other apps (the common layout: SKILL.md, commands/*.md, CLAUDE.md, .claude-plugin/plugin.json) are imported as they are and
 * kept as they were. When one is READ (handed to the model, listed, previewed) its text is said in Bunny's words, so the model and the person never meet another app's name
 * or paths as if they were Bunny's own: the assistant is Bunny, the instructions file is Bunny's instructions, the places a skill says to put files are Customize in Settings.
 *
 * Never changed: a model id (claude-sonnet-4), a model's own name (Claude 3.5 Sonnet, Claude Opus), a web address, a domain, a command line word in lower case.
 */

// What stays as it is, found first and put back unchanged.
const KEEP = [
  /\bhttps?:\/\/[^\s)>\]"'`]+/gi,                                   // a web address
  /\b(?:[a-z0-9-]+\.)*(?:claude\.(?:ai|com)|anthropic\.com)\b[^\s)>\]"'`]*/gi, // a domain of that app
  /\bclaude-[a-z0-9][a-z0-9._-]*/gi,                                // a model id: claude-sonnet-4, claude-3-5-haiku
  /\bClaude[ -]\d[\w.]*(?:[ -](?:Sonnet|Opus|Haiku|Instant)\b)?/g,  // Claude 3.5 Sonnet
  /\bClaude[ -](?:Sonnet|Opus|Haiku|Instant)\b(?:[ -]\d[\w.]*)?/g,  // Claude Sonnet 4, Claude Opus
];

const BUNNY_PLACE = "Bunny's Customize (Settings)";

// Applied in this order to everything else.
const RULES = [
  [/\$\{?CLAUDE_PLUGIN_ROOT\}?/g, "the plugin's own files (not available in Bunny)"],
  [/\$\{?ARGUMENTS\}?/g, 'what the person typed after the command'],
  [/(?:~[\\/]|\$HOME[\\/]|%USERPROFILE%[\\/])?\.claude(?![-\w])(?:[\\/][\w.\\/-]*)?/g, BUNNY_PLACE],
  [/\bCLAUDE\.md\b/gi, "Bunny's instructions"],
  [/\bSKILL\.md\b/g, 'skill file'],
  [/\bClaude Code\b/g, 'Bunny'],
  [/\bClaude\b(?![-\w])/g, 'Bunny'],
];

/** Say a piece of third-party text in Bunny's words. Text with nothing to change comes back as it was. */
export function bunnyText(text) {
  const input = String(text ?? '');
  if (!/claude|SKILL\.md|ARGUMENTS/i.test(input)) return input;
  const kept = [];
  let work = input;
  for (const re of KEEP) {
    work = work.replace(re, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
  }
  for (const [re, to] of RULES) work = work.replace(re, to);
  return work.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
}

/** One line Bunny gives the model beside any skill or plugin text: what they are called here. */
export const SKILL_NAMING_NOTE = "These are Bunny's skills. If one names another assistant or app, it means you, Bunny; never describe them as another app's skills or files.";

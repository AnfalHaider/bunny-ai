# BRAND-BUNNY, d0a4c16 (Security): FAIL, the rename rewrites commands inside code

Branch claude/builder-a-brand-bunny, from main 18a8ba0. I read the diff. On an extract of d0a4c16 with an invented profile, `brand-bunny` and `plugins` pass 8 of 8.

## What holds

- **Nothing can be smuggled in by the rewrite itself.** `bunnyText` only swaps fixed patterns for fixed Bunny words: Bunny, Bunny's instructions, skill file, Bunny's Customize (Settings), and two fixed explanations. The words it puts in are Bunny's, never the author's. A skill author can already write any text they like, so the rewrite gives an attacker nothing new to say.
- **The stored originals are untouched.** The rewrite is applied when the text is read: the skills context, `read_skill`, the install preview, the search results and `shownDescription`.
- **What it never changes:** web addresses with a scheme, the `claude.ai` and `anthropic.com` domains, model ids (`claude-…`) and model names (Claude 3.5 Sonnet, Claude Opus 4) are kept (tests, and my probe).
- **The standing line** (`SKILL_NAMING_NOTE`) is a fixed sentence in Bunny's code.
- **The repository's CLAUDE.md** is imported as one more skill, `<plugin>:instructions`. It is:
  - counted in `MAX_SKILLS` and capped at `MAX_SKILL`;
  - added switched off, like every installed part (`skills.add({ ...s, enabled: false })`);
  - shown on the install card.

  Once switched on, it is untrusted skill text under the existing rules (scope, S-6, read only when on).
- **Hooks and scripts** are still not imported, and the person is told so in plain words.
- **Bunny's own strings** (tool descriptions, errors) no longer name another app. That's fine.

## BB-1 (MEDIUM, required): the rewrite changes commands and code inside a skill

The rules also run inside fenced code blocks and inline code. A skill's shell command, or its code sample, is handed to the model changed. The model may then run the changed command, with no card in Auto mode.

Probe (`docs/security/brand-bunny-probe/rewrite.mjs` on d0a4c16):

    fenced shell command:
      in : "```sh\nrm -rf build/$ARGUMENTS\n```"
      out: "```sh\nrm -rf build/what the person typed after the command\n```"
    inline command:
      in : "Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/fix.js` first."
      out: "Run `node the plugin's own files (not available in Bunny)/scripts/fix.js` first."
    code sample:
      in : "```js\nconst Claude = require(\"x\"); Claude.run();\n```"
      out: "```js\nconst Bunny = require(\"x\"); Bunny.run();\n```"

The first one, run as written, deletes `build/what` and then files named `the`, `person`, `typed`, `after`, `command` in the working folder. That isn't what the skill said, and nobody reviewed it.

**Fix:**
- Add fenced code blocks and inline code spans to `KEEP`, so code passes through unchanged:
  - a fenced block is three or more backticks or tildes, up to the matching closing fence (or the end of the text if it never closes);
  - an inline span is matching backtick runs on one line.
- Explain `$ARGUMENTS` and `${CLAUDE_PLUGIN_ROOT}` once, in a fixed note placed before the skill when either appears, instead of replacing them in place.
- Test the three probe cases.

## Smaller notes (fix with BB-1)

- **BB-2 (LOW): the placeholder can be forged.** The restore step turns any `\u0000<n>\u0000` back into kept item `n`, including ones already in the input. A skill can copy one of its own kept addresses to another place, or print `undefined`. The probe shows `\u00000\u0000` becoming `https://example.com/a`. It can only copy the skill's own text, but it's untidy. Remove NUL characters from the input first, or use a placeholder that can't occur in the input.
- **BB-3 (LOW): web addresses without a scheme.** `github.com/acme/Claude/tree/main` becomes `github.com/acme/Bunny/…` (probe), which is a different address. Keep `<domain>/<path>` forms the way `https://` addresses are kept.

## Verdict

FAIL at d0a4c16, for BB-1. BB-2 and BB-3 should be fixed in the same change. The rest passes. A re-review needs the probe showing code unchanged and the tests for it.

## Re-review at 9bf9fcc: PASS (supersedes the FAIL at d0a4c16)

- **BB-1 fixed.**
  - `KEEP` now starts with fenced blocks (```` ``` ```` and `~~~`) and inline code spans, so nothing inside code is rewritten.
  - `$ARGUMENTS` and `${CLAUDE_PLUGIN_ROOT}` are no longer replaced in place. Two fixed notes in Bunny's code go in front, only when the token appears.
  - My probe on 9bf9fcc: the fenced `rm -rf build/$ARGUMENTS`, the inline `node ${CLAUDE_PLUGIN_ROOT}/…` and `Claude.run()` all come back unchanged, with the note in front where it applies.
- **BB-2 fixed.** NUL characters are dropped before the placeholders. The probe gives `… and 0 and 9. Bunny rocks.`, with nothing restored from a forged placeholder.
- **BB-3 fixed.** `domain.tld/path` forms are kept, for a fixed list of top-level domains. `github.com/acme/Claude/tree/main` is unchanged.
- **BB-4 (LOW, not blocking): an unclosed fence.** A fence that never closes isn't recognised, so its contents are treated as prose. The probe's new case turns `cp skill.md ~/.claude/skills/` into `cp skill.md Bunny's Customize (Settings)`. Run as written, that's a shell syntax error (an unbalanced quote), so it fails rather than doing something else. Still, I asked for an unclosed fence to run to the end of the text. Fix it in a later build: `/```[\s\S]*?(?:```|$)/` and the same for `~~~`.
- **Tests:** `brand-bunny` and `plugins` pass 11 of 11 on an extract with an invented profile.

Verdict: PASS at 9bf9fcc, with BB-4 for a later build.

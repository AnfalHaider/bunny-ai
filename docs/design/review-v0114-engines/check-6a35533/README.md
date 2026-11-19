# Design check of Settings -> Engines on 6a35533 (invented profile, fake engine stand-in)

Matches v12: three rows (Bunny, Claude Code, Codex CLI), the Local | Account switch inline for an installed engine with the green recommended dot on Account, one main button, a menu, no Cline or Aider. Run: node ../check-engines.cjs <this folder>; log.txt.

Differences from v12:
- Rows are 58-59 px on desktop (drawn 53). On a phone an uninstalled row is 99 px (the Download button on a second line) and its dim line is cut ("checked bef...").
- The dim line repeats the mode ("v1.0.0 . Account") next to the switch; drawn: version and sign-in only.
- The menu holds Remove only here (no previous version, stand-in not signed in); "Remove" is almost unreadable in light mode (pale text on the white menu).
- The long lead paragraph above the list (4 lines desktop, 8 on a phone) says "Bunny judges every step with your permission rules", which ENGINE-RULES changes; the drawn page has no such block.
- "What was done" shows raw ids (claude-code, codex), an empty chip after "remove", and on a phone the hash chip drops to its own line.
- Not built yet (said so by Builder): Use Bunny's engine, Rules..., the per-chat chip, the Stopped card.

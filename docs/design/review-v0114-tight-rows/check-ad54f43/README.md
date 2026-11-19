# Design check of TIGHT-ROWS on ad54f43 (a109906), invented profile

Matches the approved drawing (5e0f5a4): 4 connectors are 210 px of list (drawn 208), skills 210, a plugin 52; the same on a phone (390 px), where today's card was 160 px each; the switch is on the row's line; one more control, a ... menu, holds Test, Trust read-only labels, Only in a folder..., Remove; the count line replaces the Type/Status header; Discover shows No sign-in chips and Added; Automation's MCP servers and Skills use the same row. Run: node ../check-rows.cjs <this folder>; results in log.txt.

Not exercised on the fake profile: the Sign in needed / Couldn't connect / Checking chips, Hooks and Schedules rows (none exist in the invented profile), the "Only in:" scope text, Trust read-only labels shown as ticked.

# W4-9 build 06b9d8c against drawing 6c8d168

Design, 2026-11-17. Verdict: **PASS**.

How shot: build `06b9d8c` extracted with `git archive`, served on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after), the real Settings page (Capabilities group) driven with Playwright, light and dark, 752 px and 342 px wide. Pictures in `shots/`; the exact line under the box in each state is in `shots/log.txt`. Not covered: contrast not measured (UNKNOWN); the browser's own open list of the select was not shot; the timing behaviour in the server is Builder's and was not tested here.

Checked and matching the drawing:
- Row under "Try another model when yours is busy", same group, name "Wait for a first reply", description as drawn; card text now reads "does not answer in time (see Wait for a first reply, below)".
- Select with 15, 30 (default), 60, 90, 120 and "Custom…"; default shows "Now: 30 seconds, or 60 for reasoning, image and video models".
- Custom: number box plus "seconds", focused; 45 shows "or 90"; reload keeps Custom and 45.
- Not allowed (5, 2.5): box turns red, "Use a whole number of seconds from 10 to 600. Not saved: still waiting 45 seconds." (last good value kept).
- Cap: 400 shows "or 600 for reasoning, image and video models"; 600 shows "Now: 600 seconds for every model".
- Switch off: row dimmed (about 55%, drawing said 50%, fine) and the description ends "Used only when "Try another model" is on."; the select stays usable.
- Phone: select, box and line drop under the text.
- Help picture `docs/images/settings-wait.png`: shows the row at the default, invented profile, no personal data.

Nothing to change.

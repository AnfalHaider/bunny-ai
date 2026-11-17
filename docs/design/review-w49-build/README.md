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

## O7 check at release candidate e028d3b (2026-11-17)
`docs/images/settings-wait.png` (last changed 13ba632) no longer matches the build. Shot e028d3b on an invented profile (`shots/rc-e028d3b-wait-light.png`): the "Wait for a first reply" row now has its select and the "Now: ..." line wrapped under the description, instead of the select on the right with the note stacked beneath it. Cause: `settings.html` still uses `right wait-right`, `wait-custom` and `wait-now`, but `src/ui/app.css` at e028d3b has no rules for them (they were in 13ba632 and are gone after the merges). The picture shows the intended design; the build drifted. Not re-shot, so the help picture is not made to show a regression. The phone rule and the Custom box styling are lost with it.

## Re-check at a6afcf5 (2026-11-17): PASS
The wait-row CSS is back in `src/ui/app.css`. Shot a6afcf5 on an invented profile (`shots/rc-a6afcf5-wait-{light,phone}.png`): the row matches `docs/images/settings-wait.png` (select on the right, "Now: ..." beneath it; on the phone the select and the note stack under the text). The help picture is unchanged and still right. Connector status words (checked with the real classes on customize.html, computed colour against the page background, WCAG ratio): light ok rgb(20,108,73) 6.10:1, warn rgb(130,84,8) 6.19:1; dark ok 9.36:1, warn 9.18:1; all pass 4.5:1. Not covered: the Custom seconds box open, dark wait row.

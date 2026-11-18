# ROW-FIX and CHIP-FIX: build 8e96b65 (07c698b the chip, 8e96b65 the push-down)

Design, 2026-11-18. Verdict: **PASS**.

How checked: build `8e96b65` (branch `claude/builder-b-0111`) extracted with `git archive`, run on an invented profile (temp data folder, fake upstream, own port). `/api/models` answered in the browser with two invented rows (the real model name "NVIDIA: Nemotron 3 Ultra (free)" and "Otter 3 Coder"); Code mode used a real session on an empty folder with a long name; the "Open to other devices" line was shown the way Builder B's e2e does it (a stand-in `window.bunnyDesktop` and a mocked `/api/remote` answering 2 signed in). Measured in the page and shot, 1280x800, 1280x480 (short window) and 390x780, light and dark: `shots/*.png`, every reading in `shots/log.txt` (18 combinations, none reported a problem).

## Without the line
- **Chat and Code, 1280 and 390, light and dark, also a 480 px high window:** the row under the box is fully inside the window (bottom at 782 of 800, 462 of 480, 762 of 780), the page does not scroll sideways or up and down, the app takes the whole window height, and the sidebar's foot (Import chat, Archived, profile) is on screen.
- **Code mode:** folder chip, branch, Manual, Medium and Auto · Code are all in view at 1280; at 390 they wrap onto three lines under the box, all inside the window.

## With the "Open to other devices" line (Code, 1280x800, 1280x480, 390x780, light and dark)
- The line is 37 px high across the top; the app starts directly under it (top 37) and ends at the window's bottom, so the row under the box ends at 782 of 800 (and 462 of 480), the sidebar's foot (Import chat, Archived, Bunny AI, Local) is on screen, and nothing is pushed off the bottom. No scrolling of the page, no sideways scroll. At 390 the line, the header and the whole under-row fit.

## The chip
- Auto: "Auto · Otter 3 Coder" at 1280 and 390, never cut to "A…": "Auto" is whole and the model name after it takes the ellipsis at its end (at 390 "Auto · Otter 3 C…"). The chip's Free tag shows at 1280 and is hidden on the phone, as drawn.
- A model chosen by hand with a long name ("NVIDIA: Nemotron 3 Ultra (free)", Chat mode): at 1280 it shows the whole name and the Free tag; at 390 it is cut at the end (readable start "NVIDIA: N…" in a 46%-of-the-width chip).

## Notes (not blocking)
- On a phone a long model name shows only about its first eight characters ("NVIDIA: N…"). The full name is in the chip's tooltip and the label; if the name matters on a phone, a width of about 55% would show more.
- My measurement of the sidebar foot used a selector that found nothing; I looked at the pictures instead, where it is visible in every shot.

Not covered: the real desktop window (the line comes from a mocked answer here), a real Windows scale factor above 100%, and any window height under 480.

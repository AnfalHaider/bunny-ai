# MODEL-CHIP: build 7086583 against the approved drawing

Design, 2026-11-18. Verdict: **PASS**, with small differences listed below (none blocks).

How shot: build `7086583` (branch `claude/builder-b-v0110`) extracted with `git archive`, invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). `/api/models` answered in the browser with seven invented model rows (Falcon Flash, Otter 3 Coder, Heron Mini, Lynx Flash Lite, Marten Pro on providers Harbor, Meadow, Quill, Fjord); real page and picker code. 1280 and 390 wide, light and dark: `{closed-auto,closed-picked,open,search,details}-{d,m}-{light,dark}.png`; every reading is in `log.txt`. Drawing: `docs/design/review-v0110-model-selector/index.html`.

## Matches the drawing
- **Closed:** the chip sits in `.composer-row` between the spacer and Send (order: attach, voice, spacer, picker, send). Desktop text "Auto · Falcon Flash" plus a Free tag, a provider dot, a chevron; picked model "Otter 3 Coder" plus "Free daily". Phone: dot and the name, no Free tag (150 px, 117 px when picked). The row under the box keeps mode, effort and job, and on desktop the hint; the model is gone from it. Tooltip and label read "Model: Auto: Falcon Flash (Harbor)".
- **Open, desktop:** floating selector 420 px wide, right edge aligned with the chip's right edge, opens upward (panel bottom 691 px, chip top 701 px). Search box has the focus.
- **Open, phone:** bottom sheet (80% of the screen), grab handle, dimmed page behind, search focused, one row per model with provider tags, context size, Details.
- **Search typed ("fla"):** "2 of 5 models"; Best for and the other groups are gone; the matches show with the first one selected.
- **Esc:** closes, focus back on the chip (all four combinations). **Picking a model:** closes, the chip changes, focus on the chip. **Phone:** a tap on the dimmed page and a tap on the grab handle both close it and give the focus to the chip. **Details:** replaces the list (Back, name, context, providers in order with arrows, Add to favourites).
- No page errors in any combination.

## Differences from the drawing (not blocking)
1. **Click outside on desktop** closes it but leaves the focus on the page (BODY), not on the chip. That is what a click on another place should do; my note in the drawing said "back on the chip", so the drawing note is the one to change. (On the phone, a tap outside returns it to the chip.)
2. **Filters** is on its own row under the search box, not on the search row as drawn. The old picker had it there; fine.
3. **An "Auto" row** (Best available for chat, then the next if it fails) heads the list. Not in my drawing; it is how Auto is chosen, so it has to be there.
4. **Best for** shows one group (Chat) here, where the drawing showed Chat and Code; in Code mode the group is Code. Rows keep W4-13's provider pills and model id line; the drawing used a dot instead of the pills.
5. **The chip's chevron** stays pointing down while the selector is open (the drawing flips it up). Small.
6. **Row highlight on the phone** ends before the context size and Details (the highlight covers the model button only). This is the W4-13 row structure, not new.

Not covered: the real model list, a model whose name is very long on the phone, the amber "switched provider" line inside the selector (nothing had switched), Thinking in Details (not changed here), the full gate (QA has it).

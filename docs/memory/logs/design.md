# Design - session log

Newest entry on top. Only this session writes this file.

## 2026-11-16 - D-2 and T-3 sign-offs against Builder's shots

**Verdicts (sign-off files under docs/signoffs/):** d2-transcript PASS at f07b3d2; d2-session PASS at 5f36e04; d2-changes FAIL at 5f36e04 (+0 -0 counts) then PASS at 9ca3f77; d2-files PASS at 9ca3f77; t3 FAIL at 78f49fe (status lines hidden on phone) then PASS at 9ca3f77. Build notes for D-2 at f0ce5eb.
**Method:** compared Builder's invented-profile shots with my artifacts. I opened a subset of the shots, not all of them (the sign-off notes say which). Phone decisions I made: the Changes and Files buttons stay in the top bar with 40px targets; on phone the status line sits above the composer.
**Not covered:** contrast (UNKNOWN), a real network drop, the git-folder variant of Changes, T-4 (not built).
**Lesson:** a verdict that says "FAIL" about a counter should first ask whether the shot script reused data; Builder's +0 -0 was a shot artefact, though the guarantee test it led to is useful.

## 2026-11-16 - 0.1.4 screens review (first task)

**Asked (Chief of Staff, about 8f01146):** a design review of the 0.1.4 screens that shipped without an artifact, on an invented profile only: today as built with proposed fixes beside it, both themes, 1440 and 390.

**What I did**

- Ran the app on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port 5463; stopped afterwards) and shot the eight screens in both themes at both widths with Playwright.
- Built `docs/design/review-0.1.4/index.html` (open it in a browser; Light/Dark and Desktop/Phone toggles) with the pictures under `shots/`. Proposals are the real page with the change applied in the browser, so what is drawn is what a build produces.
- Result: 3 pass, 5 with a proposed fix (all LOW): greeting hierarchy and an "Add a provider" button for the no-model state; Settings section list on phone (40vh) as a sideways pill row; bunny pink missing from tokens (owner decision); custom provider form moved up; Automation Add buttons uniform on phone.
- No code changed. Nothing built. No sign-off file written (nothing is built yet).

**Not covered:** contrast ratios (UNKNOWN), filled/connected states, the real Ctrl+/- zoom in the desktop shell, a live chat for the bunny.

**Lesson (for the Librarian to file; I did not write a lessons file, to avoid an id clash):** a screen embedded in a modal must be shot inside the modal. My first pass shot `settings.html?embed=1` at 1440 and showed rows 1400px wide that the real 1040px modal never shows; I caught it by opening the real modal and threw those pictures away.

**2026-11-16, owner's rule (relayed by the Chief of Staff):** "we are only working for english, no need to cover other languages." Design drops non-English from every not-covered list and from sign-off checks; English only from now on.

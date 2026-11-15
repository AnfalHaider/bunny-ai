# Design - session log

Newest entry on top. Only this session writes this file.

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

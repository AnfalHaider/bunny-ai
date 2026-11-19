# PICTURE-CHECK: the gate fails when a help picture no longer matches its screen (O7)

Tech Lead spec, 2026-11-19. Asked for by the Chief of Staff after Librarian's v0.1.14 help plan (99178e3) found that O7 has no gate check. Risk: **MEDIUM**: a gate change, test tooling only, no app code. To be built by **Builder**. Tech Lead reviews it, and QA runs it once on the gate PC before it joins the gate.

## Today (main, 18b44c1)

- **The pictures:** 16 PNGs in `docs/images/`, all referenced from `README.md`. Nothing in `src/ui` points at them.
- **How they are made:** by one-off scripts, such as `e2e/w4-9-picture.mjs` (`settings-wait.png`) and `e2e/w36b-shots.mjs`.
  - Each needs a server started by hand, and none runs in the gate.
  - They take screenshots of whatever the page shows, with no fixed clock, fonts or data.
- **What breaks:** a screen can change and its picture stays as it was. `scripts/gate.mjs` passes, and O7 says it should fail.

## 1. What counts as "the picture for a screen"

**A help picture is any image a person reads as help:**
- an image in `docs/images/` that `README.md` refers to;
- one that a help page in `docs/help/` refers to, if Librarian's proposed help folder lands;
- one that the app shows as help (Settings or About).

**Not help pictures:**
- Design's drawings and review pictures, `docs/design/review-*/**`. These are records of a moment, never re-rendered.
- `test-results/`.
- Release-record pictures.

**Each help picture has exactly one entry** in a new manifest, `docs/images/pictures.json`:

```json
{
  "settings-wait.png": {
    "scene": "settings-wait",
    "viewport": [860, 900], "theme": "light", "scale": 1,
    "capture": { "locator": ".group:has(#wait-row)" },
    "tolerance": 0.002,
    "alt": "Settings: Try another model when yours is busy, with Wait for a first reply",
    "usedBy": ["README.md"]
  },
  "hero.png": { "exempt": "hand-made art (Design); not a screen" }
}
```

**The field rules:**
- `scene` names a function in `e2e/pictures/scenes.mjs` (§2.2), which brings the invented profile to that screen.
- `capture` is one of: the whole viewport, `{ locator }`, or `{ clip: [x, y, w, h] }`.
- `tolerance` defaults to 0.002, see §2.3. An entry may raise it only up to 0.01, and only with a `"why"`.
- `exempt` is for pictures that are not screens, such as hand-made art. Each exempt entry needs a reason, and Design owns these entries.
- A picture of a phone screen is its own entry, with its own viewport and theme: for example `settings-wait-phone-dark.png`.

**Static rules, checked by the gate's fast step (§3.1):**
1. Every file in `docs/images/` has an entry, and every entry has its file. That catches a picture added with no scene, and a removed one left listed.
2. Every entry's `usedBy` file really refers to the picture, by path. Every reference to `docs/images/*` in `README.md` (and in `docs/help/**` or `src/ui/**`) has an entry. That catches dead pictures and pictures nobody shows.
3. The `alt` in the manifest equals the `alt` where the picture is used, so the help text and the picture's description cannot drift apart.

## 2. How it compares

### 2.1 One Playwright project, on the e2e suite's own server

A new project, `pictures`, is added to `playwright.config.js`. It reuses the e2e suite's `webServer`:
- already an invented profile (`BUNNY_DATA_DIR` = a temp folder);
- `BUNNY_FAKE_UPSTREAM=1`;
- its own port and token.

So no extra server starts, and the owner's profile is never touched.

`e2e/pictures.spec.js` makes one test per manifest entry that is not exempt. Each test:
1. runs the entry's scene;
2. captures;
3. compares with `expect(target).toHaveScreenshot(name, { maxDiffPixelRatio: tolerance, threshold: 0.2, animations: 'disabled', caret: 'hide', scale: 'css' })`.

`snapshotPathTemplate` for this project is `docs/images/{arg}{ext}`. So **the committed picture is the reference**, and there is no second copy anywhere.

On a failure, Playwright writes `test-results/.../<name>-actual.png` and `-diff.png`. They are never committed, and the failure line names the picture and its manifest entry.

### 2.2 The scenes: the same screen every time

`e2e/pictures/scenes.mjs` exports one async function per scene, `(page, api) => Promise<void>`.

**What a scene may do:**
- **Data:** it fills the invented profile **through the API**, not by clicking. That means seeded chats, settings, invented devices and so on, using the e2e helpers in `e2e/helpers.js`. It is fast, and the same on every run.
- **Names:** invented names only. The profile name is Sam (PRIV-2), with "Sam's phone" and "Kitchen laptop", and the folders shown are under `C:\Users\Sam`.
- **Clock:** `page.clock.install({ time: '2026-01-15T14:12:00' })` before the page loads, so every time and "2 min ago" is the same.
- **Fonts:** the interface and response fonts are set to bundled fonts (v0.1.13 FONTS, `src/ui/fonts`). The pictures then never depend on the PC's installed fonts. Code uses the bundled mono font.
- **Motion and randomness:**
  - motion is set to reduced, and Playwright's `animations: 'disabled'` is also used;
  - greetings and other random picks are fixed by a seed. The server already serves a fixed greeting under the fake upstream (A1);
  - the working-line animation is paused on its first frame.
- **Browser:** Chromium only, at `deviceScaleFactor` 1, in the viewport and theme from the entry. The theme comes from the emulated `colorScheme` **and** the `theme` setting, so both paths agree.

The scene for an existing picture is written by porting its one-off script. `w4-9-picture.mjs` becomes the `settings-wait` scene, for example. The one-off scripts are then deleted, so there is one way to make a picture.

### 2.3 The tolerance

- **The default is `maxDiffPixelRatio: 0.002`**, which is 0.2% of the pixels, with a per-pixel `threshold` of 0.2. It allows anti-aliasing noise on one machine, and catches any moved control, changed word or changed colour.
- **The gate runs on one PC, with Chromium pinned** by `package-lock.json`'s Playwright version. The pictures are rendered on the same PC by the same Chromium, so the noise between runs is near zero. QA's first run measures the largest diff across 5 runs of every scene (A2), and the default is confirmed or set from that number.
- **A Playwright or Chromium version change** is allowed to re-render every picture, in the same commit as the upgrade. The commit message says "pictures re-rendered for Playwright x.y". Librarian checks it the same way as any picture change (§4).

## 3. Keeping it fast

### 3.1 The gate's static step (seconds)

New gate step: **`help pictures listed`**, from `scripts/pictures-check.mjs`.
- It checks §1's three static rules.
- It runs no browser.
- It runs in `--quick` too.
- It has its own unit test, `test/pictures-check.test.js`, with fixture folders for each rule failing.

### 3.2 The render compare, inside the existing e2e step

- The `pictures` project runs in the same `npx playwright test` the gate already runs, so there is no new server start and no new step.
- Scenes seed through the API and navigate straight to the page, with no click-through.
- **The budget: at most 60 s for all pictures**, which is about 2 s per picture for the expected 25 to 30 in v0.1.14.
- `e2e/pictures.spec.js` checks its own total time, and fails with "pictures took Ns, over the 60 s budget" if it goes over. A slow scene is then fixed, never skipped.
- **`--quick` skips the render compare**, along with the rest of e2e, as today. So local iteration stays fast. A push always runs the full gate (O2).

### 3.3 Updating pictures

`npm run pictures` runs `playwright test --project=pictures --update-snapshots`.
- It re-renders every picture into `docs/images/`. `npm run pictures -- -g settings-wait` does one picture.
- It refuses to run unless the server reports `fake: true`, the same invented-profile check that `w4-9-picture.mjs` makes today.

## 4. Who commits what

| Who | Commits | When |
|---|---|---|
| **Builder** (whoever changes a screen) | The re-rendered pictures (`npm run pictures`) and any scene change, **in the same commit as the screen change** (O7). A new screen that help needs gets its scene and manifest entry here too. | Every screen change. The gate fails otherwise. |
| **Librarian** | `docs/images/pictures.json`: `alt` and `usedBy`, which picture belongs to which help text. The README or help references. The decision that a help text needs a new picture: Librarian adds the entry, then Builder writes the scene. Librarian also checks every re-rendered picture against its help text in the review (does the text still say what the picture shows?), and signs the piece. | With the help text for each row, and at each release's help check. |
| **Design** | The `exempt` entries, such as hand-made art (`hero.png`, `hero-dark.png`), with their reasons. **A look at every changed picture:** if the diff shows a screen that no longer matches Design's approved drawing, Design flags it in the review. That is a screen bug, not a picture update. Design writes no scene code. | With each changed picture, inside the normal review. |
| **QA** | The 5-run noise measurement (A2), before the step joins the gate. Afterwards, the O8 walk keeps checking what pictures cannot check: interaction, every width, every role. | Once at the start, then per batch as today. |

**A rule for reviews:**
- A commit that changes `docs/images/*.png` with no change to the screen it shows, and no Playwright upgrade, is refused in review. A picture never changes on its own.
- A commit that changes a screen and fails `pictures` is fixed by re-rendering, after Design's look. The tolerance is never raised to make it pass.

## 5. Build order

1. `scripts/pictures-check.mjs` and its test. Then the gate step `help pictures listed`.
2. `e2e/pictures/scenes.mjs`, `e2e/pictures.spec.js`, and the `pictures` project with its `snapshotPathTemplate`.
3. Port the 14 non-exempt pictures in `docs/images/` to scenes, and re-render them all once.
   - This first re-render is expected to change every picture, because the clock, fonts and data are now fixed.
   - Librarian and Design check the new set once.
   - It goes in as its own commit, "pictures: first render from scenes".
4. Delete the one-off picture scripts once their scenes exist.
5. QA's 5-run noise measurement. Then the default tolerance is confirmed, and the step is on.

## 6. Assumptions to confirm in the build

| Mark | Assumption | If it is wrong |
|---|---|---|
| A1 | Under `BUNNY_FAKE_UPSTREAM=1`, greetings, the working-line words and other random picks can be fixed (a seed, or a fixed choice in fake mode) with no change to how the real app behaves. | Each scene masks those regions with Playwright's `mask` option, and the mask is listed in the manifest entry. |
| A2 | Re-rendering on the same PC differs by well under 0.2% of the pixels. | The default tolerance is set from the measured maximum, times 2, capped at 1%. Above that, the noise source is found and fixed (fonts, GPU raster: try `--disable-gpu` for this project). |
| A3 | `toHaveScreenshot` with a custom `snapshotPathTemplate` writes into `docs/images/` on `--update-snapshots`, and compares against it otherwise, on Playwright 1.65. | `pictures.spec.js` compares itself with `pixelmatch` (already a Playwright dependency) against the committed PNG, using the same numbers. |

## 7. What changes in AGENTS.md (owner's file; text proposed, not written by Tech Lead)

O7's reason line can stay. Once this is in the gate, the rule text is true as written: "the gate checks them". No AGENTS.md change is needed. If the owner prefers it spelled out, the Chief of Staff proposes the line: "Help pictures are listed in `docs/images/pictures.json` and re-rendered by `npm run pictures`; the gate fails on a picture that no longer matches its screen."

# S-8: dependency audit at main d183f9c (2026-11-18)

I ran `npm audit --package-lock-only` in this worktree. Its `package.json` and `package-lock.json` differ from d183f9c only in the app's own version number (0.1.8 against 0.1.9), so the dependency tree is identical. The raw output is in `s8-audit/audit-d183f9c.json`, and `s8-audit/summarize.mjs` prints it.

Totals: 11 packages (5 moderate, 6 high). They come from only **two advisories**; every other package is listed because it depends on one of them.

| Advisory | Severity | Package and version | Packages listed only because of it |
|---|---|---|---|
| GHSA-fc5q-39xc-vjpf (ReDoS) | high | `picomatch` ≤4.0.7 | `fdir`, `tinyglobby`, `node-gyp`, `@electron/rebuild`, `app-builder-lib` (high through it) |
| GHSA-g3hv-75wg-m249 (DoS, globparts amplification) | moderate | `minimatch` 10.2.6, and 9.0.9 under `@electron/universal` | `@electron/universal`, `app-builder-lib`, `dmg-builder`, `electron-builder`, `electron-builder-squirrel-windows` |

**What ships:** `npm audit --package-lock-only --omit=dev` finds **0 vulnerabilities**, and `npm ls minimatch picomatch --omit=dev` is `(empty)`. Both advisories are in build tools only, never in the installed app.

## The 0.1.4 record against today

The baseline (`2026-11-16-baseline-0.1.4.md`, S-8) accepted "6 moderate". That was one advisory, minimatch, plus the five electron-builder packages that use it.
- **minimatch: still present.** Details below.
- **The five electron-builder packages: none are separate advisories.** They are minimatch's chain. `app-builder-lib` now shows as high only because picomatch also reaches it.
- **Gone: nothing.** The count looks different only because the picomatch chain is new since 0.1.4, and it is already signed (exception, review by 2026-12-17).

## minimatch GHSA-g3hv-75wg-m249: no safe upgrade

- **Fixed only in 11.x** (the vulnerable range is `>=7.0.0 <11.0.1`; latest 11.0.9). The 9.x and 10.x lines have no fixed release (`legacy-v9` is 9.0.9, still in range).
- **No builder release uses 11.x.** `app-builder-lib` asks for `^10.2.5` in 26.18.0, 26.18.1 and 27.0.0-alpha.14.
- **npm's suggested fix is a downgrade, so it is not safe.** It offers `electron-builder@25.1.0`, a semver-major downgrade from 26.18.0. The board row already says "do not downgrade electron-builder".
- **The only way to remove it today** is an npm `overrides` entry forcing `minimatch` to `^11.0.9`, against the `^10` and `^9` ranges its users declare. That might break packaging (the file filters in electron-builder), and only a full `npm run dist` with a comparison of the installer's file list would show it. That is a Builder task, not an ordinary upgrade.
- **Real risk is very low.** It is a denial of service, at build time only, on glob patterns from our own build config. It is not in the app, and a moderate does not fail the gate's full audit, which fails on high.

### For the owner to decide (Security does not sign exceptions)

**A (recommended): accept and record it** like picomatch.
- The Chief of Staff writes an entry for GHSA-g3hv-75wg-m249 at `node_modules/minimatch` and `node_modules/@electron/universal/node_modules/minimatch`, with the owner's words and a review date at most 30 days ahead.
- Re-check when `app-builder-lib` moves to minimatch 11.

**B: force minimatch 11 with an npm override.**
- A Builder adds `"overrides": { "minimatch": "^11.0.9" }`.
- Run the gate and a full `npm run dist`, and compare the installer's file list with v0.1.9's.
- This removes the finding but risks a broken build, for a build-time-only moderate.

## picomatch GHSA-fc5q-39xc-vjpf

Still present; it is already signed by the owner (9d5167a, review by 2026-12-17). No fix is published (`picomatch` ≤4.0.7). Nothing to do until the review date.

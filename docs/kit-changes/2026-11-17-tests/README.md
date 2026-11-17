# Tests on the installed kit (landing at K-3, d6e620a)

Run in the landing folder with `CLAUDE_PROJECT_DIR` unset (with it set to the landing folder, the guard judges the tests' throw-away repositories by the landing folder's role and 44 fail; that run is not kept).

- `live-kitnext1.txt` (`KIT_NEXT=1`): 196 of 198. Two failures:
  - `kit-next-landing`: "the live policy.json needs the staged additions" asserts the live policy is still the OLD one; after landing it is the staged one, so this failing is the expected result.
  - `kit-next-k2` K2-1: the guard answered "did not finish deciding in time" (fail closed, a refusal) instead of judging, while two builder gates ran on the same PC. Re-run alone: K2-1 2 of 2 pass. A timing margin under load, not a wrong decision (QA noted the same margin at 1d3a77c).
- `live-no-kitnext.txt`: 190 of 198. The same 8 as at 88bbd53: 7 old-baseline expectations the stricter kit refuses (Security's kit-land review: refusals, not holes) plus the same landing policy check.

---
piece: kit-land
role: qa
sha: da999b0
verdict: PASS
date: 2026-11-17
---

Kit landing at da999b0 (K-3 plus K-4, supersedes ba091a6), checked in a checkout of that sha against the INSTALLED .bootstrap/bin, no KIT_NEXT, invented repos only. Diff read: K-4 changes four test files only (guard-helpers, guard-next-a2, guard-next-c, kit-next-landing) and nothing under .bootstrap, .githooks or scripts/kit-next, so the installed guard I timed at ba091a6 is unchanged. The change adds NEW_KIT (true when KIT_NEXT is set or the installed guard and policy library equal the staged 0.6.0 ones) and swaps it for the KIT_NEXT checks; no assertion was weakened (an old guard still gets the old checks; after landing the landing test now requires the live policy.json to equal the staged one). My 29 everyday cases 29/29 (the first run under heavy machine load gave 26/29, three commands refused by the 6 s deadline, then 29/29 when the machine was quiet); my 24 extra cases 21/24, the same three as before. The four test files that failed in the full parallel run (guard-next-a2, guard-next-c, guard-next, kit-next-k2) pass 54 of 54 run one at a time. LOAD CAVEAT: the full suite run in parallel while other sessions were testing failed 9 tests of 198, each with the guard did not finish deciding in time refusal (even git status), tests taking 14 to 69 s; none failed when the files ran serially. So the gate should run these suites with test concurrency 1, or the deadline should be raised for tests; on a saturated PC the same deadline can refuse an everyday command, which is the usability follow-up I raised at ba091a6. Not run: a live session with the real hooks.

---
piece: release-0.1.10
role: tech-lead
sha: 9d4e942
verdict: FAIL
date: 2026-11-18
---

RA-1 required: remoteAccess.js:217-231 signIn checks waitFor(ip) before awaiting scrypt and records the failure after, so tries in flight all pass. A scratch copy at 9d4e942, 60 parallel wrong passcodes from one IP: 60x401 then 429 (the limit is 5); the flood guard (line 213) has the same race. Fix and done-when in the shared note tech-lead-release-0.1.10-RA1.md. Everything else checked with no finding: no lost lines in 15 merges (1c678a6 askCapability and b129e55 selectModel keep both sides), app.css == build at every merge and at 9d4e942, unit-tests.mjs identical to 29aba58, safeExec.js sound, remote routing allow-lists re-checked with the body.

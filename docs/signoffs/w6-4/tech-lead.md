---
piece: w6-4
role: tech-lead
sha: 71b8fff
verdict: PASS
date: 2026-11-16
---

Re-review of 442d61c..71b8fff. A reply that ends on the length limit with a written-out call, or a native call whose JSON arguments do not parse, is not run: the model is told the call was NOT run and to resend in smaller pieces, up to 3 times, then a clear error. The tests cover both shapes and check that the half file is not sent back, and that a complete call still runs without its closing tags. Residual, not blocking: an unclosed written call that ends without a length finish (a clean connection close with no stop reason) would still run; treating a missing finish reason as cut off would close it. e2e not run by me.

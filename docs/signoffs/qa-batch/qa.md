---
piece: qa-batch
role: qa
sha: 883dafd
verdict: PASS
date: 2026-11-17
---

Builder A's fix of QA's findings, walked on the candidate head ec2afa2 (holds 883dafd). e2e/w019-qabatch.mjs 14/14. Bar size rules (real logic): text 100 KB and exactly 128 KB accepted, over 128 KB refused as 'The text file is over 128 KB.' (never the key message; a small secret still gets the key message); picture 2 MB and exactly 3 MB accepted, over refused 'The picture is over 3 MB.'; PDF up to exactly 8 MB accepted, over 'The file is over 8 MB.'; screenshot 3 MB accepted, over 'The screenshot is over 3 MB.'. Chat: a 2 MB picture sent with a message reaches the model as an image (200); a 5 MB picture gets the chat's own plain 'Images must be under 4 MB.'; a message declared 60 MB is refused 413 'over 48 MB'; ordinary messages fine. G11 with the real plugin code: two plugins naming one connector address share one connector; uninstalling A keeps it and removes A's own; it is handed to B; uninstalling B removes it and the skills; updating A so it drops the shared address leaves it while B uses it. Not run: the real Electron file dialog (needs OS keys).

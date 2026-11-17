---
piece: w6-10
role: qa
sha: 591bf83
verdict: PASS
date: 2026-11-17
---

Real Electron window on the candidate head 591bf83, invented profile (BUNNY_DATA_DIR and --user-data-dir temp folders), no OS keys, no network (page, picture, stylesheet, font and the scripted model are all served on 127.0.0.1 by the walk). e2e/w019-w610.mjs 16/16: the scripted model opened a local page in the panel, inspected it four ways and captured it. inspect html = the page as it is now (a paragraph added by the page's own script is present); css h1 = computed values (rgb(255, 120, 0), 40px, Carrot font); network = the four files the page loaded with sizes and times; fonts = 'Fonts in use: Carrot'. Capture wrote exactly one folder captures/127.0.0.1-<port>-<date>-<time>/ in the chat's invented folder: index.html is the page as it is now with every link changed to assets/NN-name copies, picture bytes identical to the original, the stylesheet's font and image urls rewritten to the saved copies, the model told '5 files, 1 KB'; nothing else was written in the folder. Only local paths were requested. Not walked here: Plan mode refusal and a rule that denies the capture folder (Builder's tests cover them; Plan mode refusal of install_from_github was walked for w6-6) and a capture of an outside page (never the network).

---
piece: w5-7
role: tech-lead
sha: 400946b
verdict: FAIL
date: 2026-11-16
---

Delta 32a3a8c..400946b. Good: the long-reply caps, scheduled caps, maxTokens, helpers switch and model filter are window-only; answering a question card is window-only (the page already sends it through sendJSON, so ask_user cards still work in the app); computed arguments (parentheses, @( ), $( ), $name, @args, here-strings, a backtick before a hyphen, an unpaired quote) now make a Deny or Ask rule ask, read in one left-to-right pass, failing closed. One required fix: PUT /api/settings now refuses any key that is not on the two lists, and six keys that Settings itself writes are on neither: chartsEnabled, fallbackWhenBusy, statusLabels, transcriptView, promptSuggestions, autoUpdate (data-key and data-cap switches in settings.html). I probed a running app: PUT transcriptView, statusLabels and promptSuggestions each return 400 settings.unknownKey, so those switches cannot be changed (transcriptView is the Verbose or Thinking view). Fix: add the six to ORDINARY_SETTING_KEYS, and add a test that reads every data-key, data-cap and save(...) key in src/ui and fails if one is on neither list, so the next switch cannot be missed. I scanned the static save() calls and the data-key and data-cap attributes of all pages; the six are the only gaps I found. Merge with Builder B's branch (643c7da) was clean at 32a3a8c. e2e not run by me.

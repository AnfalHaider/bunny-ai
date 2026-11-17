# W4-13 model picker: build 2ef5070 against drawing 20f9c41

Design, 2026-11-17. Verdict: **PASS** (supersedes the FAIL at 856d058).

How shot: build `2ef5070` extracted with `git archive`, served on an invented profile (temp `BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`, own port, stopped after). The fake profile has no models, so `/api/models` was answered in the browser with an invented list (Falcon Flash, Otter 3 Coder, Heron Mini, Marten Pro, Lynx Lite, Owl Vision, Wren Voice, Sable 7B on invented providers Harbor, Meadow, Quill, Fjord). Real page, real picker code. Light and dark, 1440 and 390 wide: `shots/{open,filters,cando-code,sort-name,free-harbor,details}-{light,dark}-{d,m}.png`; every row's text and counts are in `shots/log.txt`. Not covered: contrast not measured (UNKNOWN); the real server's model list and the real `nativeSpeech` flags (only invented ids were used: the id `wren-realtime-audio` showed Speech, the others did not); Thinking (moved to v0.1.9) and slice 3 (automatic switch).

## The four items from the FAIL at 856d058
1. **Best for Chat is one row per model**: Marten Pro, Otter 3 Coder, Falcon Flash, Owl Vision, Lynx Lite, each once, with all its provider tags. Fixed.
2. **Can-do and Sort chips present**: Provider, Can do (Code, See, Image, Video, Speech), Free only, Sort (Recommended, Name, Context size). Code gives "1 of 8 models"; Name and Context size reorder All models correctly (Context size: 1M, 200K, 128K, 100K, 64K, 32K, 8K). Fixed.
3. **Context size on the right beside "Details ›"** (1M, 200K, 128K). Fixed.
4. **Speech only where the model makes sound itself**: only Wren Voice shows Speech; the Speech chip filters to it ("1 of 8"). Fixed.

## Also matches the drawing
Free before Free daily before untagged tags, in order; Free only plus a provider gives "2 of 8 models" and "Filters · 2"; the Details view (Back, providers in order with Ready and up and down arrows, favourite) fits on the phone as a sheet; dark theme and 390 px readable throughout.

## Notes, not blocking
- Sort changes the All models list only; "Best for Chat" stays in recommended order. Reasonable; say so in help text if it surprises people.
- On the phone the open filter strip takes about a third of the sheet; the list scrolls under it. Acceptable.

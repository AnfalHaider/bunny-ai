# v0.1.16 release review at 521abb71 (Tech Lead, 2026-11-27)

This was a reading-only review: nothing was run. The gate results are the Chief of Staff's.

The candidate is 521abb71 on `claude/v0116-quick-integration`, compared with origin/main. It changes 76 code files: 6,456 lines added and 90 removed.

## What was read

- **The routes and device rules:** the diff of `src/server/app.js`, `windowOnly.js`, `remoteAccess.js` and `ownAddress.js`.
- **The runtime:** all of `src/server/localRuntime.js`, and `ensure()` in `src/server/localModelsReal.js`.
- **Web search:** the parts of the `src/server/webSearch.js` diff that add hosts and links.
- **Claude sign-in:** the `src/server/engines/service.js` diff (SB-1 and the paste box).
- **The test-fix commit b03cd5a3:** whether it weakens any test.

## Matches the spec (LOCAL-MODELS rev 3, fb079a77)

- **LM-1, LM-2:** the `bunny-local` provider has the managed kind. `providerKey()` gives the running server's key for each request, and it's never stored. `/api/providers` returns an empty `baseUrl` for `bunny-local`.
- **LM-13, LM-14, LM-18:** in the chat route (`app.js:2617`), the caller is decided this way:
  - a device, at either level, is `device`;
  - `body.scheduledTask` is `scheduled`;
  - `textOnly` without `adminOk` is `textOnly`;
  - anything else is `window`.

  `ensure()` (`localModelsReal.js:245`) gives every caller except `window` the error `local.notRunning`, unless that model is already running. The `??` operator is correct here:
  - an Everything device sets only `bunnyDevice`;
  - a Chats device sets `bunnyRemote` (`app.js:5129`, `app.js:5135`).
- **Window-only routes:**
  - `/api/local-models` writes are in `WINDOW_ONLY_ROUTES`;
  - every method on `/places`, reads included, is window-only too;
  - `deviceRefusal` refuses them at both device levels, as the engines do.
- **LM-8:** Smart gives a card, never an allow, when the chat's model is local and no judge model is chosen (`app.js:2895`).
- **LM-10:** the command line is built and checked by `checkArgv`:
  - it always has `--host 127.0.0.1`, `--api-key-file`, `--no-ui` and `--no-slots`;
  - `FORBIDDEN_FLAGS` covers every flag the spec forbids, plus `--api-key`, `--ui`/`--webui`, `--path`, the SSL options, `--chat-template-file`, `--mmproj`, the draft-model options and `--slot-save-path`;
  - the environment is the minimal one plus `HF_HUB_OFFLINE` and `LLAMA_CACHE`;
  - the key file is locked with `icacls` before the start, and Bunny refuses to start if it can't be locked;
  - the runtime is re-hashed with `verifyRuntime` before every start;
  - the port is checked for no LAN reach, and the server is stopped if it answers there;
  - leftover processes are killed by their path.
- **Rulings that replaced the spec text, followed as Security ruled:**
  - the working folder is the runtime folder (LF-7);
  - the key file is deleted once `/health` answers (SP-5);
  - Vulkan is used for NVIDIA only (B3);
  - the list holds the two proven models (SP-7).
- **LM-17:** `isReservedAddressResolved` decides after resolving the host name, over `ownPorts` and `runtimePorts`, and the text check covers every loopback spelling.
- **Claude sign-in:** `/api/engines/<id>/signin/code` is on the engines route, so it's window-only and refused to devices. The code is checked against a pattern, at most 5 tries are allowed, and it goes only to the waiting program's stdin. The browser-address file is deleted once it's read.
- **Web search:** fetches go only to fixed hosts (`www.bing.com`, `en.wikipedia.org`), and an answer from any other site isn't read. WS-2 never offers a link into Bing or to a private or loopback host.
- **b03cd5a3:** the e2e wording follows the new text. The unit tests now refuse every address except loopback, which is stricter than before. Nothing was weakened.

## Findings

**T1 (MEDIUM, this contradicts LM-9 and LM-11): the runtime can be stopped in the middle of a reply.**
- **The idle timer is reset only by `ensure()`.** That runs once, at the start of a chat request (`app.js:2622`). Nothing resets it per model call or per streamed chunk (`git grep "\.touch("` finds only `localModelsReal.js:246`). `stop()` (`localRuntime.js`) kills the server whether a request is running or not.
- **So, on CPU:** any turn that lasts longer than the idle setting is cut off in the middle when the server is killed. The default is 10 minutes and the shortest is 5. Examples are a long reply, or a Code chat whose agent loop calls the model many times.
  - The rest of the turn then fails: the provider's address and key were taken once, at the start, and a restart would get a new port and a new key.
- **The same gap affects switching:** `runner.ensure` with another model stops the running one at once, even while a second chat is streaming on it. LM-9 says the switch waits for that reply to end.
- **The fix is small:**
  - count requests in flight around each model call in Bunny local's request path;
  - have the idle timer and a model switch wait while the count is above 0 (or re-arm the timer);
  - call `touch()` on each model call.

  Test: a stand-in turn that lasts longer than the idle time isn't killed, and a switch waits for the stream.

**T2 (LOW, this falls short of LM-18's wording): a scheduled run on a stopped runtime gets an unclear error.**
- **What it says:** the scheduled-task call (`app.js` around line 690) and the helper and cross-chat calls use the provider's `baseUrl` directly, without `ensure()`. When Bunny local is stopped, that `baseUrl` is `''`, so the request fails with a fetch error, not with LM-18's sentence ("Bunny local was stopped, so this run didn't use it.").
- **Safety isn't affected:** nothing starts.
- **The fix:** call `ensure(model, { who: 'scheduled' })` or check `running()` first, and map `local.notRunning` to the sentence.

**T3 (LOW): a helper may get another model's answers.**
- A helper or cross-chat call that names a different Bunny local model than the one running reaches the running server. That server holds one model (`-m`) and answers whatever model name is asked for.
- The fix is the same `ensure`/`running()` check as T2.

**T4 (LOW, a note for Security, who ruled SB-1): the unquoted case can run text as a command.**
- `record-browser.cmd` runs `@echo %*> "<file>"`.
- When a program calls it with the address unquoted, cmd treats each `&` in `%*` as a command separator, so each fragment after an `&` (`state=…`, `code_challenge=…`) is run as a command. SB-1's description says these are only cut off.
- The text comes from the pinned Claude Code binary, so nothing an attacker writes reaches it. A fragment could only run something if a program with that name exists on the PATH or in the account folder.
- Hardening, if Security wants it: write the address with a fixed node script, or set `NoDefaultCurrentDirectoryInExePath`.

## Verdict

- **T1 is the one item that contradicts the spec.** It's a reliability fault, not a security one: nothing more is allowed, nothing is exposed, and nothing starts that shouldn't. But it will happen to anyone who runs an agent turn on a CPU model with the default setting.
- **My recommendation:** fix T1 before the release, since it's small, with T2 and T3 if they're quick. Then I'd sign the new sha after reading the fix.
- **If the Chief of Staff and the owner ship 521abb71 as it is,** I'll sign PASS with T1 named as a known fault for the next release. That's the owner's call: the code does what the spec says everywhere except that one point.

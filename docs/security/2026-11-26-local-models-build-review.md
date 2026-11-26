# LOCAL-MODELS build review at f7971a3d (curated models), 2026-11-26

Asked by the Chief of Staff. Branch `claude/v0116-local-models` at f7971a3d; earlier shas f0c2990e, 49b6841d, e1523172, d537609a, fb35b3fd, 5e46b5af and e4644567. Read against LM-0 to LM-14, R2-1 to R2-3 and SP-1 to SP-7 (`2026-11-26-local-models-conditions.md`). Own model files (LF-1 to LF-12) are not in this build.

**Verdict: NOT YET.** The code is close. Three things stop a PASS: B1 needs a one-line fix, B2 was already known, and B3 decides whether the Vulkan build may ever be switched on. No sign-off file is written for this sha.

## What I ran

At f7971a3d, in an invented profile (`BUNNY_DATA_DIR` set to a new temp folder, `BUNNY_FAKE_UPSTREAM=1`):

```
node --test test/local-*.test.js test/canary-pins.test.js
tests 80 · pass 79 · fail 0 · skipped 1 ("a link at the target is refused": this account cannot make links)
```

The SP-6 hard-kill test passed on this PC, with the helper really built. I did not run the e2e suite or the gate.

## Blockers

### B1 (MEDIUM, must fix): the Hugging Face CDN pattern has unescaped dots (SP-4)

`src/server/localDownload.js` reads:

```
export const CDN_HOST = /^[a-z0-9-]+(.[a-z0-9-]+)*.cdn.hf.co$/;
```

Each `.` there matches any character, so the pattern accepts names that are not Hugging Face's. Checked with node:
- `attacker-cdn-hf.co`: **true**. That name is registrable under `.co`.
- `us.aws.cdn.hf.co`: true, as it should be.

SP-4 ruled `^[a-z0-9-]+(\.[a-z0-9-]+)*\.cdn\.hf\.co$`. The sha256 pin still protects the file's content. The host list is the second lock, and as written it doesn't hold.

- **Fix:** escape every dot, as ruled.
- **Test:** add `attacker-cdn-hf.co`, `xcdnxhfxco.com`, `a-cdn.hf.co` and `cdnxhf.co` to the refused list in `test/local-download.test.js`. The current refused names all happen to fail for other reasons.

### B2 (known): SP-7 chat templates are PENDING

`localModels.sources.md` says PENDING for both entries. As ruled in SP-7, I sign only when each entry has the template's text or sha256, read from the GGUF header at the pinned commit.

### B3: Vulkan without `ggml-rpc.dll` is untested. Builder E is right.

From Builder D's records on `claude/v0116-local-models-spikes`:
- `s1-qwen3-4b-norpcdll-cpu.json` is the only run without the DLL. It is the **CPU** build: it started in 4.1 s and answered a chat.
- `RESULTS.md` line 56 ("with it deleted the CPU build still started and answered") is about the CPU build only.
- `dll-vulkan.json` shows the Vulkan server **loading** `ggml-rpc.dll`. `s1-qwen3-4b-vulkan.json` logs "loaded RPC backend from …/ggml-rpc.dll". No Vulkan run without it is recorded.

**Ruling.**
- CPU without the DLL is proven, so this build may ship CPU-only.
- In this build the real set-up always picks CPU: `gpuVendor` returns null, so `chooseBackend` gives `cpu`. So B3 doesn't block a CPU-only v0.1.16.
- Before Vulkan can be chosen, which means wiring GPU detection, there must be a recorded run on this PC:
  - the Vulkan build, with `ggml-rpc.dll` absent;
  - through the Low helper with the LM-2 argv;
  - one chat answered, and the log showing the Vulkan device in use.
- If it fails, Vulkan stays off for v0.1.16. The DLL is never added to the allow list.
- That run is a download of the pinned zip and a model. It needs the owner's yes, like the spikes.

## Checked and holding

- **SP-1:** `runtimePins.json` has tag b12760, both URLs, sizes and sha256 exactly as ruled, and `signed: false`. The zip-level sha256 agrees with Builder D's `zip-manifests-b12760.json` (`zipSha256`).
- **SP-2:** I compared each allow list to Builder D's entry list for its zip.
  - Each is the zip's entries minus exactly `ggml-rpc-server.exe` and `ggml-rpc.dll`: CPU 52 − 2 = 50, Vulkan 53 − 2 = 51. No name is on both lists, and no name is on neither.
  - `classifyEntries` fails the whole unpack on an unknown entry or a folder entry before anything is written.
  - `verifyRuntime` refuses before every start if a file changed, a file is missing, or any unlisted name appears, including the two RPC files.
- **SP-3:** `checkArgv` refuses `--lora`, `--lora-scaled`, `--lora-init-without-apply`, `--rpc`, `--metrics`, `--props`, `--api-key`, `-hf*`, `--tools`, `--mcp*`, `--webui`/`--ui` and `--path`/`--media-path`. A test greps that Bunny never calls `/lora-adapters`.
- **SP-4 GitHub:** three exact hosts; https, no userinfo; at most 5 hops; every hop goes through `fetchHop` (public addresses only, never Bunny's or the runtime's port); a size cap and the sha while streaming. The Hugging Face origin is exact, and the CDN is B1.
- **SP-5:** the key file is deleted at the first 200 from `/health`, and on every failed start. The key lives in memory only (`endpoint()`), and a sweep at load and at each start removes leftovers.
- **SP-6:** the helper:
  - puts itself in a kill-on-close job;
  - starts the server with a Low (S-1-16-4096), privilege-free token, with no breakaway;
  - waits on Bunny's pid and exits when Bunny goes. The hard-kill test passed.
  - The helper exe's sha256 is checked before each use.
- **SP-7:** `localModels.json` has both entries with repo, revision, file, size, sha256, `gated: false` and `apache-2.0`, as ruled. Downloads require a 40-hex revision, `X-Linked-Size`/`X-Linked-ETag` agreement, and a streaming hash. The finished file is read-only with a manifest beside it.
- **LM-2:**
  - `--host 127.0.0.1` is forced;
  - the port is random;
  - `--api-key-file`, `--no-ui` and `--no-slots` are always passed;
  - after `/health`, a port reachable on any LAN address stops the server.
- **LM-3:** the environment is `minimalEnv` plus `HF_HUB_OFFLINE=1` and `LLAMA_CACHE` inside the models folder; there is one runtime; leftovers are killed only for `llama-server.exe` under `<data>/runtimes/`.
- **LM-0 / LM-13:**
  - every write on `/api/local-models` is on `WINDOW_ONLY_ROUTES` (server and UI) and refused by `deviceRefusal` at both levels;
  - `/api/local-models/scenario` and `/fake` answer 404 outside fake mode;
  - "Show in folder" takes no argument and checks the sender frame is Bunny's own page.
- **R2-2 / LM-17:**
  - `isRuntimeAddress` covers `127.0.0.0/8`, `0.0.0.0`, `::`, `::1`, `localhost`, `localhost.`, `*.localhost` and the mapped forms;
  - `isReservedAddressResolved` decides after DNS for the browser panel;
  - `fetchLimited` and `fetchHop` refuse the runtime port on every hop.
- **R2-3:**
  - in the chat route a device is `device`, a scheduled run (`scheduledTask`, set by the scheduler) is `scheduled`, and a `textOnly` body without `adminOk(req)` is `textOnly`. Each of those gets `local.notRunning` unless the model already runs. Only the window, or Quick ask with the admin secret, starts it;
  - Auto and Best never pick a local model;
  - no local model is offered as the judge.
- **LM-8:** with a local chat model and no judge model chosen, Smart shows a card ("Asked because Smart can't check this with a local model…").
- **Provider:** `bunny-local` is kind `managed`. `parseBaseUrl` refuses any `baseUrl` or `apiKey` in a request, so a page or device can't repoint it. The key is looked up per request and never stored.

## Lower findings (fix in this build if cheap, otherwise v0.1.17)

- **L1: the key file's owner-only ACL is not enforced.**
  - In `localRuntime.js`, `await lockKey(file)` ignores the result, and `icacls` resolves `true` when `USERNAME` is unset.
  - LM-2 says owner-only. If `icacls` fails, refuse the start ("could not protect the key file"); don't carry on.
  - The file lives only until `/health`, inside the person's own data folder, so this is LOW.
- **L2: the provider listing returns the runtime's base URL** (`managed.baseUrl()`, which holds the port) to anyone who reads `/api/providers`, devices included.
  - The port alone opens nothing: it needs the key, and every Bunny fetch path refuses it.
  - LM-4 still says the address is Bunny's business. Return `''` to a device, or always; the chat path looks it up itself.
- **L3: the allow lists unpack about 40 programs Bunny never runs** (`llama-cli.exe`, `llama-connect.exe`, `llama-tts.exe`, `llama-quantize.exe` and others).
  - Only `llama-server.exe` is ever launched, and the manifest covers them all, so this is not a hole.
  - `dll-cpu.json` and `dll-vulkan.json` show the server loading 10 to 11 files from its folder. A later release should allow only what the server loads, plus the licence files, and skip the rest.
- **L4: the trial run is still `async () => true`.**
  - When it's wired, it must go through the same path as a real start: the helper, Low, the job, `checkArgv`, the key file and the port registration.
  - I review that sha before release. The same applies to GPU detection (B3).

## What a PASS needs

1. B1 fixed, with the extra refused names in the test.
2. B2: both templates recorded in `localModels.sources.md`.
3. Either GPU detection stays unwired (CPU only), or the Vulkan run in B3 is recorded first.
4. The trial-run and Starting-spinner shas, so I can check L4.

L1 and L2 are welcome in the same sha. Then I sign `v0116-local-models` on the new sha.

## Re-review at 00963961 (fixes 56d6fded and 00963961), 2026-11-26

I read the diff from f7971a3d to 00963961, then ran in a new invented profile (`BUNNY_DATA_DIR` set to a temp folder, `BUNNY_FAKE_UPSTREAM=1`):

```
node --test test/local-*.test.js test/canary-pins.test.js
tests 89 · pass 88 · fail 0 · skipped 1 (the same link test: this account cannot make links)
```

| Item | Status |
|---|---|
| B1 CDN pattern | **Fixed.** It is now `/^[a-z0-9-]+(\.[a-z0-9-]+)*\.cdn\.hf\.co$/`, and the four look-alike names are refused in the test. |
| B2 templates | **Open.** Still waiting on the owner's yes to read the headers. |
| B3 Vulkan | **Fixed for v0.1.16.** `VULKAN_RECORDED = false`, so `chooseBackend` returns `cpu` on every PC. Vulkan is reached only when a test forces the flag. Turning it on needs the recorded run first, and my review of that sha. |
| L1 key lock | **Fixed.** A failed `icacls`, or no `USERNAME` on Windows, refuses the start with `local.keyLock` and deletes the key file. |
| L2 provider address | **Fixed.** `GET /api/providers` sends `baseUrl: ''` for `bunny-local` to everyone. |
| L4 trial | **Fixed as a security matter.** It goes through the same Low helper, job and `runtimeEnv`, and only `--version` or `--list-devices` (one argument, checked) may run. Neither takes a key, port or model, so leaving out `checkArgv` is right. The output is captured only for these two and is not logged. |
| GPU detection | **Acceptable.** `Get-CimInstance Win32_VideoController` is read-only. While Vulkan is off it only sets the card's name. |

### New: the trial's working folder is the program file itself (functional, not security; must fix)

`localHardware.js` works out the trial's working folder with `exe.replace(/[\/][^\/]+$/, '')`. That pattern only matches forward slashes, and a Windows path built with `join` has backslashes, so nothing is replaced. Checked with node on an invented path:

```
"C:\...\BunnyAI-invented\runtimes\llama.cpp\b12760-cpu\llama-server.exe" => the same text, unchanged
```

So on a real PC the helper is handed a file as its working folder, `CreateProcessAsUser` fails, and every set-up ends with "The program didn't start on this PC." It fails closed, so it isn't a security hole. The tests miss it because they pass paths with forward slashes (`${process.cwd()}/llama-server.exe`).

- **Fix:** use `path.dirname(exe)`.
- **Test:** add one with a `join`-built (backslash) path.
- `trial.devices` has the same pattern.

### Verdict at 00963961: still NOT YET

Only two things remain:
1. B2, the two template records;
2. the working-folder fix with its test.

When a sha has both, I sign `v0116-local-models` on it. Vulkan stays off until its run is recorded and reviewed.

## Re-review at 60d7ef2c (d120fbd4 plus B2), 2026-11-26

**The working folder (d120fbd4).** `createTrial` and `trial.devices` now use `path.dirname(exe)`. A new test builds the path with `join`, so it has backslashes, and it passes. Fixed.

**B2, the templates (60d7ef2c).** The owner's yes to the header reads is in the live-fixes record, 9ea63f82: "Yes, read the headers (Recommended)". The diff changes four files: `localList.js`, `localModels.json`, `localModels.sources.md`, `test/local-list.test.js`.

| Entry | Pinned commit | Length | Template sha256 |
|---|---|---|---|
| qwen3-4b | `Qwen/Qwen3-4B-GGUF@bc640142…` | 4,100 chars | `57f1fd00…d0361` |
| granite-4.1-3b | `ibm-granite/granite-4.1-3b-GGUF@ab470148…` | 6,099 chars | `fed2756d…d476` |

- Both are recorded with `status: read`, in the list and in the sources file. The "looked through" notes say: no URL, and no fixed text beyond the publisher's own tools and documents lines.
- **New checks in `checkLocalList`:**
  - a template marked read must have a 64-hex sha;
  - that sha must appear in the sources file;
  - signing still needs `status: read`.
  - The test covers all three, plus a pending entry and a wrong sha.
- **What I didn't do.** I did not read the headers again myself; that would mean another download from Hugging Face. This is acceptable:
  - each curated file is pinned by its whole-file sha256 (LM-5), which fixes the template inside it;
  - the template sha is a record for reviewers, and for LF-4's "Same chat format as" line.
  - A wrong template sha could only mislabel an own file's format; it can't change what a curated download runs.

**Tests.** `node --test test/local*.test.js` with `BUNNY_DATA_DIR` set to an invented temp folder and `BUNNY_FAKE_UPSTREAM=1`: 87 tests, 86 pass, 0 fail, 1 skipped (the link test; this account can't make links). The e2e suite and the gate were not run for this review; the gate runs before push.

**Vulkan.** `VULKAN_RECORDED = false` in `localModelsReal.js` at 60d7ef2c, so `chooseBackend` returns `cpu` always. This sign-off covers the CPU build only. Turning Vulkan on is a new sha and a new review, against the recorded run (B3 / SP-2).

### Verdict at 60d7ef2c: PASS (CPU only)

B1 to B3 and L1, L2 and L4 are settled. These are left for later, not blockers:
- L3: narrow the allow lists to the files the runner loads;
- the Vulkan run and its review;
- the own-files and folders build, LF-1 to LF-26: a separate piece, reviewed on its own sha.

## Review at 58281a46: the Vulkan run (B3), plus the start of the folder work, 2026-11-26

**Commits since 60d7ef2c:**
- b97f8ab3: the GGUF header parser;
- 03ab6472: the folder rules, and the smallest-card memory;
- 58281a46: `VULKAN_RECORDED = true`, with the run record `docs/spikes/local-models/vulkan-run-2026-11-26.md`.

### B3: the Vulkan run holds

- **Done under the owner's yes**: "Yes, test the GPU version now" (9ea63f82). It ran in an invented data folder, and everything was deleted afterwards.
- **The pinned Vulkan zip**, checked against its sha while streaming: 52 files written, with `ggml-rpc.dll` and `ggml-rpc-server.exe` absent. That matches SP-2's 51-entry allow list plus the program itself.
- **The trial and the start** both went through the real Low helper and job, with the LM-2 argv exactly as listed. The key file was deleted at `/health`.
- **The Vulkan device did real work without the DLL.** The server allocated on `Vulkan1`, the NVIDIA card, and that allocation failed at `-c 32768`. Bunny reported it in plain words. Then:
  - `-c 4096 -ngl 99` answered one chat;
  - the app's own choice (no `-ngl`) answered too.
- **The device line.** The server's own device line isn't kept at verbosity 1, so it was shown by `--list-devices` and by the allocation error instead. I accept that in place of the log line.
- **The two code changes are acceptable:**
  - `smallestCard`: Bunny counts the smallest card's memory, not the processor's 17 GB of shared memory;
  - `-ngl 99` is passed only on `fits-gpu`.
- **Not a security point, for QA.** `VULKAN_PROVEN` includes Intel, but the run used the NVIDIA card. The security question was whether the Vulkan build runs without `ggml-rpc.dll`, which doesn't depend on the card maker; that is answered. Whether a PC with only Intel graphics runs well is a working question for QA.

### BLOCKER F-1: `src/server/folderRules.js` was overwritten, and the app doesn't start

03ab6472 replaced the whole of `src/server/folderRules.js` (v0.1.15's FOLDER-RULES and ONE-INSTRUCTIONS: the instructions-file reader with FR-1 fencing and cleaning) with the new model-folder rules. Its exports were the security control for instructions files:
- `bunnyNote`, `cleanName`, `cleanText`, `collectFolderRules`, `engineBlock`, `listDir`, `systemLine`, `FENCE_*`.

They are gone, but `app.js:105` still imports them.

Evidence, at 58281a46, in an invented profile (`BUNNY_DATA_DIR` set to a temp folder, `BUNNY_FAKE_UPSTREAM=1`):

```
node -e "import('./src/server/app.js')"
APP FAILS: The requested module './folderRules.js' does not provide an export named 'bunnyNote'

node --test test/folder-rules.test.js test/one-instructions.test.js
SyntaxError: The requested module './folderRules.js' does not provide an export named 'bunnyNote'
tests 2, pass 0, fail 2

node --test test/local*.test.js
tests 90, pass 85, fail 4, skipped 1
failing: local-mcp, local-models-fake, local-models-smart, local-models (each imports app.js)
```

**Fix.**
- Restore `src/server/folderRules.js` exactly as at 60d7ef2c.
- Put the model-folder rules in a new file, for example `src/server/modelFolders.js`, and point `test/local-folder-rules.test.js` at it.
- Then run the full unit suite and the gate, not only `local*`.

The gate (O2) would have caught this. Please send the gate output with the fix sha.

### The folder rules and the header parser: not reviewed yet

They have no routes yet, so this sha doesn't expose them. I review them against LF-1 to LF-26 when the routes and the UI arrive, on their own sha.

### LF-8: LM Studio's settings, when they can't be verified

Builder E couldn't confirm LM Studio's settings file from its docs or a fresh install. What there is:
- the key `downloadsFolder` in `~\.lmstudio\settings.json` (from a public issue);
- a `~\.lmstudio-home-pointer` file (from a community plugin).

**Ruling: acceptable, read as a hint only.** Record both in `localModels.sources.md` as unverified, with their sources. Rules for reading them:
- Read only those two files, and only under `os.homedir()`. Each is read with a 1 MiB cap, never followed if it is a link, and never written.
- `settings.json` is parsed as JSON, and only the string at `downloadsFolder` is taken.
- The pointer file is read as UTF-8 text. Only its first line is taken, trimmed, and it must be an absolute path.
- Each path found is checked with LF-14 and LF-15 like any model folder:
  - the models folder is `<pointer>\models` when the pointer names LM Studio's home, or the `downloadsFolder` value itself;
  - a network path is not listed.
- Anything missing, malformed, oversized or refused falls back to the two defaults, with no error dialog.
- Tests: a pointer to a UNC path, to the data folder, to a link, a 2 MiB file, a non-JSON settings file, and a `downloadsFolder` that isn't a string.

### Verdict at 58281a46: NOT YET

- **F-1 blocks:** the app doesn't start.
- **The Vulkan part holds.** Once F-1 is fixed and the full suite and the gate pass, I sign `v0116-local-models` again on that sha, covering CPU and Vulkan.
- **The 60d7ef2c sign-off stays valid for that sha only (CPU).** A push of 58281a46 or later needs the new sign-off.

## Review of the whole build at db4ee101: F-1 fixed, plus own files and folders (LF-1 to LF-26), 2026-11-27

Asked by Builder E and the Chief of Staff. Builder E's commits since 58281a46:
- 49d055c3: `folderRules.js` restored;
- d23005c8: places and own files;
- af461762: the download folder, records, Move and Remove;
- fa344a0a: the service wiring;
- 382854f2: routes and dialogs;
- d687a111: the UI, plus the LF-8 and mapped-drive records;
- 627046e4: QA fixes, and Vulkan for NVIDIA only;
- 2297398e and db4ee101: UI and pictures.

I read these files: `localFolderRules.js`, `localPlaces.js`, `localStore.js`, `ggufHeader.js`, and the changes to `localRuntime.js`, `localDownload.js`, `localModelsReal.js`, `app.js`, `windowOnly.js`, `remoteAccess.js`, `electron/main.js`, `preload.cjs`, `quick-ask-answer.js` and `src/ui/local-places.js`.

### F-1: fixed

- `git diff --quiet 60d7ef2c db4ee101 -- src/server/folderRules.js` reports the file identical to 60d7ef2c.
- The model-folder rules now live in `localFolderRules.js`.
- `import('./src/server/app.js')` loads.

### What holds

- **Window-only (LF-1, LF-13).**
  - `/api/local-models/places*` is on `WINDOW_ONLY_ROUTES` for GET as well as writes, and on `deviceRefusal`.
  - Folders and files come only from `dialog.showOpenDialog` in the main process, through `isOwn`-checked IPC. The routes take entry ids and tokens, never a path.
  - The shared `/api/local-models` status carries no path.
  - The quick-ask change sends Bunny's own fixed words ("Starting your local model…"), never text from the answer.
- **Path rules (LF-2, LF-14, LF-15, LF-19, LF-22, LF-23).**
  - Every check runs on the real path. Anything starting with `\\` is refused, and a `Network` drive type is refused.
  - Refused: the download folder as a link; a file that is a link.
  - The never-allowed list is complete: data, install, drive root, the profile and anything containing it, system and AppData folders, `$Recycle.Bin`, `System Volume Information`, `.git`, and `isProtected`.
  - The download folder must not overlap a model folder or LM Studio's folder.
  - For the download folder only: removable drives, Downloads and Desktop (known folders and defaults) and project folders are refused.
- **The walk (LF-16, LF-25).** It goes 3 levels deep (`<folder>\a\b\file.gguf`) and at most 5,000 entries, uses `lstat`, never follows links, and lists a file two folders reach once (`dev:ino`).
- **The header parser (LF-3, LF-4).** It uses BigInt and checks every length against what is left before reading. The caps are as ruled; nested arrays, unknown value types, bad alignment, split and projector files, and unknown tensor types are refused. A tensor's end is checked against the file size. Templates are capped at 128 KiB, must be UTF-8 with no NUL, and get a sha256 each. Strings from the file are shown with `textContent`, after `cleanLabel` removes control and bidi characters.
- **The runner (LF-7, LF-9).**
  - The working folder is the runtime folder for every start.
  - `--chat-template chatml` is the only template flag ever passed, and `checkArgv` refuses any other value.
  - `--chat-template-file`, `--mmproj`, `-md` and `--slot-save-path` are now on `FORBIDDEN_FLAGS`.
  - Own files start with `-m <real path>`, and tools are off by default.
- **Records and fingerprints (LF-17, LF-18, LF-21, LF-24).**
  - Records are kept only in the data folder: `stat` with `bigint`, and dev, ino, size, mtime and ctime.
  - Any difference triggers a full re-hash against the pin before the start.
  - `.part` and final files are created with `wx`, through `link` then `rm`, and a stranger file is adopted only on a matching sha.
  - Move hashes the new copy against the pin, writes the new record, then deletes the old file only if it still matches.
  - Remove deletes only recorded files that match, and prunes only empty folders, never a tree.
  - The download folder's `Bunny models\` is on `protect` for every workspace, so `write_file` and the `make_*` tools refuse it.
  - The ctime in the record is stricter than I asked: it catches an in-place edit with the mtime set back.
- **Layout.** The revision folder under `<owner>__<repo>` (LM-5's layout) is accepted in place of LF-17's shorter one.
- **Mapped drive (LF-14).** It is not proven on this PC: no share could be made. The DriveInfo check is added and tested with an injected type. That is what LF-14 asks for when the resolve is unproven, with M-3 below.
- **Vulkan for NVIDIA only:** narrower than 58281a46; fine.

### MEDIUM: must be fixed before I sign

**M-1: the folder lock leaves other accounts' access on a `Bunny models` folder that already existed.**
- `setDownloadFolder` reuses an existing `<chosen>\Bunny models\` and runs `icacls /inheritance:r /grant:r` on it. That removes inherited entries only.
- Reproduced in the scratchpad on a throwaway folder (since deleted): I gave it `BUILTIN\Users:(OI)(CI)(M)`, then ran the exact `lockFolder` command. It still lists `BUILTIN\Users:(OI)(CI)(M)` beside the three grants.
- So the LF-17 promise fails exactly when the folder was made by someone else, or by an earlier tool. That promise is that only the person, SYSTEM and Administrators can change a model, and it is what LF-18's accepted check-then-open gap rests on.
- **Fix.** After locking, read the ACL back. Require exactly the three grants on the folder, protected from inheritance, with an owner of the person, SYSTEM or Administrators. The same must hold for anything already inside it, for example a reset of the children followed by the read-back. Otherwise refuse with the existing `perms` message.
- **Tests:** a pre-existing folder with an extra explicit ACE ends with only the three, or is refused; a child with its own ACE is reset or refused.

**M-2: LM Studio's pointer file can make Bunny open a network path, outside the profile folder.**
- `lmStudioCandidate` accepts a pointer line starting with `\\`. It then reads `<pointer>\settings.json` before any rule runs.
- Opening `\\server\share\settings.json` sends the person's Windows sign-in hash to that server: the reason LF-2 refuses network paths.
- It also breaks the LF-8 ruling: "only those two files, under `os.homedir()`".
- And `downloadsFolder` isn't required to be absolute. The sources file says it is taken as an absolute path only; the code doesn't check that.
- **Fix:**
  - the pointer line must match `^[A-Za-z]:\\`;
  - pass it through `rules.checkFolder` (real path, local drive type) before reading anything inside it;
  - require `downloadsFolder` to match `^[A-Za-z]:\\`.
- **Tests:** a pointer to `\\host\share` reads nothing there; a pointer on a Network-type drive reads nothing there; a relative `downloadsFolder` falls back to the defaults.

**M-3: the drive-type check fails open.**
- `windowsDriveType` returns `''` when PowerShell is missing, errors or times out after 15 s. `local()` then accepts the drive.
- Because the mapped-drive resolve is unproven, that check is the only thing that stops a mapped network drive.
- **Fix:** accept only `Fixed`, plus `Removable` where removable drives are allowed. Refuse anything else, `''` included, with "Bunny couldn't check this drive. Try again."
- **Tests:** an injected `''` and an injected `Unknown` are refused, for a folder and for a file.

### LOW: can come with the fix or follow in v0.1.17

- **L-a.** The "Show the template" view is cut to 4,000 characters with no notice (`cleanLabel(..., 4000)`), while a template may be up to 128 KiB. Show the whole text (it is capped already), or say "Showing the first 4,000 of N characters". Hidden text after the cut is what the view exists to reveal.
- **L-b.** `formatOf` compares only the default template with the curated shas. A file with a known default template plus an unknown named variant (for example `tool_use`, which the runner may use once tools are on) is labelled "Same chat format as". Say "Unknown chat format" unless every template sha is known.
- **L-c.** `projectFolders` holds only the folders chosen in this launch (`chosenFolders`). Folders of earlier chats and the folder-trust list aren't counted, so LF-23's choose-time check is weaker after a restart. The write-tool protection covers the main risk. Add saved session folders and trusted folders.
- **L-d.** `finalize` falls back to `rename` where hard links fail, and `rename` replaces a file created in the gap. Use a copy with `wx` instead, or re-check right before. This is inside the locked folder.
- **L-e.** `.part.json` is written with `writeFile`, which follows a link. Use `wx`, or `lstat` first. This is inside the locked folder.

### Tests

`npm test` at db4ee101, with `BUNNY_DATA_DIR` set to an invented temp folder and `BUNNY_FAKE_UPSTREAM=1`:

| Batch | Tests | Pass | Fail | Skipped |
|---|---|---|---|---|
| Parallel | 2,115 | 2,082 | 16 | 13 |
| Serial | 232 | 232 | 0 | 0 |

- **15 of the 16 failures** are the Office-file tests (OM-4 to OM-7, items 1 to 8, the three `make_*` checks). They fail on "Cannot find package 'docx'" and "'write-excel-file'": this worktree's `node_modules` doesn't have those packages. `package.json` lists them, and this build doesn't change `package.json`. That is my environment, not the build; Builder E's run had them passing.
- **The 16th** is WA-2, the known web-search failure, fixed in tests at b03cd5a3.
- I didn't run the e2e suite or the gate. The Chief runs the gate on the integration branch.

### Verdict at db4ee101: NOT YET

- **F-1 is fixed, B3 holds, and LF-1 to LF-26 are built as ruled**, except M-1 to M-3.
- **M-1 to M-3 block the sign-off.** Each is a small change with its tests.
- **On the fix sha**, I sign `v0116-local-models` for CPU, Vulkan (NVIDIA), own files and folders.

## Re-review at 612f2a3f: M-1 to M-3, L-a and L-b, 2026-11-27

One commit since db4ee101, touching six files: `localFolderRules.js`, `localPlaces.js`, `localStore.js`, and three test files.

- **M-1: fixed.**
  - After `icacls`, `lockFolder` runs `aclAllowed`: one PowerShell call, with the folder passed in an environment variable, not in the script text.
  - It requires, for the folder and everything inside it:
    - only the person's SID, SYSTEM and Administrators in the access rules;
    - an owner among those three;
    - the folder itself protected from inheritance.
  - Anything else, a script error, a timeout or no PowerShell all count as refused.
  - The new test uses real `icacls` on a temp folder. An extra explicit `BUILTIN\Users` entry and a child with its own entry are both refused, and it passed here.
- **M-2: fixed.**
  - The pointer line must start with a drive letter and pass `rules.checkFolder` before `settings.json` inside it is read.
  - A `\\` pointer is never opened.
  - `downloadsFolder` must be an absolute local path. A `\\` value only gives the network message, and a relative, `~` or `/` value falls back to the defaults.
- **M-3: fixed.** `local()` accepts only `Fixed` and `Removable`. Anything else (`''`, Unknown, CDRom, Ram, NoRootDirectory) is refused with "Bunny couldn't check this drive. Try again." This is tested for a folder and for a file.
- **L-a: fixed.** The template view shows every template whole, named variants under a header line. Control and bidi characters are removed, and it is shown with `textContent`.
- **L-b: fixed.** The format is "known" only when every template in the file (the default and each named variant) is a recorded one from the same entry.
- **Still open for v0.1.17:** L-c, L-d and L-e.

**Tests.** At 612f2a3f, with `BUNNY_DATA_DIR` set to an invented temp folder and `BUNNY_FAKE_UPSTREAM=1`:
- `import('./src/server/app.js')` loads;
- `node --test test/local*.test.js test/folder-rules.test.js test/one-instructions.test.js test/window-only.test.js test/guard-providers.test.js`: 190 tests, 189 pass, 0 fail, 1 skipped (the link test).

The full unit suite at db4ee101 is in the section above. This commit changes only the local-models files. I didn't run the e2e suite or the gate; the Chief runs the gate on the integration branch.

### Verdict at 612f2a3f: PASS

It covers the CPU build, Vulkan on NVIDIA, own files, model folders, LM Studio's folder and the download folder, against LM-0 to LM-14, R2-1 to R2-3, SP-1 to SP-7 and LF-1 to LF-26.

Left for later:
- L3 (narrowing the allow lists) and L-c to L-e, for v0.1.17;
- the mapped-drive resolve, to be confirmed on a PC with a share. The drive-type check covers it until then;
- whether Intel graphics runs well, for QA.

## Re-check at 74d40382: QA's F1 (the places read goes through the bridge), 2026-11-27

One commit on top of 612f2a3f. It touches `electron/main.js`, `src/ui/api.js`, `src/ui/local-models.js`, `src/ui/local-places.js`, `src/server/localPlaces.js`, and tests.

- **`secure:write` (`main.js:313`).** A GET or HEAD is now sent with no body; everything else is unchanged.
  - The `isOwn` sender check and `isWindowOnlyRoute(method, path, body)` still run first.
  - So the bridge reaches only the window-only GET routes: `/api/local-models/places*` and `/api/remote/log`. It is still only for Bunny's own page.
  - Nothing new is reachable, and the paths still reach only the window.
- **`sendJSON` (`api.js`).** The same rule applies: no body on a GET or HEAD. The places card now reads with `sendJSON(..., 'GET')`, so in the desktop app the read goes through the main process. Over plain HTTP it is still refused by the window-only lock. The new test checks both sides with `folderPickerOnly: true`.
- **`removeModelFolder('lmstudio')`** now also drops the files added from LM Studio's folder. That matches the other folders, and it only removes Bunny's entries (LF-7).
- **The Move card's "Leave them" and the set-up card's removal lines** are display-only.

**Tests.** At 74d40382, with `BUNNY_DATA_DIR` set to an invented temp folder and `BUNNY_FAKE_UPSTREAM=1`: the app loads, and the same set as at 612f2a3f gives 192 tests, 191 pass, 0 fail, 1 skipped (the link test). I didn't run the e2e suite or the gate.

### Verdict at 74d40382: PASS

The 612f2a3f scope is unchanged.

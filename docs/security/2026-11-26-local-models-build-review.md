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

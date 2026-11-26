# LOCAL-MODELS (HIGH): Security's required conditions (LM-0 to LM-14)

Security, 2026-11-26. This is a pre-review of Researcher's report `docs/research/2026-11-26-local-models.md` at aace115b, section 5 in particular. It is reading only: nothing was downloaded or run. The plan reviewed:

- a pinned llama.cpp `llama-server`, run as a child process on 127.0.0.1 with a key file, `--no-ui` and no RPC;
- Bunny's own Hugging Face GGUF downloader, with sha256 checks, starting from a curated, non-gated list.

Tech Lead's spec and Design's drawing should follow these conditions. Each one is required unless it is marked "spike first" (prove it in the spike, then it is required) or "later". The build still needs the owner's go, and I sign the build sha.

## LM-0: who can start what

- Only the person, in Bunny's window, can download a runtime or a model, start or stop the runtime, delete either, or add a model that is not on the list.
- These routes go on `WINDOW_ONLY_ROUTES`, and on `deviceRefusal` for both device levels. An Everything device does **not** count as the window here, the same as engines.
- The AI gets **no tool** in v1 to download, choose, start or install a model or runtime. Suggesting one in words is fine.
- A device can chat with a local model that is already running, like any other provider: the request goes through Bunny, never straight to the runtime (see LM-4).

## LM-1: the runtime binary is pinned and checked every time

1. **Pin.** Pin one `bNNNN` tag and the zip asset's sha256 in Bunny's own source (a `pins.json` like the CLI engines). Never follow "latest" or a moving tag.
2. **File manifest.** At pin time, write a per-file manifest of the unpacked zip: every exe and DLL, with its sha256 and size. Unpack only the files on the manifest. A zip holding anything else is refused whole.
3. **Download and unpack.** CE-5 applies:
   - https only;
   - redirect hosts on a fixed list (github.com and its release asset host, taken from a live redirect, not guessed);
   - the address checked again on every redirect;
   - a size cap;
   - no path escapes, links or alternate data streams in the archive;
   - no elevation.
4. **Before every start**, Bunny re-hashes `llama-server.exe` and every DLL against the manifest, because the data folder can be written by anything that runs as the person. Any mismatch: no start, one sentence, and "Download again".
5. **Start command.**
   - Start by absolute path from Bunny's data folder, never through PATH or a shell.
   - The working folder is the models folder.
   - `SetDefaultDllDirectories` (or a check that the process loads DLLs only from its own folder) is **spike first**: record which DLLs the process loads.
6. **Signing.** Authenticode signing of the binaries is UNKNOWN. If they are unsigned:
   - say so on the download card;
   - record whether SmartScreen or Defender stops them (spike first).
   - A signature does not replace the sha256 pin.
7. **Backends.** v1 ships the CPU and Vulkan builds only. CUDA is "later", as its own pin. Its runtime zip (cudart) must be pinned from the same release, never fetched from NVIDIA or elsewhere.
8. **A new pin is a Security sign-off.** Before signing, I read the llama.cpp advisory list for every build since the previous pin. The pin moves only with a Bunny release.

## LM-2: what the server is started with (and never with)

**Required flags:**
- `--host 127.0.0.1` (explicit, never a default and never `0.0.0.0`);
- `--port <random free port Bunny picked>`;
- `--api-key-file <file>`;
- `--no-ui`;
- `--no-slots`;
- the model and context arguments.

**Never passed:**
- `--tools`, `--agent`, `--ui-agent`, any MCP option, `--allow-unauthenticated-tools`;
- `--rpc`, and the `rpc-server` program is never shipped or unpacked (GHSA-j8rj-fmpv-wcxw);
- `-hf`/`--hf-repo` or any download option;
- `--metrics`, `--props` (POST `/props` changes settings);
- `--lora` from anywhere other than the list.

**Endpoints (spike first, then a test).** Start the real pinned server and call every endpoint it serves without the key, then with a wrong key.
- Each must refuse, except `/health`, if that is the only one left open.
- `/props`, `/slots` and `/metrics` must refuse or not exist.
- Write the list down. If an endpoint answers without the key, it needs a flag that turns it off, or the pin is refused.

**Bound address (test).** After start, check the port is reachable on 127.0.0.1 and not on the PC's LAN address.

**The key.**
- 32 random bytes per start, in a file in the data folder that only the person's account can read (owner-only ACL).
- Deleted when the process stops.
- Never in the command line, a log, the chat, an error message or a setting.

## LM-3: the child process holds nothing of Bunny's

- **Environment:** `safeEnv` only:
  - no provider keys, sign-in tokens, `HF_TOKEN`, `BUNNY_*`, proxy credentials or `NODE_OPTIONS`;
  - `LLAMA_CACHE` points to a folder inside the models folder;
  - `HF_HUB_OFFLINE=1`.
- **Lifetime:** a Windows job object with kill-on-close, so the server dies with Bunny, crash included. Stop, quit and idle-unload end it. At most one runtime process, and Bunny never adopts one it did not start (a process already on the port is not "ours").
- **Low integrity (spike first; then required, or written into NOT_COVERED):**
  - Run the server at low integrity through the F13 helper. It only needs to read the model file and bind loopback, so it should work.
  - If it does not work, the release notes and Settings say plainly: "the model runner runs with your rights; a crafted model file could act as you".
- **The model file:** read-only to the process where possible.

## LM-4: nothing reaches the runtime except Bunny

- The device server never proxies or forwards to the runtime port. A device's chat goes through Bunny's provider code like any provider, with the same window-only and device rules.
- `read_url`, `download_file`, `browser_open` and the browser panel must not open the runtime's port.
  - `read_url` and `download_file` already refuse loopback through `fetchLimited`; add a test with the runtime's port.
  - For the browser panel, add an explicit refusal of `127.0.0.1:<runtime port>` and `localhost:<runtime port>`, with a test.
- The runtime's address and key are never sent to a model, a connector, a helper or an engine.

## LM-5: the model downloader

- **Address checks.**
  - https only, to `huggingface.co` plus the CDN host names seen in the live redirect (spike first: write them as constants, no wildcards beyond what the redirect proves).
  - Re-checked on every redirect, with public addresses only (the `fetchLimited` rules).
- **Pinned files.** The list entry pins:
  - the repo;
  - the **commit revision** (not `main`);
  - the file name;
  - the size;
  - the sha256 (the tree API's `lfs.oid`).
- **Verifying the download.**
  - Bunny hashes while streaming.
  - The download is accepted only if the hash equals the pinned sha256. For a model not on the list, the hash must equal both the tree API's `lfs.oid` and `X-Linked-ETag` at the same revision.
  - Any mismatch deletes the file.
  - A resumed `.part` file is hashed again in full at the end.
- **Files allowed.**
  - Only `.gguf` files are ever downloaded, plus a multimodal projector `.gguf` named in the list entry.
  - Nothing else from a repo: no `.py`, no tokenizer scripts, no `.bin` or `.safetensors`, no config that something would run.
- **Where it lands.**
  - The path is built by Bunny: `<data>/models/<owner>__<repo>/<file>`.
  - Each part is checked against `^[A-Za-z0-9._-]{1,128}$`, with no `..` and no path separators.
  - The final path is checked inside the models folder by real path, and links are refused (S-LINK-1 rules).
- **Space and size.**
  - A free-space check before the download.
  - A size cap per file (the list entry's size, or a cap for a model not on the list, stated on the card).
  - A failed or cancelled download leaves no half file in use.
- **No token in v1.** No Hugging Face token is read, asked for or stored. A gated repo is refused with one sentence.

## LM-6: the curated list is a trust decision

- The list lives in source and is frozen. It changes only with a release, after Security checks each entry, like F4: the repo owner is the model's publisher or a known quantiser, the files are non-gated, and the licence tag is Apache-2.0 or MIT.
- Its sources file records, per entry, what was checked and when.
- The chat template inside a GGUF is untrusted text that llama.cpp runs (Jinja). Entries on the list were checked with their templates. A model not on the list gets the warning in LM-7.

## LM-7: a model not on the list

- Only the person, in the window (LM-0), by typing a repo.
- A card shows:
  - the repo;
  - the revision;
  - the file;
  - the size;
  - the sha256;
  - the licence tag ("none" if missing);
  - the plain sentence "Not on Bunny's list. A model file can carry an attack on the program that loads it, and its chat template is run as given. Add it only from a publisher you trust."
- The main button is **"Don't add"**. Adding is the second button.
- No licence tag means one extra confirmation line.

## LM-8: a local model is a provider like any other

- Same permission modes, rules, window-only lists, device levels and tool lists as any provider. Its output is untrusted, the same as a cloud model's.
- **The Auto check (F11/F12) with a local model.**
  - The judge defaults to "this chat's own model". When that model is local, Smart mode gives **Ask**, unless the person has picked a judge model in Settings ("Model that checks Auto actions").
  - Settings says why: "a small local model is a weaker check".
  - A judge that is down follows the existing F11 rule (Ask).

## LM-9: network after the download

- The runtime must not reach the network.
- **Spike first:** capture the pinned server's traffic through a whole chat with the fake upstream (the CLI-engines capture method). Record that it opens no outbound connection: no telemetry and no model fetch.
- If it does reach out, the pin is refused, or the traffic is blocked and the block is tested.

## LM-10: deleting

- Deleting a model or the runtime uses `removeTree` with real-path checks inside its own folder, and refuses links. The process is stopped first.
- "Remove local models" also deletes the key file and the cache folder.

## LM-11: privacy wording

- Settings and the download card say:
  - chats with a local model stay on this PC;
  - downloads talk only to Hugging Face (and GitHub for the runtime);
  - what the runtime can read (LM-3 wording).
- Screenshots use an invented profile.

## LM-12: resource use is the person's choice

- Fit estimates (RAM/VRAM) are shown before a download.
- A device cannot start a download or the runtime (LM-0), so a phone cannot fill the disk or pin the CPU.

## LM-13: updates and advisories

- **Each release:** read llama.cpp's advisory list for the pinned build and newer builds. If an advisory affects the pinned build:
  - a high or critical one is a hotfix candidate, with a new pin;
  - a medium one goes to the next release.
- The pin's tag and date are recorded in the release record.

## LM-14: tests the build must carry

1. A zip with an extra file, a wrong sha256 or a path escape is refused.
2. A DLL changed after the download stops the start.
3. Started-with flags (exact argv): the required flags are present and none of the forbidden flags are.
4. **Spike first, then a test:**
   - every endpoint without the key is refused;
   - the port is not reachable on the LAN address.
5. Key file:
   - owner-only ACL;
   - deleted on stop;
   - not in argv, logs or any response.
6. The child environment has none of the listed variables.
7. Kill-on-close: killing Bunny ends the server.
8. A device (both levels) gets 403 on every download, start, stop and delete route; the window gets 200.
9. The browser panel, `read_url` and `download_file` refuse the runtime port.
10. Downloader:
    - a hash mismatch deletes the file;
    - a resumed file is hashed whole;
    - a non-`.gguf` file is refused;
    - a bad file-name part is refused;
    - a link at the target is refused;
    - a gated repo is refused;
    - a redirect to an unlisted host is refused.
11. The card for a model not on the list has "Don't add" first.
12. With a local model as the chat model and no judge picked, Smart gives Ask.

All tests use an invented profile (`BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`) and stand-in servers. The one real run of the pinned binary (LM-2 endpoints, LM-9 traffic) needs the owner's go, like the CLI-engines probe.

## Review of Tech Lead's spec rev 2 (4d311ce8, `docs/plans/LOCAL-MODELS-spec.md`), 2026-11-26

I read the spec only. The mapping table matches LM-0 to LM-14, and several items go further than I asked:
- the judge never runs on a local model;
- prompt text is never written to the logs;
- model files are made read-only after they are verified;
- the endpoint list is written into `pins.json`;
- the LAN-reach check stops the server.

Two corrections and one ruling follow.

**R2-1 (fix the text): LLAMA_CACHE.** The spec contradicts itself:
- LM-5d says "Bunny never sets `LLAMA_CACHE`";
- LM-10 sets `LLAMA_CACHE=<dataDir>/models/.cache`.

Keep LM-10, which is Sec LM-3, and change LM-5d to read "Bunny never uses `-hf`; `LLAMA_CACHE` points inside the models folder only so nothing lands elsewhere".

**R2-2 (extend LM-17): every loopback spelling.** The browser panel and `browser_open` must refuse the runtime port on **any loopback address**, decided after the host is resolved: `127.0.0.0/8`, `::1`, `0.0.0.0`, `localhost`, `localhost.`, and `[::ffff:127.0.0.1]`. Naming only `127.0.0.1`, `localhost` and `[::1]` is not enough. The refusal applies on every navigation and redirect, as the spec says. The test includes `127.0.0.2:<port>` and `0.0.0.0:<port>`.

**R2-3 (ruling on LM-14): Quick ask may start the runtime, under these conditions.** The bar runs in the main process on this PC, at the person's own shortcut, so a question typed there counts as the person starting it, the same as the window.
1. **The permission comes from the caller, not from the body.** Today a Quick-ask turn is marked by `body.textOnly === true` (`app.js:2880`), which any client can send, a device included.
   - So `ensure()` may start the runtime only when the request is `adminOk(req) && !req.bunnyRemote && !req.bunnyDevice` (the main-process admin secret, as `app.js:2535` already does for the lookup retry), or comes from the window itself.
   - A device request with `textOnly: true` must still get `local.notRunning`.
   - A test sends that device request and proves the runtime does not start.
2. **Only a question the person typed starts it.** A start from the bar comes only from a question typed there, never from a retry loop, a scheduled task or a helper.
3. **Scheduled runs and helpers.** The spec does not say whether these may start the runtime, and it must. Security accepts either answer. My recommendation is the cautious one: they get `local.notRunning` unless the runtime is already running.

## Rulings after the spikes (Builder D's records: de9c2451 and 8b390825 on `claude/v0116-local-models-spikes`, `docs/spikes/local-models/`), 2026-11-26

Read from the spike records. I also re-read these public sources myself on 2026-11-26, metadata only, with nothing downloaded:
- the GitHub release API for b12760;
- llama.cpp's published advisory list;
- the Hugging Face tree and revision APIs at both pinned commits.

### SP-1: the runtime pin is b12760

| Backend | Asset | Size | sha256 |
|---|---|---|---|
| cpu | `llama-b12760-bin-win-cpu-x64.zip` | 25,273,382 | `c82a83190be4f0506778d458db685b6ba5d1b06372b7f7083e6e76605c84cb97` |
| vulkan | `llama-b12760-bin-win-vulkan-x64.zip` | 39,145,779 | `c7764958827c03353da4d4543e6b44a99ac984fed9b098052e320b02089fb6e9` |

- **The asset address.** URL: `https://github.com/ggml-org/llama.cpp/releases/download/b12760/<asset>`. GitHub publishes the release as b12760, a pre-release, on 2026-11-26.
- **Advisories (Sec LM-1.8).** The published list holds no advisory that affects b12760:
  - the newest are GHSA-j8rj-fmpv-wcxw (RPC, up to b7991), GHSA-3p4r-fq3f-q74v (up to b8145) and GHSA-96jg-mvhq-q7q7 (patched b7824);
  - everything older is fixed long before b12760.
  - Advisories not yet published are by definition unknown, so this is re-read at each release (Sec LM-13).
- **Not signed.** All 101 exe and DLL files are NotSigned. The set-up card's "not signed by its publisher" sentence is required, and the sha256 pin plus the per-file manifest re-checked before every start are the only integrity control.

### SP-2: the RPC files stay in the zip and are never extracted

`ggml-rpc-server.exe` is in both zips, and `ggml-rpc.dll` is in the CPU zip (and in the Vulkan zip, if Builder E finds it there).

- **Per-backend lists.** The unpack rule becomes two exact name lists per backend:
  - `allow`: extracted, and hashed into the manifest;
  - `skip`: exactly `ggml-rpc-server.exe` and `ggml-rpc.dll`, left in the zip and never written to disk.
- **Anything else fails.** Any entry on neither list fails the whole unpack (unchanged).
- **Tests:**
  - neither skipped file exists in the runtime folder after set-up;
  - a start refuses if either file appears there later (the manifest check treats an unknown file in the folder as a change).
- **The Vulkan build without `ggml-rpc.dll`.** The CPU build was proven to start without it. If the Vulkan zip holds `ggml-rpc.dll`, Builder E's first real Vulkan start (owner's yes for the download, invented profile) confirms it starts without it, before the Vulkan pin ships.

### SP-3: `POST /lora-adapters` is acceptable, under conditions

It needs the key. It can only change the scale of adapters already loaded with `--lora`, and Bunny never passes `--lora` (LM-10), so there is nothing for it to change. No flag turns the endpoint off.

**Required:**
- the argv test keeps refusing `--lora` and `--lora-scaled`;
- Bunny's code never calls `/lora-adapters`, and a grep test checks it;
- the key stays the only way in (SP-5).

`GET /props` with the key is read-only and acceptable. `POST /props` is 501.

### SP-4: the host constants

**Runtime.** `github.com`, then `release-assets.githubusercontent.com` (as recorded). Also allow `objects.githubusercontent.com`, GitHub's other asset host, because the sha256 pin decides integrity and both are GitHub's own.

**Models.** `huggingface.co`, then `us.aws.cdn.hf.co` (as recorded).
- The CDN host is regional: a PC in another region may be sent to another `*.cdn.hf.co` name.
- So allow `huggingface.co` plus any host matching `^[a-z0-9-]+(\.[a-z0-9-]+)*\.cdn\.hf\.co$`. That is Hugging Face's own domain, checked again with the `fetchLimited` public-address rules at every hop.
- The pinned sha256 (with the size and `X-Linked-ETag` agreement of LM-5d) remains the integrity control.
- Nothing wider: not `*.hf.co`, not `*.amazonaws.com`.

### SP-5: the key file is deleted once `/health` answers

The spike shows the server reads the key file once, at start. So the file is deleted as soon as `/health` returns 200, not at stop, and the key stays only in the main process's memory.
- **Every start:** a new key and a new file.
- **Tests:**
  - the file is gone after a successful start;
  - a failed start deletes it too.

### SP-6: test the job object and the Low helper together, before ship

These were not run in the spikes.

**Required in the build's tests** (fake runtime, invented profile):
- the Low helper is itself assigned to the kill-on-close job, and the server it starts is a child inside that job;
- killing Bunny's process hard (a crash, not a normal exit) ends the server.

If the helper cannot be placed in the job, the job wraps the helper's child some other way. Either way the test proves "Bunny gone ⇒ server gone".

**Vulkan under Low.** It is slower (11.3 s to start, 18.2 tokens/s, against 6.4 s and 28.8 at Medium). Low stays required (Sec LM-3) for both builds, with no Medium fallback offered in v0.1.16.

### SP-7: the curated list for v0.1.16 is the two proven models

These are the only entries I have checked (Sec LM-6). I re-read both from the Hugging Face APIs at the pinned commits. Each is not gated, tagged `license:apache-2.0`, and published by the model's own organisation.

| id | repo | revision | file | size | sha256 |
|---|---|---|---|---|---|
| qwen3-4b | `Qwen/Qwen3-4B-GGUF` | `bc640142c66e1fdd12af0bd68f40445458f3869b` | `Qwen3-4B-Q4_K_M.gguf` | 2,497,280,256 | `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` |
| granite-4.1-3b | `ibm-granite/granite-4.1-3b-GGUF` | `ab4701481089b58a082ef63cc1cee738887293ff` | `granite-4.1-3b-Q4_K_M.gguf` | 2,099,501,664 | `662b0626cd58f443baea23559b469df6576a81d349649c59413b36a9fb32eb29` |

**Each entry's chat template.**
- Sec LM-6 says each entry's chat template was read, and the spikes did not record it.
- Before I sign the build, `localModels.sources.md` must carry, per entry, the template text (or its sha256 and where it was read), taken from the GGUF header at the pinned commit with a range read of the header only.

**Other models.** They are not refused on security grounds, but none has been checked. A model with tools not proven (`tools: false`, chat only) may join in a later release, once its entry is sent to me with the same five values and template, and I have checked it. The memory fit is also unmeasured for those (S-LM5 covered only these two).

## Model files Bunny didn't download: the owner's own files and LM Studio's folder (LF-1 to LF-12), 2026-11-26

Asked by the Chief of Staff (the owner's request and answer are in 28d7a432, `docs/plans/2026-11-26-v0.1.16-live-fixes.md`, last section). Scope: an "Add a model from this PC" button, and a list of LM Studio's models folder. Bunny's own pinned runner runs the file. Ollama is out of scope. Ruled from the spec and conditions above; nothing was run for this note.

The threat is the same as LM-7, with one thing missing: Bunny can't check where the file came from. Folder names such as `lmstudio-community/...` are just names. So everything rests on the checks below, the Low-integrity runner (LM-3), and the runner having no network (LM-9).

### LF-1: who can add or list (LM-0)

- Adding a file, listing LM Studio's folder, and removing an added entry are window-only. They go on `WINDOW_ONLY_ROUTES` and `deviceRefusal` for both device levels.
- The AI gets no tool that adds, lists or picks model files.
- The file is chosen in the main process with the system file dialog (`.gguf` filter). The route takes the dialog's result, or an entry id from Bunny's own LM Studio list. It never takes a free path typed into a request body.
- A device can chat with an added model once it is running, like any local model. The file's path is never sent to a device, a model, a connector, a helper or an engine; they see Bunny's label only. The path holds the Windows user name.

### LF-2: the path

Decide everything on the real path, `fs.realpathSync.native`, taken once at add:
- **The file itself must not be a link.** `lstat` it first and refuse a symbolic link, junction or other reparse point: "This file is a link. Pick the file it points to."
- **Links and junctions in the parent folders are allowed.** Bunny stores, shows and runs the real path, and every later check uses that.
- **Local drives only.** Refuse a real path that starts with `\\`. That covers UNC paths, `\\?\` and `\\.\` device paths, and mapped network drives, which resolve to `\\server\share`. The real path must match `^[A-Za-z]:\\`. Opening a network path can send the person's Windows sign-in hash to that server, and the file can change under Bunny.
- **Never inside Bunny's own folders.** Apply `isProtected`, the data folder and the install folder to the real path.
- **On every start, check again.** `lstat` and realpath again, and compare to what was stored: real path, NTFS file id (`ino`), size and mtime. If anything differs, run LF-3 again; if the template changed (LF-4), show the card again (LF-6). Never start on a mismatch with no check.
- A whole-file sha256 is not required for own files. It is slow for large files, and the change check above covers a swap.

### LF-3: header and size checks before anything starts

Bunny reads the GGUF header itself, in JavaScript, read-only, with hard limits. The runner is never started on a file that fails. Required:
- magic `GGUF`; version 2 or 3 only;
- the header is read with a byte cap (128 MiB), plus:
  - a cap on each string (1 MiB; chat templates have their own cap in LF-4);
  - a cap on each array's length (2,097,152 elements);
  - a cap on the count of keys (8,192) and of tensors (65,536);
  - every length is checked against the bytes left in the file before it is read, with no 64-bit overflow (use `BigInt` for the counts and offsets);
- `general.alignment`, if present, is a power of two of at most 1 MiB;
- every tensor:
  - has 1 to 4 dimensions;
  - has a type id the pinned runner knows;
  - starts and ends inside the file. A truncated file is refused ("the file is incomplete");
- `general.architecture` is present, matches `^[a-z0-9_.-]{1,64}$`, and is shown on the card;
- **split files** (`split.count` > 1, or a name like `-00001-of-00003.gguf`) are refused in v0.1.16: "Bunny can't run split model files yet." The runner would load sibling files that Bunny never checked;
- **vision projector files** (`mmproj-*.gguf`, `general.type` = `mmproj`, or architecture `clip`) are skipped in the list and refused when picked. Bunny never passes `--mmproj`;
- **size:** the card shows the file size beside the free memory (RAM, and the graphics card's memory for Vulkan). Above that, it says "This may not fit in memory and can make the PC slow." It warns but does not refuse, as LM-12 says.

These checks narrow the attack on the loader; they don't remove it. llama.cpp has had GGUF parsing advisories. The containment is still the Low-integrity runner with no network.

### LF-4: the chat template

The GGUF's `tokenizer.chat_template`, and every named variant `tokenizer.chat_template.<name>`, which llama.cpp uses (for example `tool_use`), are untrusted text that the runner renders. A template can't reach files or the network. It can add hidden text to every prompt, and a parser bug in it is a loader bug (contained by LF-3 and LM-3).

**Ruling: show it and ask, on the one add card (LF-6). No silent built-in fallback.** A built-in format applied to a model it doesn't fit gives broken answers, and the person can't tell why.
- Each template must be valid UTF-8 with no NUL, and at most 128 KiB. Over the cap, refuse.
- Bunny takes the sha256 of each template.
  - If it equals the template recorded for a curated entry in `localModels.sources.md` (SP-7), the card says "Same chat format as <entry>".
  - Otherwise it says "Unknown chat format", with a "Show the template" view in plain monospaced text. That view is filled with `textContent`, never `innerHTML`.
- **No template in the file.** Bunny starts with the runner's built-in `chatml` (`--chat-template chatml`) and tools off, and the card says so: "This file has no chat format; Bunny will use a plain one."
- **A template the runner fails to load.** The start fails with the runner's message. Bunny never retries on its own with another format.
- Bunny never passes `--chat-template-file` with a path outside its own models folder.

### LF-5: tools are off until the person turns them on

- An added file is **chat only** by default. Its tools were never proven (SP-7), and tool calls depend on the template.
- The person can turn on tools for that model in the window, with the line "Tools with a model Bunny hasn't checked may be called wrongly. Your permission mode still applies."
- Everything in LM-8 still applies. That includes Auto with a local model giving Ask unless a judge model is picked.

### LF-6: the add card

It is the same pattern as LM-7. It shows:
- the file name and its real folder;
- the size, and the memory line from LF-3;
- the architecture, and the quantisation type (`general.file_type`);
- the chat format line from LF-4;
- the licence as "The file says: <general.license>", or "The file names no licence";
- the sentence: "Bunny didn't download this file and can't check where it came from. A model file can carry an attack on the program that loads it, and its chat format is run as given. Add it only if you trust where you got it."

For an entry from LM Studio's list, the card begins "From LM Studio's models folder".

The main button is **"Don't add"**; adding is the second button.

Every string taken from the file or from folder names:
- is shown with `textContent`;
- has its control characters and bidi overrides removed (U+202A to U+202E, U+2066 to U+2069);
- is cut to 200 characters for names. Templates are cut only for display.

### LF-7: read in place, never written

- **Bunny reads the file where it is.** It does not copy it: copies of several GB double the disk use and gain nothing, given LF-2.
- **Bunny opens it read-only and never writes, renames, moves or deletes it, or changes its time.** It writes nothing next to it: no sidecar, cache, settings or slot file.
  - `LLAMA_CACHE` stays inside Bunny's models folder (LM-10).
  - `--slot-save-path` is never passed.
- **"Remove" from Bunny removes Bunny's entry only.** `removeTree` (LM-10) is never called with a path outside Bunny's models folder. The card says "The file stays where it is."
- **The runner runs at Low integrity (LM-3).** Windows lets a Low process read ordinary user files and stops it writing to them, so the runner can't write to the person's folders or to LM Studio's either. If the file's permissions stop the Low runner from reading it, Bunny says so and doesn't fall back to Medium.
- **The runner's working folder is Bunny's runtime folder, never the model's folder.** A model folder can hold DLLs.

### LF-8: finding LM Studio's folder

- **Read only these, under the person's own profile folder (`os.homedir()`):**
  - LM Studio's own setting for its models folder;
  - the defaults: `.lmstudio\models`, and the older `.cache\lm-studio\models`.
- **The setting.** The exact file and key, and LM Studio's home-pointer file if it uses one, are not in any record yet.
  - Builder E records them in `localModels.sources.md`, from LM Studio's documentation or a fresh install in an invented profile, never the owner's real one. I check that before signing.
  - Each file is read with a 1 MiB cap and parsed as JSON. Exactly one string value is taken. A missing, oversized or malformed file means "use the default", with no error dialog.
- **The folder found must pass LF-2** (local drive, real path, not protected). If it points to a network path, it is not listed, and the list says "LM Studio's models folder is on a network drive; Bunny only runs files from this PC."
- **The walk:**
  - at most 4 levels deep (LM Studio uses `<publisher>\<model>\<file>.gguf`);
  - at most 5,000 entries;
  - never follows a link or junction while walking (`lstat` each entry);
  - lists only `.gguf` files, minus split parts and projector files (LF-3).
  - At listing time it reads only the fixed start of each header (magic, version, architecture and template sha), with the LF-3 caps. The full checks run when the person picks an entry.
- **When it runs:** only when the person opens the screen or presses Refresh. There is no background watcher.
- **No wider search:** no other drives, no registry, no environment variables other than the profile folder, and no Ollama.
- **Bunny never touches LM Studio itself:**
  - it does not call its local server (port 1234) or its `lms` program;
  - it never runs LM Studio's bundled runtimes (`.lmstudio\extensions\backends`). Only Bunny's own pinned runner (SP-1) runs a model.

### LF-9: the runner rules are unchanged

Everything for curated models applies as written:
- LM-2 flags: `--host 127.0.0.1` and the rest;
- the api key by file, deleted after `/health` (SP-5);
- the LM-3 environment, job object and Low helper (SP-6);
- LM-4, LM-9 and R2-2.

Also:
- The model is passed as `-m <real path>` in an argument array, with no shell.
- No flag is ever taken from the file's metadata. The context size is Bunny's own choice, capped by the model's `context_length`.
- `--lora`, `--mmproj`, `-md`/`--model-draft` and `--slot-save-path` are never passed for an added file.
- At most one runtime process (LM-3), the same as for curated models.

### LF-10: privacy wording

- Settings says: "Bunny reads model files where they are and never changes them."
- Settings says that Bunny lists only LM Studio's models folder.
- The LM-11 lines apply unchanged.

### LF-11: release note

"You can now run a model file you already have, or one from LM Studio's models folder. Bunny didn't download these and can't check them, so add only files you trust. Tools are off for them until you turn them on."

### LF-12: tests the build must carry

All tests:
- use an invented profile (`BUNNY_DATA_DIR`, `BUNNY_FAKE_UPSTREAM=1`);
- point the profile folder at an invented folder (an injectable home for LF-8), never the owner's real `.lmstudio`;
- use small GGUF files the test writes itself (a header plus one tiny tensor) and a stand-in runner.

1. A valid tiny GGUF is accepted. The spawn arguments are exactly the LM-2 set plus `-m <real path>`, with none of the LF-9 never-flags, and the working folder is Bunny's runtime folder.
2. **Refused before any spawn** (assert the spawn was never called):
   - bad magic;
   - version 1 and version 4;
   - a truncated file;
   - a tensor past the end;
   - a string length past the end;
   - an array count of 2^63;
   - a key count over the cap;
   - an alignment that isn't a power of two;
   - a split file;
   - a projector file.
3. **Templates:**
   - one over 128 KiB is refused;
   - an unknown one shows "Unknown chat format", and the view escapes `<img onerror>`;
   - a known sha shows "Same chat format as";
   - no template gives `--chat-template chatml` with tools off;
   - a runner start failure is not retried.
4. **Paths:**
   - the file as a link is refused (skipped with a reason when the test machine can't make links);
   - through a junction parent, the real path is stored;
   - `\\localhost\c$\...` is refused, and so are `\\?\C:\...` and `\\.\...`;
   - a file inside the data folder is refused.
5. **The file is changed after add** (size, mtime or file id): the checks run again, and a changed template shows the card again.
6. **The folder is left untouched:** names, sizes and mtimes of the file's folder are the same before and after add, run, stop and remove, and remove leaves the file.
7. **LM Studio discovery:**
   - the setting points to a local folder: listed;
   - the setting points to a UNC path: not listed, with the message;
   - the setting is missing: the default is used;
   - the setting is malformed, or over 1 MiB: the default is used, with no crash;
   - a junction inside the folder is not followed;
   - the depth cap and the entry cap hold;
   - a folder name with a bidi override is shown cleaned.
8. **Window-only:**
   - a device at both levels is refused add, list and remove;
   - there is no AI tool for them;
   - a device can chat with a running added model;
   - the real path appears in no device response, system prompt or engine call.
9. Tools are off by default for an added model, and the per-model switch is window-only.

**Sign-off.** This is HIGH under LM-0 and LM-7. I review the build sha against LF-1 to LF-12, together with the LM and SP items and the LF-8 record.

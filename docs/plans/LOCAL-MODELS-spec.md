# LOCAL-MODELS spec: Bunny downloads Hugging Face models and runs them itself (v0.1.16)

Tech Lead, 2026-11-26. Risk **HIGH**: Bunny downloads and runs a program (llama.cpp `llama-server`) and model files. Nothing here is built before Design's drawing, Security's review of this spec and the drawing, and the owner's go on the drawing.

## The owner's words

From `docs/plans/2026-11-26-v0.1.16-live-fixes.md` (LOCAL-MODELS), typed in the Chief of Staff's chat: "also i want to run a local model downloaded form hugging face, like LM studio also". The Chief asked: "Do you want that made easy, or Bunny itself downloading models from Hugging Face and running them, with no LM Studio needed?" The owner answered: "Bunny runs models itself".

**Read for this spec:**
- Researcher's report `docs/research/2026-11-26-local-models.md` (aace115b on `claude/researcher-local-models`);
- on main bb46fc4d: `src/providers/catalog.js`, `connections.js` and `offline.js`;
- the engine install path in `src/server/engines/` (`pins.json`, `pins.js`, `unpack.js`, `process.js`, `service.js`);
- `src/server/windowOnly.js`, `electron/quick-ask-answer.js` and the Auto pick in `src/ui/chat.js`.

Nothing was run.

**Revision 2, 2026-11-26.** This revision folds in Security's required conditions LM-0 to LM-14, from `docs/security/2026-11-26-local-models-conditions.md` (3ad48113 on `claude/security-device-full`). Both documents number items "LM-n", so this spec always writes **"Sec LM-n"** for Security's items.

| Sec | Folded in where | What changed here |
|---|---|---|
| LM-0 | LM-13, LM-14, new LM-16 | Devices (an Everything device too) may only chat with a model that's **already running**, and can't start it. The AI gets no tool that downloads, chooses, starts or installs a model or runtime |
| LM-1 | LM-5a, LM-10 | The working folder is the models folder. The DLL-loading check is a spike. Unsigned binaries are named on the card. Each pin is signed by Security |
| LM-2 | LM-10 | Adds `--no-slots`. Never `--metrics`, `--props` or `--lora`. Every endpoint is probed without the key and with a wrong key. The address is checked for no LAN reach. The key file has an owner-only ACL and lives until stop |
| LM-3 | LM-10, LM-12 | `HF_HUB_OFFLINE=1`, and `LLAMA_CACHE` points inside the models folder. A job object with kill-on-close. Low integrity through the F13 helper (spike first). Bunny never adopts a process it didn't start |
| LM-4 | LM-13, new LM-17 | The device server, the browser panel, `browser_open`, `read_url` and `download_file` refuse the runtime's port |
| LM-5 | LM-5d | `.gguf` files only, a per-part name pattern, and a real-path check that refuses links |
| LM-6 | LM-5c | The list is frozen in source, with a sources file. Security checks each entry |
| LM-7 | §0 | A model not on the list is **later**. When it comes, Sec LM-7's card applies as written |
| LM-8 | LM-4 | Smart (Auto with the judge) gives **Ask** when the chat's model is local and no judge model was picked |
| LM-9 | S-LM4 | Unchanged: no outbound traffic, captured in the spike |
| LM-10 | LM-11 | Deleting uses `removeTree` with real-path checks, and also removes the key file and the cache folder |
| LM-11 | §5 | The privacy wording on the card and in Settings |
| LM-12 | LM-13 | A device can't download or start anything |
| LM-13 | LM-5a | The advisory read for each release |
| LM-14 | §8 | All twelve tests are listed there |

**Revision 3, 2026-11-26.** Security's verdict on revision 2 (0d6210f3, the end of the same file):
- **R2-1:** LM-5d now agrees with LM-10. `LLAMA_CACHE` points inside the models folder, and `-hf` is never used.
- **R2-2:** LM-17 refuses the runtime port on every loopback address, decided after the host is resolved, with tests for `127.0.0.2` and `0.0.0.0`.
- **R2-3:** LM-14 lets Quick ask start the runtime only for a typed question carrying the main-process admin secret, never on `textOnly` alone.
- **New LM-18:** scheduled runs and helpers never start the runtime.

## 0. What v0.1.16 ships, and what waits

| In v0.1.16 | Later (named so nobody builds it now) |
|---|---|
| One runtime: llama.cpp `llama-server`, one pinned `b` tag, **CPU** and **Vulkan** builds, downloaded on the person's click | CUDA, ROCm, SYCL and OpenVINO builds (227 to 426 MB; whether the cudart zip is needed is UNKNOWN) |
| A **curated list** of non-gated Apache-2.0 or MIT GGUF files, each pinned by repo, **commit**, file, size and sha256 | A model not on the list (typed repo, with Sec LM-7's card, "Don't add" first), search, gated models, Hugging Face tokens |
| One model loaded at a time, in one server process; switching model restarts the server | Router mode (`--models-dir`, several loaded at once) |
| Text chat; tools only for families that pass spike S-LM2 | Images (the `mmproj` projector files), embeddings |
| Chats in the window, chats from devices, Quick ask | Auto picking a local model; the Auto judge on a local model; Claude Code or Codex on a local model |
| Models in Bunny's data folder | "Move models folder" |

## 1. Where it plugs in: the "Bunny local" provider

**LM-1. A new catalogue entry, with no form.** `src/providers/catalog.js` gets one entry:
- `id: 'bunny-local'`, `name: 'Bunny local'`;
- tagline: "Models Bunny downloads and runs on this PC. No key, no account";
- `abilities: ['local-offline']`, plus `'tool-use'` only per model (LM-6);
- a new kind, `managed`, added to `KINDS`.

`fieldsFor` returns `[]` for it. `validateInput` refuses a `baseUrl` or `apiKey` in the input with `provider.managed`. The person never types an address or a key, and a device or a page can't point "Bunny local" somewhere else.

**LM-2. The address and key are looked up when a request is made, never stored.**
- The registry keeps no `baseUrl` and no masked key for `bunny-local`.
- Before each model request, chat calls `localRuntime.ensure(modelId)`. That resolves to `{ baseUrl: 'http://127.0.0.1:<port>/v1', apiKey }` for the running server, starting it first if it isn't running (LM-9). Only a request from the window, or a question typed in Quick ask, may start it (LM-13, LM-14, LM-18). Every other caller gets `local.notRunning` while the runtime is stopped.
- The rest of the request goes through the existing OpenAI-compatible Chat Completions path, unchanged. That path already allows plain http to loopback (`connections.js`, `parseBaseUrl` with `allowHttp`).
- The per-run key lives only in the main process's memory and in the key file of LM-10. It never goes to `secretStore`, the settings file, a log, a page or the device server.

**LM-3. The model list is what's on disk.**
- `discover` for `bunny-local` lists the curated models that are downloaded and verified (LM-5), using their display names.
- It doesn't ask a running server's `/v1/models`, so the list shows without starting anything.
- `contextLength` is the value LM-7 chose, not the model's own maximum.

**LM-4. Not in Auto, not in engines.**
- In v0.1.16, the Auto **model** pick (`state.autoPick`) never chooses a `bunny-local` model.
- The F11 judge never runs on a local model, even if one is picked as the judge in Settings; the judge-model menu doesn't offer one.
- **Smart, in the Auto permission mode (Sec LM-8):** when the chat's own model is a Bunny local model and the person hasn't picked a judge model in Settings ("Model that checks Auto actions"), every action the judge would check becomes **Ask**. Settings says: "With a local model as the chat's model, Auto asks before risky actions unless you pick a model to check them: a small local model is a weaker check." A judge that is down still follows the existing F11 rule (Ask).
- Claude Code and Codex never use one as their endpoint.
- Choosing a Bunny local model is always the person's own pick in the model menu.

That keeps the slowest, most memory-hungry provider out of every path the person didn't choose. The owner's "degrade gracefully when the network is down" item stays with the existing offline handling. Making a local model Auto's offline fallback is a later item, with its own question to the owner.

## 2. Downloads: the runtime and the models

### 2.1 The runtime

**LM-5a. Pinned like the CLI engines (CE-5).** `src/server/engines/pins.json` gets a `runtimes` block, checked by `checkPins`. It holds one entry, `llama-server`, with these fields:
- `tag`: the pinned `bNNNN`. Researcher read b12760. Security picks and signs the pin after reading the advisory list on the day of the build.
- `licence: "MIT"`, `entry: "llama-server.exe"`;
- `hosts`: the GitHub release host and its asset-redirect hosts, **taken from a live redirect in spike S-LM3, not guessed**;
- `files`: one per backend (`cpu`, `vulkan`). Each has `url`, `sha256` (from the release API's asset digest), `size`, `kind: "zip"`, and `allow`, the exact list of file names the zip may hold.

**The install rules for the runtime:**
- It's downloaded with the engines' own downloader: HTTPS only, redirects only to `hosts`, a size cap at the pinned `size`, and sha256 checked before unpacking.
- It's unpacked with `unpack.js`, which already refuses path escapes, streams, reserved names, links and archive bombs. There's one new rule: **any file not in `allow` is refused, and the whole unpack fails**.
- It's installed to `<dataDir>/runtimes/llama.cpp/<tag>-<backend>/`.
- Before **every** start, Bunny re-checks the sha256 of `llama-server.exe` and of every DLL against a manifest it wrote at install. A mismatch means Bunny won't start it. The card says "Bunny local's program changed on disk. Set it up again", and a new download is offered.
- It's **never** bundled in the installer. The release size doesn't change, and nobody gets the program without a click.
- **Signing (Sec LM-1.6):** if S-LM1 finds the binaries have no Authenticode signature, the set-up card says "This program from llama.cpp is not signed by its publisher. Bunny checks every file against a fixed fingerprint instead." A signature, if there is one, never replaces the sha256 check.
- **Pin and advisories (Sec LM-1.8, Sec LM-13):** a new pin is Security's sign-off, after reading llama.cpp's advisory list for every build since the previous pin. The pin moves only with a Bunny release. Each release record gives the pin's tag and date.
  - A high or critical advisory against the pinned build is a hotfix candidate, with a new pin.
  - A medium one goes to the next release.
- **CUDA, later (Sec LM-1.7):** it's its own pin. Its cudart zip comes from the same llama.cpp release, never from NVIDIA or anywhere else.

**LM-5b. Which backend.** The person isn't asked. Bunny decides like this:
- It downloads the Vulkan build if `app.getGPUInfo('basic')` reports a GPU whose vendor is NVIDIA, AMD or Intel, **and** spike S-LM1 passed for that vendor. Otherwise it downloads the CPU build.
- If the Vulkan build doesn't start, or lists no device (`--list-devices`, which S-LM4 confirms), Bunny downloads the CPU build once and uses that. Settings shows "Runs on: CPU (your graphics card couldn't be used)".
- Settings has one switch for this: "Use graphics card: on / off". Off downloads or uses the CPU build.
- CUDA is not in v0.1.16.

### 2.2 The models

**LM-5c. The curated list.** `src/providers/localModels.json` holds the list, checked by a test. Each entry has:
- `id` (Bunny's own short id), `name`, `repo`, `revision` (a 40-hex **commit** sha, never `main`), `file`, `size` and `sha256`;
- `licence`, which must be `apache-2.0` or `mit` (the test fails otherwise), and `gated: false`;
- `family`, `minRamGB`, and `layers`, `kvBytesPerToken` and `nativeCtx` for LM-7, all read from the GGUF header when the list is made;
- `tools` (`true` only after S-LM2 passes for that family).

**A trust decision (Sec LM-6).** The list is frozen in source and changes only with a release. Security checks each entry:
- the repo owner is the publisher or a known quantiser;
- the files are non-gated, and the licence tag is Apache-2.0 or MIT;
- the chat template was read.

A sources file beside it, `localModels.sources.md`, records per entry what was checked and when.

The v0.1.16 candidates are official-publisher repos from Researcher's section 3:
- `Qwen/Qwen3-4B-GGUF`, `ibm-granite/granite-4.1-3b-GGUF` and `mistralai/Ministral-3-3B-Instruct-2512-GGUF` for 8 GB;
- `Qwen/Qwen3-8B-GGUF`, `ibm-granite/granite-4.1-8b-GGUF` and `google/gemma-4-12B-it-qat-q4_0-gguf` (text only) for 16 GB;
- `ggml-org/gpt-oss-20b-GGUF` only if S-LM5 shows it fits a 16 GB PC.

Third-party quants (`unsloth/*`) are left out. The final list is whatever passes S-LM2 and S-LM5. The researcher's sizes and sha256 values are re-read **at the pinned commit** when the list is made.

**LM-5d. The download.**
- **URL:** Bunny's own downloader fetches `https://huggingface.co/<repo>/resolve/<revision>/<file>`. Bunny never uses `-hf`. `LLAMA_CACHE` points inside the models folder (LM-10) only so that nothing lands anywhere else (Security R2-1).
- **Hosts:** `huggingface.co` and the CDN hosts that S-LM3 records from the live redirect. Any other redirect host fails the download.
- **Integrity:** the sha256 is computed while streaming. A download is kept only if `X-Linked-Size` equals the pinned `size`, **and** `X-Linked-ETag` equals the pinned `sha256`, **and** the computed hash equals it too. If the headers differ from the pin, nothing is downloaded and the card says "This model changed on Hugging Face. Bunny will offer it again after an update." The pin is never followed to a new value.
- **Resume:** the file is written as `<file>.part` with a small sidecar holding the bytes done, and resumes with `Range`. Restarting the app resumes, and a resume re-hashes the bytes already on disk first. Cancel deletes the `.part` file.
- **One at a time:** one download runs at a time. Rate limits (429) wait for `RateLimit-Reset` and then retry, at most 3 times.
- **Free space:** before the download, Bunny checks there's at least `size + 2 GB` free on the data folder's drive. If not, it says so and starts nothing.
- **Files allowed (Sec LM-5):** only `.gguf` files are ever downloaded: the entry's `file`, plus a projector `.gguf` only if the entry names one (none in v0.1.16). No `.py`, tokenizer script, `.bin`, `.safetensors` or config file is ever fetched.
- **Addresses (Sec LM-5):** each redirect is checked again with the `fetchLimited` rules: https, public addresses only, and the host on the constant list from S-LM3, with no wildcard wider than the recorded redirect proves.
- **Where:** `<dataDir>/models/<owner>__<repo>/<revision>/<file>`. Bunny builds the path itself:
  - every part must match `^[A-Za-z0-9._-]{1,128}$`, with no `..` and no separator;
  - the final path is checked inside the models folder by **real path**;
  - a link at any level is refused (the S-LINK-1 rules).

  Bunny writes a manifest beside the file (sha256, size, the time it was verified). The file is made read-only after verification, so the runtime process reads it but doesn't write it.
- **Cap:** the size cap per file is the entry's `size`.
- **Gated repos:** a gated repo is refused with one sentence. No Hugging Face token is read, asked for or stored.
- **Delete (Sec LM-10):** the server is stopped first if that model is loaded. Then the model's folder is removed with `removeTree`, with real-path checks inside the models folder, links refused. The manifest goes with it.
- **The data folder stays protected:** `<dataDir>/models` and `<dataDir>/runtimes` are inside the data folder, which every workspace write and engine copy already refuses (`protect: [dataDir]`). Nothing changes there, and a test proves `write_file` refuses both folders.

## 3. The fit check: RAM and VRAM

**LM-7. Bunny's estimate, shown before the download and before each start.**
- **The need:** `need = size + kvBytesPerToken × ctx + 1.5 GB`.
- **RAM:** `os.totalmem()` and `os.freemem()`.
- **VRAM:** read from llama-server's `--list-devices` on the installed Vulkan build. S-LM4 proves the output and its free-memory column. Without that, VRAM is "unknown" and the estimate uses RAM only.

**The four results:**

| Result | When (`avail` = free RAM, plus free VRAM when the Vulkan build is in use) | What the card says |
|---|---|---|
| **Fits** | `need ≤ 0.75 × avail` | "Fits on this PC" (with a GPU: "Runs on your graphics card") |
| **Tight** | `need ≤ 0.95 × avail` | "Fits, but close other apps first" |
| **Slow** | it fits in RAM only, while a GPU is in use | "Partly on your graphics card: slower" |
| **Too big** | anything else | "Too big for this PC". The Download button is disabled, with no override in v0.1.16 |

**The context length (`ctx`) Bunny chooses:**
- 32768 if the model still fits with it, else 16384, else 8192.
- It's never above `nativeCtx`, and it's passed as `-c`.
- llama-server's own `-fit`, which is on by default, stays on as the second guard.

**Tools need room.** A chat with tools needs `ctx ≥ 16384`. Below that, the model is chat-only for this PC, and the menu says why: "Not enough memory for tools on this PC".

The estimate is Bunny's promise, so S-LM5 measures the real numbers. The fixed overhead and the 0.75 and 0.95 factors are changed from those measurements, not guessed again.

## 4. Starting, stopping, idle unload, quit

**LM-9. Start on demand.**
- **Single-flight:** `ensure(modelId)` starts the server if it isn't running or holds a different model. Two chats asking at once share one start.
- **The status line:** the chat shows "Starting Qwen3 4B… (first message after a start takes longer)".
- **Health:** Bunny waits for `GET /health` to return 200, for up to 120 s. On a timeout, or when the process exits, it reads the last stderr lines and maps them to plain words: out of memory, the model file failed to load, the GPU couldn't be used. It never shows raw stderr in the chat.
- **Switching models:** another model stops the running one first. If a reply is streaming on the old model, the switch waits for that reply to end.

**LM-10. The exact command line.** A test pins the exact argv:

```
<runtime>\llama-server.exe -m <model file> --host 127.0.0.1 --port <port> --api-key-file <keyfile>
  --no-ui --no-slots -c <ctx> --jinja --log-verbosity <S-LM4 value> [-ngl auto/fit defaults; CPU build: none]
```

**What the run must and must not have:**
- **Never on the command line:** `-hf`/`--hf-repo` or any download option, `--tools`, `--agent`, `--ui-agent`, any MCP flag, `--allow-unauthenticated-tools`, `--rpc` or anything RPC, `--metrics`, `--props`, `--lora`, `--host` other than 127.0.0.1, `--models-dir`.
- **Endpoints (Sec LM-2, S-LM4, then a test).** Every endpoint the pinned server serves is called without the key and with a wrong key. Each must refuse; only `/health` may stay open, and only if it's the one left. `/props`, `/slots` and `/metrics` must refuse or not exist. The list is written into `pins.json` `canaries`. An endpoint that answers without the key needs a flag that turns it off, or the pin is refused.
- **Address (Sec LM-2):** after the start, Bunny checks the port answers on 127.0.0.1 and **not** on the PC's LAN address. If it answers on the LAN address, the server is stopped at once.
- **Never shipped or run:** `rpc-server.exe`. It isn't in `allow`, so it's never unpacked.
- **The port:** a free loopback port Bunny picks at random. If the bind fails, Bunny tries again with a new port, at most 3 times.
- **The key (Sec LM-2):**
  - 32 random bytes, hex, new for every start.
  - The key file is `<dataDir>/runtimes/run/<runId>.key`, written before the start with an **owner-only ACL**.
  - It's deleted when the process stops (stop, idle, quit). The next start deletes any left over.
  - It's never in the argv, a log, the chat, an error message, a setting or an API response.
- **The process (Sec LM-1.5, Sec LM-3):** it starts the way the engines start it (`process.js`):
  - by absolute path from the data folder, never through PATH or a shell, and hidden;
  - with `cwd` set to the **models folder**;
  - with stdin closed, and stdout and stderr read by Bunny.
- **Environment:** `safeEnv` only. It holds no provider keys, sign-in tokens, `HF_TOKEN`, `BUNNY_*`, proxy credentials or `NODE_OPTIONS`. Bunny sets two variables and no others: `HF_HUB_OFFLINE=1`, and `LLAMA_CACHE=<dataDir>/models/.cache`.
- **A job object with kill-on-close.** Bunny assigns the process at start, so the server dies with Bunny, crash included.
  - How: a small native helper or the F13 helper; Builder picks one.
  - At most one runtime process.
  - Bunny never adopts a process it didn't start: a process already on the port isn't "ours".
- **Low integrity (Sec LM-3, spike first):** the server runs at low integrity through the F13 helper, since it only reads the model file and binds loopback. S-LM1 proves it.
  - If it works, it's required.
  - If not, it goes into NOT_COVERED, and the release notes and the card say: "The model runner runs with your rights; a crafted model file could act as you."
- **DLLs (Sec LM-1.5, spike first):** S-LM1 records which DLLs the process loads. If any loads from outside the runtime folder, other than Windows system DLLs, Builder adds `SetDefaultDllDirectories` through the helper, or the start is refused.
- **The logs:** what's kept goes to `<dataDir>/logs/local-model.log` (rotated, 1 MB). It holds start and stop lines and errors only, **never prompt or reply text**. S-LM4 chooses the verbosity that guarantees that.

**LM-11. Stop and idle unload.**
- **Idle stop:** Bunny stops the server after N minutes with no request. N is set in Settings: 5, **10 (default)**, 30 or 60 minutes, or "Only when Bunny closes".
- **How it stops:** `killTree` (`taskkill /T /F`), the same as the engines. Bunny owns the process, so a stop is certain, and llama-server's `--sleep-idle-seconds` isn't used.
- **Stop now:** Settings has a **Stop now** button, and the status shows "Running Qwen3 4B, using about 3.1 GB".
- **During a reply:** a stop waits for a streaming reply to end, or the person cancels the reply.

**LM-12. Quit, crash, sleep.**
- **On app quit:** Bunny kills the tree, and the existing `killStragglers` list includes the server's pid.
- **After a crash of Bunny:** the job object ends the server with Bunny (Sec LM-3). As a belt, on the next start `clear-old-workers.js` kills any `llama-server.exe` whose image path is under `<dataDir>/runtimes/`, and only those, and deletes any key file left in `runtimes/run/`.
- **Remove Bunny local (Sec LM-10)** also deletes `runtimes/run/` and the `LLAMA_CACHE` folder.
- **After sleep or resume:** the first request checks `/health`. If the server doesn't answer, Bunny restarts it once and then says so.

## 5. Settings and chat: the touch points for Design

Design draws today beside proposed, both themes, phone and desktop (O3). The screens:
1. **Settings → Providers → Bunny local card**, at the top of the local group, beside Ollama. It has three states:
   - **Not set up:** "Set up Bunny local (downloads a 39 MB program from llama.cpp's GitHub releases)", with one button. The size and source come from the pin.
   - **Ready:** the backend in use ("Runs on: graphics card / CPU"), the "Use graphics card" switch, the "Stop after idle" choice, and **Remove Bunny local**, which deletes the runtime and, after a second confirmation that names the total size, every model.
   - **Running:** the model, the memory in use and **Stop now**.
2. **The model list inside the card:** a row per curated model. Each row shows:
   - the name, file size, licence and publisher;
   - the fit badge (LM-7), and "Uses tools" or "Chat only";
   - Download, progress (speed, time left, Pause, Cancel), Ready, or Delete.

   Too big rows are shown, greyed out, with the reason.
3. **The model menu in chat:** a "Bunny local" group listing downloaded models only, and a "Get more…" item that opens the card. A chat-only model shows a one-line note in the composer: "This model answers only; it can't use tools."
4. **The chat status line** while starting (LM-9), and the plain errors from LM-9: "Not enough memory to load Qwen3 8B. Close other apps or choose a smaller model."
5. **Quick ask:** the bar uses the same status text, "Starting your local model…", when its model is Bunny local.
6. **The phone layout:** devices see the model menu and status line only. There's no set-up, download, delete, switch or stop on a phone (LM-13). If the runtime isn't running, a device's message gets: "Bunny local is stopped. Start it from Bunny's window on your PC."
7. **The privacy wording (Sec LM-11),** on the set-up card and in the Bunny local section of Settings:
   - "Chats with a local model stay on this PC."
   - "Downloads talk only to Hugging Face, and to GitHub for the program."
   - The low-integrity sentence of LM-10, or its NOT_COVERED version.
8. **The unsigned-program sentence** (LM-5a), if S-LM1 finds no signature.
9. **The Auto settings line** of LM-4, and a judge-model menu that has no local models in it.

Help text and pictures ship with the screen (O7), in a README section "Run models on this PC", with invented-profile pictures only.

## 6. Devices, Quick ask, permissions

**LM-13. Devices (Sec LM-0, Sec LM-4, Sec LM-12).**
- **What a device may do:** a chat on a device, at **both** device levels, may use a Bunny local model **only while the runtime is already running with that model**. A device's request **never starts** the runtime or switches its model. An Everything device doesn't count as the window here, the same as for engines.
  - If the runtime is stopped or holds another model, `ensure()` called for a device request fails with `local.notRunning`, and the device shows the sentence of §5 screen 6.
  - A device's request does reset the idle timer.
- **What only the window may do:** set up the runtime, download, pause, cancel, delete, Remove Bunny local, start, the graphics-card switch, the idle setting and Stop now. These routes go in `WINDOW_ONLY_ROUTES` (`^/api/local-models(/.*)?$` writes) and in `deviceRefusal` for both levels, the same belt as the engines (CE-6).
- **Starting from the window counts as the person starting it.** That covers the first message in a window chat, and choosing the model in the window's menu.
- **What's never exposed:** the server's port and key, to devices or to any page. The device server never proxies or forwards to the runtime port. Device requests go through Bunny's provider code, which calls `ensure()` in the main process.

**LM-14. Quick ask.** Quick ask may use a Bunny local model when it's the person's chosen model. The bar is Bunny's own window-side process on this PC (Electron main, not the device server), so a question the person types there may start the runtime like a window chat. Security ruled on this in R2-3 and allowed it, under these conditions:
- **The caller decides, never the body.** `body.textOnly === true` (`app.js:2880`) marks a Quick ask turn, but any client can send it, a device included. So the bar's request may start the runtime only when `adminOk(req) && !req.bunnyRemote && !req.bunnyDevice`: the main-process admin secret, the same check `app.js:2535` makes for the lookup retry. Otherwise it must come from the window itself. `textOnly` alone never starts anything.
- **A device sending `textOnly: true`** gets `local.notRunning`, and the runtime doesn't start. A test proves it.
- **Only a typed question starts it.** The bar's own retry (`lookupFirst` or `pcLookupFirst`) never starts the runtime. It follows a question that already did, and if the runtime has stopped in between, the retry gets `local.notRunning`.

Its rules don't change: text only, no tools, and the card for a real local action. The 120 s start wait (LM-9) shows in the bar. A failure maps to the existing kinds: `none` when nothing is downloaded, otherwise the plain LM-9 reason.

**LM-15. Same rules as any provider (Sec LM-8).** The model gets exactly the tools, modes, rules, window-only lists and device levels any other provider gets, judged the same way, and its output is just as untrusted. "Local" isn't a trust level, so nothing is allowed more because the model is on the PC. The one difference is LM-4's Ask in Smart.

**LM-16. No model tools for the AI (Sec LM-0).** In v0.1.16, no model of any provider gets a tool that downloads, chooses, starts, stops or installs a local model or the runtime. A test proves that no tool name or schema reaches `/api/local-models`. Suggesting one in words ("You could download Qwen3 4B in Settings") is fine.

**LM-17. Nothing reaches the runtime except Bunny (Sec LM-4).**
- `read_url` and `download_file` already refuse loopback through `fetchLimited`. A test adds the runtime's live port.
- `browser_open` and the browser panel refuse the runtime port on **any loopback address** (Security R2-2).
  - **What counts as loopback:** `127.0.0.0/8`, `::1`, `0.0.0.0`, `localhost`, `localhost.`, and `[::ffff:127.0.0.1]` (any IPv4-mapped loopback address).
  - **When it's decided:** after the host name is resolved, never by matching the text of the address.
  - **How often:** on every navigation and every redirect, not only for the first address.
  - **Tests:** `127.0.0.1`, `127.0.0.2`, `0.0.0.0`, `localhost.`, `[::1]` and `[::ffff:127.0.0.1]`, each at `:<runtime port>`, are all refused. A host name that resolves to loopback is refused too.
- The runtime's address and key are never sent to a model, a connector, a helper or an engine.

**LM-18. Scheduled runs and helpers (Security R2-3.3; Security's recommendation, the cautious answer).** A scheduled run, a helper agent, a hook, an automation, or any turn the person didn't type in the window or Quick ask **never starts** the runtime.
- If the runtime is already running with the model they ask for, they may use it. Their requests reset the idle timer.
- Otherwise they get `local.notRunning`. A scheduled run reports it in its result: "Bunny local was stopped, so this run didn't use it."
- **Tests:** a scheduled run and a helper each get `local.notRunning` while the runtime is stopped, and nothing starts. Each may use the runtime while it's running.

## 7. Spikes before build (each one recorded in `pins.json` `canaries`, the way OI-1 was)

These need the owner's yes to download, asked the way Builder A's Claude Code download was asked:
- the pinned zips, about 25 MB (CPU) and 39 MB (Vulkan);
- one 8 GB-class model, about 2.1 to 2.5 GB;
- the 16 GB-class ones, if S-LM5 runs them.

Everything runs in an invented profile (`BUNNY_DATA_DIR` set to a temp folder), and everything is deleted afterwards.

| Spike | What it proves | Pass |
|---|---|---|
| **S-LM1: Vulkan on this PC**, and the CPU build | That the pinned Vulkan build starts with the exact LM-10 argv, lists the GPU and answers a chat. Also:<br>• tokens per second, GPU vs CPU;<br>• whether Windows shows a firewall prompt on the 127.0.0.1 bind;<br>• whether Defender or SmartScreen flags the unpacked files;<br>• Authenticode signing;<br>• **which DLLs load and from where**;<br>• whether the build runs at **low integrity** through the F13 helper and **inside a kill-on-close job object** | Both builds answer. Vulkan is enabled for the vendors it was proven on: this PC's vendor, and others only when someone runs it there |
| **S-LM2: tool calling per family** | For each candidate family (Qwen3, Granite 4.1, Ministral 3, Gemma 4, GPT-OSS), a two-tool round trip through Bunny's own tool loop with `--jinja`, recording the native vs Generic handler and whether the arguments are valid JSON in 5 runs of 5 | 5 of 5 gives `tools: true`. Anything less gives chat only |
| **S-LM3: Hugging Face and GitHub hosts** | The live redirect hosts for a revision-pinned resolve URL and a release asset. That `X-Linked-ETag` equals the sha256 on the pinned commit. That `Range` resume works across a restart | The host lists filled in from the recorded redirects, and a resumed file's hash matches |
| **S-LM4: the server's own surface** | • That the server sends no outbound traffic through a whole chat, captured with fake-upstream and the CLI-engines method, with no system change (Sec LM-9).<br>• That the chosen verbosity logs no prompt text.<br>• **Every endpoint**, called without the key and with a wrong key, under the LM-10 argv (`--no-slots` included), and the list written down (Sec LM-2).<br>• The port is not reachable on the LAN address.<br>• The `--list-devices` output format | No outbound traffic, no prompt text, every endpoint other than `/health` refuses, no LAN reach. Otherwise the pin is refused, or Security names the flag that fixes it |
| **S-LM5: memory** | Real memory at 8k, 16k and 32k for each listed model on this PC, compared with LM-7's estimate | The estimate is within 15 percent, or the formula is changed to match |

**Nothing ships while a spike is open.** A spike that fails takes its piece out of v0.1.16: Vulkan, tools for that family, or that model.

## 8. Tests

**Unit tests**, in a fake profile:
- **The catalogue:** the `bunny-local` entry and `fieldsFor` returning `[]`. `validateInput` refuses a `baseUrl` or `apiKey`.
- **The lists:** `checkPins` over the `runtimes` block, and `localModels.json`. The test fails on: a licence other than apache-2.0 or mit, `gated` set, a `revision` that isn't 40 hex, a missing `sha256`, or `tools: true` without a recorded S-LM2 result.
- **The downloader** (with a fake fetch). It:
  - resumes with `Range` and re-hashes on resume;
  - fails on a sha256 mismatch, a size mismatch, header and pin disagreeing, or a redirect to a host off the list;
  - deletes `.part` on Cancel;
  - refuses to start without free space;
  - retries on 429 at most 3 times.
- **Unpacking:** a file not in `allow` fails the whole unpack, and nothing is left behind.
- **The start check:** a changed DLL or exe after install means no start.
- **The argv:** exactly as in LM-10. No forbidden flag in any path, and `rpc-server.exe` is never unpacked.
- **Single-flight start**, the idle timer (it fires at N and is reset by each request), a stop waiting for the stream, and quit killing the tree. After a crash, only processes under `<dataDir>/runtimes/` are killed.
- **The key:** it's never in the settings file, the secret store, a log or any API response (one test greps all four).
- **The fit table:** the four results from fixed RAM and VRAM inputs, the `ctx` choice, and tools turned off below 16k.
- **Auto:** its pick never returns `bunny-local`.
- **Window-only routes:** every `/api/local-models` write is refused from a device and from plain HTTP in the desktop app. A device chat can use an installed model.

**The fake runtime** (`BUNNY_FAKE_LOCAL=1`, beside `BUNNY_FAKE_UPSTREAM`) is a node script standing in for `llama-server.exe`, like `fake-engine.mjs`. It checks the argv and the key, answers `/health` and a streamed `/v1/chat/completions`, and can be made to fail (out of memory, a slow start, exiting at once). There's also a fake 1 MB model with a pinned hash.

**End-to-end**, in an invented profile:
- set up the runtime, download a model (progress, pause, resume), chat, and see the idle stop;
- Stop now, delete, and a Too big row;
- Quick ask with the local model;
- a phone-width device refused set-up and download, yet able to chat;
- both themes, phone and desktop (O8).

**Sec LM-14, test by test** (each one required, and named in the build's test list):
1. A zip with an extra file, a wrong sha256 or a path escape is refused.
2. A DLL changed after the download stops the start.
3. The exact argv (LM-10): the required flags are present, `--no-slots` included, and no forbidden one appears.
4. Every endpoint refuses without the key, using the list from S-LM4, replayed against the fake runtime with that list, and the port isn't reachable on the LAN address.
5. The key file has an owner-only ACL, is deleted on stop, and isn't in the argv, logs or any response.
6. The child's environment has none of the listed variables, and has `HF_HUB_OFFLINE=1` and `LLAMA_CACHE` inside the models folder.
7. Kill-on-close: killing Bunny's process ends the (fake) server.
8. A device, at both levels, gets 403 on every set-up, download, start, stop and delete route; the window gets 200. A device chat while the runtime is stopped gets `local.notRunning` and doesn't start it.
9. The browser panel, `browser_open`, `read_url` and `download_file` refuse the runtime port on every loopback spelling of LM-17, `127.0.0.2:<port>` and `0.0.0.0:<port>` included, decided after resolution (R2-2).
10. The downloader:
    - a hash mismatch deletes the file;
    - a resumed file is hashed whole;
    - a non-`.gguf` file is refused;
    - a bad name part is refused;
    - a link at the target is refused;
    - a gated repo is refused;
    - a redirect to an unlisted host is refused.
11. "Don't add" first on the card for a model not on the list: **later**, with that feature; no test in v0.1.16.
12. With a local model as the chat's model and no judge picked, Smart gives Ask. The judge-model menu lists no local model.

LM-16's test also goes in: no model tool reaches `/api/local-models`.

**R2-3 and LM-18 tests:**
- A Quick ask request with the admin secret (`adminOk`, not remote, not a device) starts the stopped runtime.
- A device request with `textOnly: true`, and a plain-HTTP request with `textOnly: true` but no admin secret, each get `local.notRunning`, and nothing starts.
- The bar's `lookupFirst` retry never starts the runtime.
- Scheduled runs and helpers get `local.notRunning` while the runtime is stopped.

**The gate** (`node scripts/gate.mjs`) runs all of these. No real model or runtime is ever downloaded by the gate.

## 9. For Security's review

These are the points to check against Researcher's section 5:
- **LM-5a:** the pin, the exact-file allowlist, and the re-hash before every start.
- **LM-5c and LM-5d:** pinned by commit, three-way hash agreement, and hosts from a recorded redirect.
- **LM-10:** loopback only, the per-run key by file, `--no-ui`, no tools, RPC or MCP flags, `safeEnv`, and no prompt text in logs.
- **LM-12:** a leftover process is killed by path, and its key is useless.
- **LM-13:** window-only management, and no proxying from devices.
- **LM-4:** not in Auto, the judge or engines.
- **LM-15:** "local" isn't a trust level.

**The three open questions of revision 1, answered from Security's conditions:**
1. **A job object or restricted token for the child?** Both. A **kill-on-close job object is required** (Sec LM-3, now in LM-10). **Low integrity** through the F13 helper is required if S-LM1 shows it works. If it doesn't, it's written into NOT_COVERED with the plain sentence on the card and in the release notes.
2. **An endpoint that works without the key?** It needs a flag that turns it off, or **the pin is refused** (Sec LM-2). Only `/health` may answer without the key. `/props`, `/slots` and `/metrics` must refuse or not exist, hence `--no-slots`, and never `--props` or `--metrics`.
3. **The pinned `b` tag?** Security picks and signs it after reading the advisory list for every build since the previous pin (Sec LM-1.8). It moves only with a Bunny release, and the release record gives its tag and date (Sec LM-13).

**Still open for Security:**
- the CDN host constants, once S-LM3 has recorded them;
- the list entries, once S-LM2 and S-LM5 have settled them (Sec LM-6).

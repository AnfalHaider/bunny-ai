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

## 0. What v0.1.16 ships, and what waits

| In v0.1.16 | Later (named so nobody builds it now) |
|---|---|
| One runtime: llama.cpp `llama-server`, one pinned `b` tag, **CPU** and **Vulkan** builds, downloaded on the person's click | CUDA, ROCm, SYCL and OpenVINO builds (227 to 426 MB; whether the cudart zip is needed is UNKNOWN) |
| A **curated list** of non-gated Apache-2.0 or MIT GGUF files, each pinned by repo, **commit**, file, size and sha256 | "Add from a Hugging Face link", search, gated models, Hugging Face tokens |
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
- Before each model request, chat calls `localRuntime.ensure(modelId)`. That resolves to `{ baseUrl: 'http://127.0.0.1:<port>/v1', apiKey }` for the running server, starting it first if it isn't running (LM-9).
- The rest of the request goes through the existing OpenAI-compatible Chat Completions path, unchanged. That path already allows plain http to loopback (`connections.js`, `parseBaseUrl` with `allowHttp`).
- The per-run key lives only in the main process's memory and in the key file of LM-10. It never goes to `secretStore`, the settings file, a log, a page or the device server.

**LM-3. The model list is what's on disk.**
- `discover` for `bunny-local` lists the curated models that are downloaded and verified (LM-5), using their display names.
- It doesn't ask a running server's `/v1/models`, so the list shows without starting anything.
- `contextLength` is the value LM-7 chose, not the model's own maximum.

**LM-4. Not in Auto, not in engines.**
- In v0.1.16, Auto's pick (`state.autoPick`) never chooses a `bunny-local` model, and the F11 judge never runs on one.
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

The v0.1.16 candidates are official-publisher repos from Researcher's section 3:
- `Qwen/Qwen3-4B-GGUF`, `ibm-granite/granite-4.1-3b-GGUF` and `mistralai/Ministral-3-3B-Instruct-2512-GGUF` for 8 GB;
- `Qwen/Qwen3-8B-GGUF`, `ibm-granite/granite-4.1-8b-GGUF` and `google/gemma-4-12B-it-qat-q4_0-gguf` (text only) for 16 GB;
- `ggml-org/gpt-oss-20b-GGUF` only if S-LM5 shows it fits a 16 GB PC.

Third-party quants (`unsloth/*`) are left out. The final list is whatever passes S-LM2 and S-LM5. The researcher's sizes and sha256 values are re-read **at the pinned commit** when the list is made.

**LM-5d. The download.**
- **URL:** Bunny's own downloader fetches `https://huggingface.co/<repo>/resolve/<revision>/<file>`. It never uses llama-server's `-hf`, and Bunny never sets `LLAMA_CACHE`.
- **Hosts:** `huggingface.co` and the CDN hosts that S-LM3 records from the live redirect. Any other redirect host fails the download.
- **Integrity:** the sha256 is computed while streaming. A download is kept only if `X-Linked-Size` equals the pinned `size`, **and** `X-Linked-ETag` equals the pinned `sha256`, **and** the computed hash equals it too. If the headers differ from the pin, nothing is downloaded and the card says "This model changed on Hugging Face. Bunny will offer it again after an update." The pin is never followed to a new value.
- **Resume:** the file is written as `<file>.part` with a small sidecar holding the bytes done, and resumes with `Range`. Restarting the app resumes, and a resume re-hashes the bytes already on disk first. Cancel deletes the `.part` file.
- **One at a time:** one download runs at a time. Rate limits (429) wait for `RateLimit-Reset` and then retry, at most 3 times.
- **Free space:** before the download, Bunny checks there's at least `size + 2 GB` free on the data folder's drive. If not, it says so and starts nothing.
- **Where:** `<dataDir>/models/<repo with / as __>/<revision>/<file>`. Bunny writes a manifest beside it (sha256, size, the time it was verified).
- **Delete:** the model's folder is removed, the server is stopped first if that model is loaded, and the manifest goes with it.
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
  --no-ui -c <ctx> --jinja --log-verbosity <S-LM4 value> [-ngl auto/fit defaults; CPU build: none]
```

**What the run must and must not have:**
- **Never on the command line:** `-hf`, `--tools`, `--agent`, `--ui-agent`, any MCP flag, `--allow-unauthenticated-tools`, `--rpc` or anything RPC, `--host` other than 127.0.0.1, `--models-dir`.
- **Never shipped or run:** `rpc-server.exe`. It isn't in `allow`, so it's never unpacked.
- **The port:** a free loopback port Bunny picks at random. If the bind fails, Bunny tries again with a new port, at most 3 times.
- **The key:** 32 random bytes, hex. The key file is `<dataDir>/runtimes/run/<runId>.key`. It's written before the start, readable only by the user, and deleted after `/health` succeeds. If the S-LM4 spike shows the server re-reads the file later, it's deleted on stop instead.
- **The process:** it starts the way the engines start it (`process.js`):
  - by absolute path, hidden, with `cwd` set to the runtime folder;
  - with `safeEnv`, which holds no Bunny secrets, no provider keys and no `LLAMA_*` variables;
  - with stdin closed, and stdout and stderr read by Bunny.
- **The logs:** what's kept goes to `<dataDir>/logs/local-model.log` (rotated, 1 MB). It holds start and stop lines and errors only, **never prompt or reply text**. S-LM4 chooses the verbosity that guarantees that.

**LM-11. Stop and idle unload.**
- **Idle stop:** Bunny stops the server after N minutes with no request. N is set in Settings: 5, **10 (default)**, 30 or 60 minutes, or "Only when Bunny closes".
- **How it stops:** `killTree` (`taskkill /T /F`), the same as the engines. Bunny owns the process, so a stop is certain, and llama-server's `--sleep-idle-seconds` isn't used.
- **Stop now:** Settings has a **Stop now** button, and the status shows "Running Qwen3 4B, using about 3.1 GB".
- **During a reply:** a stop waits for a streaming reply to end, or the person cancels the reply.

**LM-12. Quit, crash, sleep.**
- **On app quit:** Bunny kills the tree, and the existing `killStragglers` list includes the server's pid.
- **After a crash of Bunny:** on the next start, `clear-old-workers.js` kills any `llama-server.exe` whose image path is under `<dataDir>/runtimes/`, and only those. A leftover's key file is already gone, so nothing can use it in the meantime.
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
6. **The phone layout:** devices see the model menu and status line only. There's no set-up, download, delete, switch or stop on a phone (LM-13).

Help text and pictures ship with the screen (O7), in a README section "Run models on this PC", with invented-profile pictures only.

## 6. Devices, Quick ask, permissions

**LM-13. Devices.**
- **What a device may do:** a chat on a device (phone or another PC through Bunny's device server) may use a Bunny local model that's already downloaded and verified. The model runs on this PC. A request may start the installed, verified runtime (LM-9), just as it may use any connected provider.
- **What only the window may do:** set up the runtime, download, pause, cancel, delete, Remove Bunny local, the graphics-card switch, the idle setting and Stop now. These routes go in `WINDOW_ONLY_ROUTES` (`^/api/local-models(/.*)?$` writes). Devices are refused by `remoteRoute` and `deviceRefusal`, the same belt as the engines (CE-6).
- **What's never exposed:** the server's port and key, to devices or to any page. The device server never proxies to the runtime: device requests go through chat, which calls `ensure()` in the main process.

**LM-14. Quick ask.** Quick ask may use a Bunny local model when it's the person's chosen model. Its rules don't change: text only, no tools, and the card for a real local action. The 120 s start wait (LM-9) shows in the bar. A failure maps to the existing kinds: `none` when nothing is downloaded, otherwise the plain LM-9 reason.

**LM-15. Same rules as any provider.** The model gets exactly the tools, modes and rules any other provider gets, judged the same way. "Local" isn't a trust level, so nothing is allowed more because the model is on the PC.

## 7. Spikes before build (each one recorded in `pins.json` `canaries`, the way OI-1 was)

These need the owner's yes to download, asked the way Builder A's Claude Code download was asked:
- the pinned zips, about 25 MB (CPU) and 39 MB (Vulkan);
- one 8 GB-class model, about 2.1 to 2.5 GB;
- the 16 GB-class ones, if S-LM5 runs them.

Everything runs in an invented profile (`BUNNY_DATA_DIR` set to a temp folder), and everything is deleted afterwards.

| Spike | What it proves | Pass |
|---|---|---|
| **S-LM1: Vulkan on this PC**, and the CPU build | That the pinned Vulkan build starts with the exact LM-10 argv, lists the GPU and answers a chat. Also tokens per second, GPU vs CPU, whether Windows shows a firewall prompt on the 127.0.0.1 bind, and whether Defender flags the unpacked DLLs | Both builds answer. Vulkan is enabled for the vendors it was proven on: this PC's vendor, and others only when someone runs it there |
| **S-LM2: tool calling per family** | For each candidate family (Qwen3, Granite 4.1, Ministral 3, Gemma 4, GPT-OSS), a two-tool round trip through Bunny's own tool loop with `--jinja`, recording the native vs Generic handler and whether the arguments are valid JSON in 5 runs of 5 | 5 of 5 gives `tools: true`. Anything less gives chat only |
| **S-LM3: Hugging Face and GitHub hosts** | The live redirect hosts for a revision-pinned resolve URL and a release asset. That `X-Linked-ETag` equals the sha256 on the pinned commit. That `Range` resume works across a restart | The host lists filled in from the recorded redirects, and a resumed file's hash matches |
| **S-LM4: the server's own surface** | That the server sends no outbound traffic (captured with fake-upstream and the network log, no system change). That the chosen verbosity logs no prompt text. Whether `POST /props` or `/slots` changes anything without the key. The `--list-devices` output format. Whether the key file is re-read after the start | No outbound traffic, no prompt text, every endpoint refuses a request without the key. Otherwise Security decides |
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

**Open for Security to decide:**
- whether v0.1.16 also needs a restricted token or job object for the child process (Researcher 5.6c, untested here);
- what to do if S-LM4 finds an endpoint that works without the key;
- the pinned `b` tag after the advisory read.

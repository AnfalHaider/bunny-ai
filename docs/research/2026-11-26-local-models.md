# LOCAL-MODELS: Bunny downloads Hugging Face models and runs them itself

Researcher, 2026-11-26. For the owner's word "Bunny runs models itself" (v0.1.16 live-fixes plan, LOCAL-MODELS, HIGH: it downloads and runs programs and models). Design draws and Security reviews after this; the owner's go comes before any build.
Method: vendor release pages and docs, the GitHub and npm and Hugging Face APIs, all read on 2026-11-26. **Nothing was installed, run or downloaded**: only release listings, documentation, HTTP HEAD on one model URL (headers only) and JSON metadata. Free only: no paid service and no key is needed by anything recommended below. UNKNOWN where a source did not say.

## Recommendation first

1. **Runtime: a pinned `llama-server` from llama.cpp's release zips, run by Bunny as a child process on 127.0.0.1** with a per-run API key, started from Bunny's data folder by absolute path. MIT licence; the release has Windows x64 CPU (25 MB), Vulkan (39 MB, GPU on NVIDIA, AMD and Intel), CUDA, ROCm, SYCL and OpenVINO zips; it serves OpenAI chat completions, responses, embeddings and Anthropic messages natively; it has a router mode with load and unload, idle sleep, and automatic fit to memory. Bunny already talks to OpenAI-compatible servers, so the integration is "one more local provider".
2. **Models: Bunny's own downloader** (Hugging Face resolve URL, `Range` resume, sha256 from `X-Linked-ETag`, a curated list of non-gated Apache-2.0 or MIT models), not llama-server's built-in `-hf` fetch, so Bunny can pin, verify, show progress and delete.
3. **Not recommended now:** node-llama-cpp (runs the model parser inside Bunny's own process and has no server), llamafile (licence unclear on GitHub, 4 GB Windows limit), mistral.rs (only a CPU Windows build in its release). All three are worth a note, none is the simplest path.
4. **Security points** are in section 5: sha-pinned binary, loopback plus token, GGUF parser flaws (a long advisory history), no RPC backend, no built-in tools, UI off.

## 1. Runtimes

| | **llama.cpp `llama-server`** (recommended) | **node-llama-cpp** | **llamafile** | **mistral.rs** |
|---|---|---|---|---|
| Licence | MIT ([repo](https://github.com/ggml-org/llama.cpp)) | MIT ([repo](https://github.com/withcatai/node-llama-cpp)) | GitHub shows NOASSERTION; the README badge says Apache-2.0 ([repo](https://github.com/mozilla-ai/llamafile)) | MIT ([repo](https://github.com/EricLBuehler/mistral.rs)) |
| What you ship | A zip of executables and DLLs per backend, release **b12760** (2026-11-26) read here | An npm package plus optional native packages, v3.22.4 (2026-11-25), runs **inside** the Electron main process | One file per model (`.llamafile`) or the llamafile binary; latest release 0.10.6 (2026-09-15), no Windows asset listed | Windows zip `mistralrs-cpu-x86_64-pc-windows-msvc.zip` (34 MB) in v0.9.5 (2026-10-19); no Windows GPU asset in that release |
| Windows x64 sizes | CPU **25.3 MB**; Vulkan **39.1 MB**; CUDA 12.4 **358 MB**; CUDA 13.5 **227 MB**; ROCm 10.0 **285 MB**; SYCL 174 MB; OpenVINO 105 MB. Separate "cudart" zips (CUDA runtime DLLs) 391 MB (12.4) and 426 MB (13.5): whether a PC without the CUDA toolkit needs them: UNKNOWN (not read). | npm unpacked: win-x64 **35 MB**, Vulkan **76 MB**, CUDA **204 MB**, CUDA-ext **316 MB**; main package 41 MB | n/a | CPU **34 MB** |
| GPU | CPU, Vulkan, CUDA, ROCm (AMD), SYCL and OpenVINO (Intel), OpenCL on Adreno; Vulkan runs on NVIDIA, AMD and Intel GPUs (Vulkan's general reach: not quoted from llama.cpp docs, prove in a spike) | CUDA, Vulkan, Metal chosen "by default when support is detected"; falls back to building from source if no prebuilt binary, which Electron disables | UNKNOWN | CUDA and Metal exist in the project; Windows GPU: build from source (UNKNOWN) |
| OpenAI-compatible API | **Built in**: `/v1/chat/completions`, `/v1/completions`, `/v1/responses`, `/v1/embeddings`, `/v1/models`, plus Anthropic `/v1/messages` ([server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)) | **None found in the docs read**: it is a library; Bunny would write the server (UNKNOWN whether a bundled one exists) | A server inside (`llamafile` is llama.cpp plus Cosmopolitan Libc) | `mistralrs serve` exposes OpenAI `/v1` and Anthropic `/v1/messages` |
| Pinning and update | Pin a `bNNNN` tag; every asset shows a **sha256 digest** in the GitHub API. Note: all `b` tags are marked pre-release and the repo's "latest" release is **v1.0.0** (2026-11-13) with a single asset, so "latest" is not the one to follow. Releases land many times a day. | `package-lock` integrity per npm package; the native addon is part of Bunny's own build | Version per release | Release tags |
| Windows quirks | None found in the README read; unsigned status of the binaries: UNKNOWN | **Main process only**: "Trying to use node-llama-cpp on a renderer process will crash the application"; native binaries must stay outside the asar archive | **Windows cannot run executables over 4 GB**, so large llamafiles fail ([README](https://github.com/mozilla-ai/llamafile)) | Unknown beyond the CPU build |
| Fit for Bunny | **Best**: separate process (a crash or a bad model file cannot take Bunny down), loopback server, no new Bunny code for the wire format | Fine for a library embed, but a malicious model file would be parsed inside Bunny itself | Not recommended | Possible later for Anthropic-shaped needs (CLI engines), CPU only on Windows today |

### How `llama-server` behaves (from its README, all current as of 2026-11-26)

- **Binding and keys:** `--host` defaults to **127.0.0.1**; `--port` default 9931 (README text); `--api-key KEY` or `--api-key-file` (several keys allowed; default none). Bunny passes a random key by file.
- **Memory fit:** `-fit` is **on by default**: "adjust unset arguments to fit in device memory", with a margin (`--fit-target`, default 1024 MiB) and a minimum context (`--fit-ctx`, default 4096). `-c/--ctx-size` 0 means the model's own value.
- **Unload after idle:** `--sleep-idle-seconds` (default -1 = off). **Router mode** (start `llama-server` with no model): `--models-dir` (a folder of GGUF files, shards and multimodal projectors in sub-folders), `--models-max` (default 4 loaded), `--models-memory-margin` (unload least-recently-used models until a new one fits), `--models-autoload`; models load and unload through the API; `?model=` selects a model; "The server must be restarted after adding a new model" to the cache (so Bunny should use `--models-dir` and restart, or one server per model).
- **Tool calling:** `--jinja` is on by default; native tool-call formats exist for Llama 3.x, Hermes 2/3 and Qwen 2.5, Mistral Nemo, GPT-OSS and others; any other template uses a "Generic" handler that "may consume more tokens and be less efficient" ([function calling](https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md), list is older than the newest model families).
- **Dangerous extras are off by default:** built-in tools (`--tools`), MCP proxy, agent mode. `--ui` (the built-in chat web app) is **on** by default and can be turned off (`--no-ui`). `--tools` "do not enable in untrusted environments".
- **Cache folder:** `LLAMA_CACHE` environment variable (for `-hf`); `--models-dir` for your own folder.
- **Cost:** none; no account.

### What the other runtimes would cost

- **node-llama-cpp** gives `createModelDownloader` and `hf:user/model:quant` URIs, GPU auto-detection and Electron packaging advice (`electron-builder` config in the scaffold), but you load the model **in-process**: every GGUF parser flaw in section 5 lands in Bunny's main process, and Bunny would have to implement the OpenAI endpoint itself.
- **llamafile** 0.10 is rebuilt on a new build system (README); latest release has no Windows asset list; the 4 GB executable limit makes "download a model" awkward.
- **mistral.rs** is attractive for Anthropic-shaped and agent features, but its Windows release carries only a CPU build.

## 2. Models: download, fit, integrity

**Hugging Face download (verified by one HEAD request on a model URL, no body fetched):**
- A file URL `https://huggingface.co/<repo>/resolve/main/<file>` answers **302** to a CDN host; the response carries `Accept-Ranges: bytes` (so a download can **resume** with a `Range` header), `X-Linked-Size` (exact bytes) and **`X-Linked-ETag: "<sha256>"`**, which for this file equals the `lfs.oid` of the tree listing, i.e. the file's sha256. Bunny should download, hash while streaming, and compare to that value. The redirect leads to `cdn.hf.co` / Xet hosts: the allowed-host list for downloads must include HF's CDN names (to be taken from the live redirect, not guessed).
- **Listing and sizes:** `GET https://huggingface.co/api/models/<repo>` (licence tag, `gated`, last modified) and `GET .../api/models/<repo>/tree/main` (every file with `size` and `lfs.oid`). Used for the list in section 3.
- **GGUF metadata without downloading the file:** `@huggingface/gguf` reads the header from a remote URL by range request (documented in the Hub's [GGUF page](https://huggingface.co/docs/hub/gguf)); useful for the layer count and context length used in a fit estimate. Its licence: UNKNOWN (not read).
- **Rate limits:** requests are limited in 5-minute windows by bucket (API, resolvers, pages); a 429 carries IETF `RateLimit` headers; anonymous limits are not stated in the page read ([rate limits](https://huggingface.co/docs/hub/rate-limits)). Resolvers have "the highest" limits.
- **Gated models** need a Hugging Face account, an access request, and a token; "no keys, no accounts" therefore means **the starter list must be non-gated only**. A gated repo should show "needs your Hugging Face token" and stay out of the default flow ([gated models](https://huggingface.co/docs/hub/models-gated)).
- **Licences:** the Hub carries a licence tag per repo; Bunny should show it and block anything without an OSI-style tag unless the person confirms. All twelve starter files below are non-gated and tagged Apache-2.0.
- **Disk location:** Bunny's data folder (for example `…\BunnyAI\models\<repo>\<file>`), not `%USERPROFILE%\.cache`, so Bunny can count, delete and back up; `--models-dir` takes that folder. Free-space check before a download (file size from the tree API); partial files kept as `.part` and resumed.

**Picking a quantisation from RAM and VRAM (my rule, to be tested; not a vendor statement):**
- Default to **Q4_K_M** (llama.cpp's own `-hf` default when no quant is named, per the README) unless the model's repo has no such file.
- The memory needed is roughly **file size + KV cache + about 1.5 GB for the OS and Bunny**; KV cache grows with context length and with the model's layer and head sizes (readable from the GGUF header). Offer Q4 first, Q5 or Q6 when the estimate leaves 25 percent free, Q3 or smaller only as a warning.
- With a GPU, llama.cpp's `--fit` already trims layers or context to the device; Bunny's job is to show the person the result ("runs fully on GPU", "partly on CPU", "will be slow") before download, from the same estimate.

## 3. Starter list: chat plus tool calling, non-gated, Apache-2.0

Exact repo, file, size and sha256 (from the Hub tree API on 2026-11-26). "Tool calling" is **not** proven for any of them here: llama.cpp's native list covers Qwen (Hermes-style), Llama 3.x, Mistral Nemo and GPT-OSS; the newer families may use the Generic handler or a newer one. A spike must run a tool-call test on each.

**Machines with 8 GB RAM (file up to about 3 GB):**

| # | Repo | File | Size (bytes) | sha256 | Licence | Note |
|---|---|---|---|---|---|---|
| 1 | `Qwen/Qwen3-4B-GGUF` | `Qwen3-4B-Q4_K_M.gguf` | 2,497,280,256 | `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` | Apache-2.0 | Qwen3 4B, official; Hermes-style tool calls |
| 2 | `mistralai/Ministral-3-3B-Instruct-2512-GGUF` | `Ministral-3-3B-Instruct-2512-Q4_K_M.gguf` | 2,147,023,008 | `9ed150d4367e68df0ac8e1540f6ddc65b42d0ee26378329d1ecbca60f93fc5f8` | Apache-2.0 | official Mistral repo, updated 2026-01-15 |
| 3 | `ibm-granite/granite-4.1-3b-GGUF` | `granite-4.1-3b-Q4_K_M.gguf` | 2,099,501,664 | `662b0626cd58f443baea23559b469df6576a81d349649c59413b36a9fb32eb29` | Apache-2.0 | official IBM repo, updated 2026-04-20 |
| 4 | `unsloth/Qwen3.5-4B-GGUF` | `Qwen3.5-4B-Q4_K_M.gguf` | 2,740,937,888 | `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4` | Apache-2.0 | newer Qwen family; quantised by a third party (Unsloth), base `Qwen/Qwen3.5-9B` is Apache-2.0 |

**Machines with 16 GB RAM (file up to about 9 GB; 16 GB with a GPU more freely):**

| # | Repo | File | Size (bytes) | sha256 | Licence | Note |
|---|---|---|---|---|---|---|
| 5 | `Qwen/Qwen3-8B-GGUF` | `Qwen3-8B-Q4_K_M.gguf` | 5,027,783,488 | `d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785` | Apache-2.0 | official |
| 6 | `unsloth/Qwen3.5-9B-GGUF` | `Qwen3.5-9B-Q4_K_M.gguf` | 5,680,522,464 | `03b74727a860a56338e042c4420bb3f04b2fec5734175f4cb9fa853daf52b7e8` | Apache-2.0 | third-party quant |
| 7 | `mistralai/Ministral-3-8B-Instruct-2512-GGUF` | `Ministral-3-8B-Instruct-2512-Q4_K_M.gguf` | 5,198,911,904 | `33e7a72cf5e6e2cfc2f2847075acc013d68bba023e35310cef86b5cf8fdca761` | Apache-2.0 | official |
| 8 | `ibm-granite/granite-4.1-8b-GGUF` | `granite-4.1-8b-Q4_K_M.gguf` | 5,347,914,400 | `ed902ac9eb6adce5a90c6a08c8ea201b50e23fdc5976d1cd0362006afac5309e` | Apache-2.0 | official |
| 9 | `google/gemma-4-12B-it-qat-q4_0-gguf` | `gemma-4-12b-it-qat-q4_0.gguf` | 6,975,879,296 | `93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b` | Apache-2.0 (Hub tag) | quantisation-aware q4_0 by Google; an image projector file `mmproj-…` (175 MB) sits beside it |
| 10 | `Qwen/Qwen3-14B-GGUF` | `Qwen3-14B-Q4_K_M.gguf` | 9,001,752,960 | `500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0` | Apache-2.0 | tight on 16 GB with a long context |
| 11 | `ggml-org/gpt-oss-20b-GGUF` | `gpt-oss-20b-MXFP4.gguf` | 12,109,566,624 | `27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901` | Apache-2.0 | native GPT-OSS tool format in llama.cpp; 12 GB file: only for 16 GB machines with little else open (fit: UNKNOWN until tested) |

Also seen, not listed: `google/gemma-4-E4B-it-qat-q4_0-gguf` (5.15 GB, Apache-2.0, borderline on 8 GB: file `gemma-4-E4B_q4_0-it.gguf`, sha256 `676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee`); Phi-4-mini (MIT, but the official `microsoft` GGUF repo I tried was not found, and the third-party quants are not official). Models under the Llama or older Gemma licences are **not** on the list: they are not Apache or MIT.
Sizes and hashes change when a repo is updated: Bunny should read them from the Hub at download time and compare the **pinned** value in its own list; a mismatch means "the repo changed, ask Security" (CE-5.4 style).

## 4. What LM Studio and Ollama do well (to match, from their docs)

| Feature | LM Studio | Ollama | For Bunny |
|---|---|---|---|
| **Model search** | Search by keyword (`llama`, `gemma`), by `user/model`, or paste a full Hugging Face URL; picks files and quants from Hugging Face ([download page](https://lmstudio.ai/docs/app/basics/download-model)) | A curated library (`ollama pull name`); GGUF from Hugging Face by name | A curated list first (section 3), with a "from a Hugging Face link" box that applies the licence and size checks |
| **Fit indicator** | Per-model GPU offload and context settings in the load dialog; a "will it fit" cue before loading (the page read lists the settings, not the exact wording of the cue: UNKNOWN) | Chooses layers by VRAM automatically; context default depends on VRAM | llama-server's `--fit` plus an estimate shown before download: "fits in memory", "partly on CPU", "too big" |
| **Unload after idle** | **Idle TTL**, default 60 minutes for models loaded just-in-time; auto-evict unloads older JIT models before loading a new one ([TTL doc](https://lmstudio.ai/docs/developer/core/ttl-and-auto-evict)) | Keep-alive: "By default models are kept in memory for 5 minutes", `ollama stop` to unload ([FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx)) | Bunny owns the process, so "stop the server after N minutes idle" is trivial and certain; also `--sleep-idle-seconds` and router `--models-max` |
| **Context length** | Per-model setting | Default 4096 tokens under 24 GiB VRAM, 32k at 24 to 48 GiB, 256k at 48 GiB or more; `OLLAMA_CONTEXT_LENGTH`; docs recommend at least 64k for "web search, agents, and coding tools" ([context length](https://github.com/ollama/ollama/blob/main/docs/context-length.mdx)) | A slider capped by the fit estimate; agent chats need at least 32k to 64k, which is **more memory** (warn) |
| **Local server** | OpenAI-compatible server, JIT model loading | Binds 127.0.0.1:11434 by default; CORS allows 127.0.0.1 and 0.0.0.0 by default (`OLLAMA_ORIGINS`); models folder `OLLAMA_MODELS` | llama-server on loopback with a token, no CORS needed |
| **Licence / cost** | Terms page read, but the free-use wording was not found: UNKNOWN | MIT; free | n/a |
| **Download UX** | Progress, pause, a models folder you can change | `ollama pull` progress | Progress with speed, resume, cancel, disk-space check, delete, "move models folder" |

## 5. For Security's review

1. **Running a downloaded binary.** The release zips are built in GitHub Actions and carry a sha256 digest on every asset in the release API; Bunny should **pin one `b` tag and the asset's sha256** in its own code and check after download and before every start (CE-5 applies as for the CLI engines: HTTPS only, redirect hosts on a list, no archive path escapes, size cap, no elevation). Whether the executables are **Authenticode-signed**: UNKNOWN (not stated). The zip bundles many DLLs; Bunny should unpack to its own folder and refuse files not in the pinned list.
2. **Update path.** A new pin is a Security sign-off after reading the advisories (below). The `b` tags are pre-release in GitHub terms and appear many times a day; do not follow "latest".
3. **Binding.** Start with `--host 127.0.0.1`, a random port, and `--api-key-file` holding a per-run random key kept out of the command line; no `0.0.0.0`; no router exposure to the LAN or the web (Bunny's device server must never proxy to it); close the process on quit, Stop and idle. Any other program on the PC can still reach a loopback port, so the key is the barrier, as in CE-4.
4. **Turn off what the server offers by default:** `--no-ui` (the web app is on by default); never `--tools`, `--agent`, `--ui-agent`, MCP servers or `--allow-unauthenticated-tools`; check the status endpoints (`/props`, `/slots`, `/metrics`) are not needed or are protected: whether `POST /props` can change settings and what flag guards it: UNKNOWN (page not read in full).
5. **No RPC backend.** llama.cpp has an RPC server with a **critical** advisory (GHSA-j8rj-fmpv-wcxw, "Unauthenticated RCE ... RPC backend", vulnerable up to b7991) and earlier RPC flaws; Bunny must never enable or ship `rpc-server`.
6. **Malicious GGUF files (parser CVEs).** The GitHub advisory list for llama.cpp (read via the API) shows a long run of memory-safety bugs in model loading: GHSA-96jg-mvhq-q7q7 (heap overflow in GGUF tensor parsing, high, patched b7824), GHSA-3p4r-fq3f-q74v (CVE-2026-27940, heap overflow in `mem_size`, high, patched at b8146), GHSA-vgg9-87g3-85w8 (CVE-2025-53630, GGUF parser integer overflow), GHSA-7rxv-5jhh-j6xx (tokenizer overflow, patched b5721), GHSA-8wwf-w4qm-gpqr (vocabulary loading, patched b5662), plus older `gguf_init_from_file` flaws, and GHSA-8947-pfff-2f3c (out-of-bounds write in `llama-server`, low). Every one is fixed in a build far older than b12760, but the pattern means **a crafted model file is an attack on the process that loads it**. Mitigations that follow from this: (a) load models in the **separate llama-server process**, never in Bunny's own (a point against node-llama-cpp); (b) default to the curated list and verify sha256; a custom repo gets a warning and a licence check; (c) consider a restricted Windows token or job object for the child (Codex's Windows sandbox shows this is possible: restricted token plus ACLs; not tested here); (d) keep the child's working folder to the models folder and give it no Bunny secrets in its environment (`safeEnv`).
7. **Downloaded model data is not code, but its chat template is.** llama.cpp runs the model's **Jinja chat template** (`--jinja` on by default); templates are parsed by llama.cpp's own engine, not Python, but it is still untrusted text from the model file: another reason to restrict to the curated list.
8. **Network.** llama-server does not need the network once the model is on disk; `-hf` downloads are not used by Bunny; no telemetry statement was found in the server README (UNKNOWN: confirm at the fake-upstream capture, as for the CLI engines). Bunny's own downloader talks only to `huggingface.co` and its CDN hosts.
9. **Disk and privacy.** Models in Bunny's folder; chats to the local model never leave the PC; the model's output is only as safe as the tools Bunny gives it (same rules and modes as any other provider).
10. **Gated and licence.** Only non-gated, tagged Apache-2.0 or MIT in the default list; no Hugging Face token is read or stored in v1 (free only, no keys).

## 6. Risks and open questions for the spike

- **GPU support on real PCs:** prove the Vulkan build on one NVIDIA, one AMD and one Intel machine, and the CPU build on a machine with no GPU; check driver needs for the CUDA builds (not read).
- **Windows warnings:** whether the unsigned DLLs trigger SmartScreen or Defender; whether the first loopback bind shows a firewall prompt (UNKNOWN).
- **Tool calling:** run a tool-call round trip on each starter model with `--jinja`; record which use a native handler and which the Generic one.
- **Context and memory:** measure real memory for 8k, 32k and 64k context on the 8 GB and 16 GB machines; the fit logic is Bunny's promise to the person.
- **Router vs one server per model:** router mode needs a restart to see new cache models; `--models-dir` plus a restart, or one server per active model, is simpler. Pick in the spike.
- **Size on disk:** Vulkan build 39 MB plus a CPU fallback 25 MB is small; CUDA builds are 227 to 358 MB plus separate runtime zips: offer CUDA only as an optional "faster on NVIDIA" download.
- **Update cadence:** how often to bump the pin; suggestion: with each Bunny release, after Security reads the advisory list.

## Not verified (UNKNOWN)

Authenticode signing of llama.cpp binaries; whether CUDA zips need the separate cudart zip; what the repo's "v1.0.0" latest release is; the server's telemetry and `POST /props` guard; llama.cpp's native tool-call handlers for Qwen3.5, Ministral 3, Granite 4.1 and Gemma 4; `@huggingface/gguf` licence; LM Studio's licence wording and exact fit-indicator text; llamafile's licence file and Windows assets; mistral.rs Windows GPU builds; anonymous Hugging Face rate-limit numbers; any Windows run of anything (none was run).

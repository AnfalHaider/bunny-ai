# Bunny local: where each listed model comes from, and what was checked

Frozen in source: the list changes only with a Bunny release (Security's Sec LM-6, SP-7). Each entry has the five values below at a fixed commit, and its chat template.

| id | repo | commit | file | size | sha256 |
|---|---|---|---|---|---|
| qwen3-4b | `Qwen/Qwen3-4B-GGUF` | `bc640142c66e1fdd12af0bd68f40445458f3869b` | `Qwen3-4B-Q4_K_M.gguf` | 2,497,280,256 | `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5` |
| granite-4.1-3b | `ibm-granite/granite-4.1-3b-GGUF` | `ab4701481089b58a082ef63cc1cee738887293ff` | `granite-4.1-3b-Q4_K_M.gguf` | 2,099,501,664 | `662b0626cd58f443baea23559b469df6576a81d349649c59413b36a9fb32eb29` |

## What was checked

| Check | qwen3-4b | granite-4.1-3b | By, when |
|---|---|---|---|
| The repo owner is the publisher (Qwen, IBM) | yes | yes | Security, 2026-11-26 (SP-7) |
| Not gated; `license:apache-2.0` | yes | yes | Security, 2026-11-26 (SP-7) |
| sha256 equals `X-Linked-ETag` at that commit; `Range` resume works | yes | yes | Builder D, S-LM3, 2026-11-26 |
| Tool calls: two-tool round trip, valid JSON arguments | 5 of 5 | 5 of 5 | Builder D, S-LM2, 2026-11-26 |
| Memory estimate against the measured peak, 8k, 16k and 32k | within 5 % | within 1 % | Builder D, S-LM5, 2026-11-26 |
| **Chat template** (sha256 of the template text from the GGUF header, a header-only range read) | read: `57f1fd00…d0361` | read: `fed2756d…d476` | Builder E, 2026-11-26 (owner's yes, relayed in docs/plans/2026-11-26-v0.1.16-live-fixes.md) |

## Chat template

Each template is the GGUF metadata key `tokenizer.chat_template`, read from `<repo>@<commit>` with one range read of the first 24 MiB (header only; the parser uses BigInt, caps string and array sizes, and stops at the key). The sha256 is of the template's UTF-8 text. What was read was kept only long enough to hash and look through, then deleted.

- qwen3-4b (`Qwen/Qwen3-4B-GGUF@bc640142…`): 4,100 characters, sha256 `57f1fd00f0013a2be96aa79b857391f27e23df5b5f847072b524c897e24d0361`. Looked through: it formats messages, tool calls and thinking; its only fixed text is the tools line "You are provided with function signatures within <tools></tools> XML tags". No URL, no other instruction to the model.
- granite-4.1-3b (`ibm-granite/granite-4.1-3b-GGUF@ab470148…`): 6,099 characters, sha256 `fed2756d2d24e127b951dcf139d0b03ab7db8ef23a456128ebc9c2db4901d476`. Looked through: it formats messages, tools and documents; its fixed text is IBM's own tool and document lines ("You are a helpful assistant with access to the following tools…", the <tool_call> format, the documents line). No URL, no other instruction to the model.

A listed model's template is code Bunny has not run on its own: the check for a reviewer is that it only formats messages and holds no text meant for the model that was not in the publisher's own card.

## Not listed (and why)

Ministral 3, Gemma 4, GPT-OSS and every other model: not refused on security grounds, but none has been checked, and their tool calls and memory fit were not measured (S-LM2, S-LM5 covered these two). One joins in a later release when its entry and template reach Security.

## LM Studio's models folder (LF-8): what Bunny reads, and what is not yet verified

Bunny lists LM Studio's models folder only. It reads these files, only under the person's own profile folder, each with a 1 MiB cap, parsed as JSON (or one line of text for the pointer), taking exactly one string value, and uses the default when one is missing, too big or malformed:

1. `<profile>\.lmstudio-home-pointer`: if present, its first line is a path to LM Studio's home folder (community plugin code that finds LM Studio's home, for example the `findLMStudioHome.ts` files published on lmstudio.ai, describes it; not LM Studio's own documentation).
2. `<LM Studio home>\settings.json`, the key `downloadsFolder` (a string): the key name is named in LM Studio's own issue tracker (lmstudio-ai/lms issue 573: "downloadsFolder" in settings.json, where a value starting with `~` is not expanded, so a value is taken as an absolute path only). The home is the pointer's folder, else `<profile>\.lmstudio`, else `<profile>\.cache\lm-studio`.
3. The defaults: `<home>\models`, `<profile>\.lmstudio\models`, `<profile>\.cache\lm-studio\models`.

**Not verified.** No fresh LM Studio install was made and no official LM Studio page names the file and key (the sources above are an issue report and community plugin code). Builder E could not read the owner's real `.lmstudio` (never done). Security: this is the one LF-8 record that rests on secondary sources. If LM Studio keeps the setting somewhere else, Bunny falls back to the default folder, so the failure is "not listed", never a read somewhere unexpected. Nothing is ever written there, and Bunny never starts LM Studio, calls its local server or runs its bundled runtimes.

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
| **Chat template** (sha256 of the template text from the GGUF header, a header-only range read) | **PENDING** | **PENDING** | needs the owner's yes to read the header; Security signs the build only with this filled in |

## Chat template (to fill in)

For each entry: the template text or its sha256, and where it was read (`<repo>@<commit>`, the GGUF metadata key `tokenizer.chat_template`, a range read of the header only).

- qwen3-4b: PENDING
- granite-4.1-3b: PENDING

A listed model's template is code Bunny has not run on its own: the check for a reviewer is that it only formats messages and holds no text meant for the model that was not in the publisher's own card.

## Not listed (and why)

Ministral 3, Gemma 4, GPT-OSS and every other model: not refused on security grounds, but none has been checked, and their tool calls and memory fit were not measured (S-LM2, S-LM5 covered these two). One joins in a later release when its entry and template reach Security.

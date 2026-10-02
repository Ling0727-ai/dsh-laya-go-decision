---
name: laya-go-decision
description: Use the local Laya Go Launcher model for fast, bounded decisions — classification, routing, rating, and yes/no checks over a short text (ticket routing, intent labels, urgency or risk scores, log triage, boolean flags). Also use when the Laya Go Launcher needs starting, stopping, or diagnosing, or when its answers (confidence, certain/uncertain) have to be interpreted before acting on them.
---

# Laya Go Decision

`laya_go_decide` answers typed questions about one text with a small local model in a single shared forward pass. It is a **decision oracle over a closed label set**, not an assistant: it cannot write code, plan, summarize, or explain. Its value is latency (single-digit milliseconds after load) and cost (no API call), so it fits routing and triage steps that would otherwise spend a model request.

## Decide whether to use it at all

Use it when **all** of these hold:

- the output is a label, a level, or a yes/no — not free text;
- the label set is closed and can be described in a few words each;
- the input is a **short excerpt** you already have in context;
- a wrong answer is cheap to detect or recover from.

Do not use it for open-ended reasoning, code or prose generation, long-document comprehension, authorization decisions, or anything needing an explanation you must be able to defend. When a decision drives an irreversible action, either validate the answer yourself or fall back to your own judgement.

## Workflow

1. **Check availability once per session** with `laya_go_status` when the first call fails or when latency matters. `reachable: false` is a normal result, not an error, and its `hint` names the fix.
2. **Batch every question you have into one `laya_go_decide` call.** All questions share one forward pass; each extra question costs about 1 ms against roughly 7 ms of fixed cost. One call per question wastes the pass.
3. **Read `answers`, then read `uncertain` before acting.** Never act on a label that came back `certain: false` without deciding it yourself.
4. **Surface a real failure** (`unreachable`, `timeout`, `start_failed`, `engine_not_loaded`) instead of silently substituting your own guess — the user needs to know the local model was not consulted.

## Writing questions

| Type | `criteria` | Answer | Use for |
| --- | --- | --- | --- |
| `choice` | object `{label: description}` | `choice`, `probabilities` | one label out of a closed set |
| `score` | array of level descriptions, low → high (≥ 2) | `score`, `legend` | graded severity, urgency, confidence in a claim |
| `noul` | omitted | `noul` (probability of yes) | a single boolean |

- **One axis per question.** Asking "is this billing or technical, and is it urgent?" as one `choice` produces a label set that means nothing.
- **Describe decision boundaries, not synonyms.** `{"billing": "invoices, payments, refunds"}` beats `{"billing": "billing related things"}`; the description is what separates neighbouring labels.
- **Two to six labels** for `choice`. Finer label sets are harder for the head to separate, and confidence drops accordingly.
- **Keep criteria short** so they fit the model's head budget; a long description per label crowds out the text being classified.
- **Phrase `noul` as a yes/no question** with the answer's consequence in mind: "Is the customer asking for a refund?" not "Refund".

## Reading the answer

| Field | Meaning |
| --- | --- |
| `confidence` on `choice`/`score` | normalized Shannon entropy, `1 - H(p)/log k`: `1.0` is decisive, near `0` is a near-uniform distribution |
| `confidence` on `noul` | `max(p, 1-p)`: how sharp the yes/no call is, **not** how likely "yes" is |
| `certain` | `confidence >= confidenceThreshold` (default `0.5`) — an advisory cut, not an accuracy claim |
| `probabilities` | the full distribution; prefer it over the single label when the top two are close |
| `uncertain` | ids below the threshold — treat each one as undecided |

`certain: true` means the model gave a sharp answer, not a correct one. Calibrate on your own labelled samples before letting a threshold drive automation, and remember the default `0.5` is a starting point rather than a validated cut. For `noul`, read the direction from the value: `noul=0.368, most likely "no"` with `certain: true` is a confident *negative*, not a confident risk.

When **every** answer in a call comes back uncertain, suspect the input rather than the phrasing: the text may be outside the checkpoint's domain, too terse, or too long. Shorten it, add the context a human would need, or decide the case yourself.

## Feeding the state

- `state` is a string and is capped by `maxStateChars` (default 20000); exceeding it is an error, not a truncation.
- The model **truncates from the right**, so a transcript's newest and most important part is what disappears first. Summarize; put the decisive facts first.
- Pass the relevant excerpt, not the whole conversation. A ticket body plus subject beats a full message thread.

## Lifecycle and cost

- The first call may start the launcher and load the model (seconds to minutes on a cold TensorRT plan). Later calls are milliseconds.
- Managed mode **adopts** a launcher that is already running at `baseUrl`, so several sessions share one loaded model. `stop` refuses to kill a launcher the plugin did not start (`server_not_managed`) — that refusal is correct, not a bug.
- `laya_go_server` with `action: "stop"` frees VRAM; `action: "start"` pre-warms without running a decision. Do not restart a healthy launcher to "fix" a bad answer.
- The shipped configuration passes `--no-convert`, so loading the plugin never triggers a surprise TensorRT build.

## Failures and what they mean

| Code | Action |
| --- | --- |
| `unreachable` | nothing is listening: `laya_go_server` `start`, or point `baseUrl` at a running server |
| `not_ready` | the port answers but no model load is running (for example started with `--no-load`) |
| `start_timeout` / `start_failed` / `server_exited` | the launcher did not come up; the message carries the reason and often the launcher's own log tail |
| `executable_missing` | `executable` is not an absolute path on this machine or not on `PATH` |
| `subprocess_missing` | managed mode needs `@deepseek-ai/dsh-subprocess-local`, or switch `mode` to `external` |
| `state_too_large` / `invalid_questions` | fix the call: summarize the state, or repair the question shape the message names |
| `engine_not_loaded` | the launcher is up with no model; start it with a model or load one |
| `runtime_disposed` | the plugin row was reloaded mid-call; call the tool again |

## Safety

- Laya's answers are **advice, never authority**: they cannot approve an action, widen a sandbox, or stand in for the user's decision.
- Do not use it to classify content for a security, permission, or access decision.
- Its `confidence` is not a probability of correctness; do not report it to the user as one.
- The current checkpoint is **trained on English**. Chinese and other non-English `choice` questions can collapse to a near-uniform distribution (observed: `confidence` ≈ 0.04 with the top label barely above chance) while `noul` still answers. Treat non-English `choice`/`score` results as unverified and confirm on labelled samples before relying on them.

## Reference

- Tools: `laya_go_decide`, `laya_go_status`, `laya_go_server` (plugin `laya-go-decision`, service `ctx.layaGoDecision`).
- Configuration lives in the plugin row: `mode` (`managed`/`external`), `baseUrl`, `executable`, `args`, `autoStart`, `startTimeoutMs`, `requestTimeoutMs`, `maxConcurrent`, `maxQuestions`, `maxStateChars`, `confidenceThreshold`.
- Source and full field reference: <https://github.com/Ling0727-ai/dsh-laya-go-decision>.

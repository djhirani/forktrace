# ForkTrace

**Agent failed? Rewind it. Fix one step. Replay from there.**

ForkTrace is time-travel debugging for OpenAI Agents SDK executions. It records an agent run as immutable JSONL, lets a developer fork at one observable event, replays only the downstream path with memoized tool results, marks the first changed execution as `DIVERGED`, and reports the measured difference between the original and fork.

- Public repository: https://github.com/djhirani/forktrace
- Read-only deployed walkthrough: https://forktrace.vercel.app
- Codex `/feedback` Session ID: `019f7d30-8e3e-7583-be0c-37e6a1e388c2`

## Honesty position

ForkTrace records observable evidence only: user inputs, model messages or decisions, tool calls, tool results, JSON state snapshots, errors, final outputs, timing, and token usage. It never claims to display hidden reasoning or chain of thought. A `DIVERGED` event means recorded arguments stopped matching and execution continued live; it is not an inference about why a model acted.

## Architecture

```text
OpenAI Agents SDK run
        │ observable SDK events / tool boundaries
        ▼
Recorder ───────────────▶ append-only JSONL original
                                │
                                ▼
Fork engine ────────────▶ lineage-stamped prefix + one edit
                                │
                                ▼
Memoized replay ────────▶ recorded result on exact match
                          DIVERGED + live tool on mismatch
                                │
                                ▼
Diff report ────────────▶ measured status / calls / time / tokens
                                │
                                ▼
Timeline UI ────────────▶ original and fork evidence side by side
```

All context is JSON-round-trip validated. Originals are never rewritten. A fork carries `run_id`, `parent_run_id`, `forked_from_run_id`, and `fork_at_event` on every event.

## Demo scenario

The deterministic customer-support run receives two nearby records:

- `J. Ahmed` — correct, `CUST-1041`
- `J. Ahmad` — wrong, `CUST-1042`

The planted run structurally selects `CUST-1042`, sends it to `process_refund`, and records `CUSTOMER_MISMATCH`. Fork event 8, change only `CUST-1042` to `CUST-1041`, and replay. The fork records its first divergence, executes the safe tool live, and passes.

## Memoized replay and divergence

Tool calls are indexed by tool name plus stable JSON arguments. Object keys are sorted recursively; array order and primitive types remain significant.

- Exact match: the recorded tool result is returned and the tool body does not execute. The result carries `replayed_from_recording: true`.
- No match: ForkTrace appends a `diverged` event immediately before the live tool call, including `last_matching_event_index`.

The no-op determinism test writes the same argument back, verifies zero divergence, and asserts that no memoized tool body executed.

## Quickstart

Requires Node.js 22 or newer.

```sh
npm install
npm run demo:reset
npm run dev
```

Open the printed local URL, select the failing run, choose event 8 (`process_refund`), click **Fork here**, change `CUST-1042` to `CUST-1041`, then click **Fork & Replay**.

CLI workflow:

```sh
npm run demo:reset

FORK_PATH=$(npm run --silent fork -- \
  traces/runs/demo-refund-failure.jsonl \
  8 \
  '{"type":"tool_call_argument","arguments":{"customer_id":"CUST-1041","amount":25}}' \
  | tail -n 1)

npm run replay -- "$FORK_PATH"
npm run diff -- traces/runs/demo-refund-failure.jsonl "$FORK_PATH"
```

Verification:

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run demo:audit
npm run e2e
npm run build
```

## How Codex and GPT-5.6 were used

ForkTrace was built in six verify-gated milestones with Codex and GPT-5.6:

- M0: typed recorder, append-only JSONL, serializable context, and SDK-event adapter.
- M1: immutable fork transformation, edit types, lineage, and source hashing.
- M2: SDK run-loop replay, stable argument normalization, memoization, divergence marking, and in-memory side effects.
- M3: evidence-only metrics, findings, and fixed-width diff output.
- M4: React/Vite timeline, local trace API, fork editor, comparison view, and E2E path.
- M5: reset tooling, 10/10 failure audit, three consecutive E2E rehearsals, and video runbook.

Codex generated and iterated on the TypeScript implementation, tests, UI, scripts, and documentation. The human reviewed milestone scope, honesty language, architecture decisions, the planted failure, each fork/replay acceptance gate, and the final demo narrative. Every milestone ended with formatting, lint, type-checking, tests, and a production build; replay additionally had a hard gate and byte-integrity evidence.

## Deployment behavior

The local app supports live record, fork, and replay because it can write `traces/runs`. The [Vercel walkthrough](https://forktrace.vercel.app) is intentionally read-only: it shows the bundled original and precomputed fork, labels the replay as precomputed, and links to the raw JSONL evidence. It does **not** fake a live replay. Run locally for an editable fork.

## Limitations

- OpenAI Agents SDK is the only agent framework; the deterministic demo uses a local SDK `Model`, so it makes no live model API request.
- Replay determinism is bounded by temperature-0 model behavior for future live-model integrations.
- The current replay runner is focused on the planted `process_refund` tool-call edit.
- Demo tools route side effects through a run-local in-memory store.
- JSONL storage is single-machine and has no database, authentication, or cross-process locking.
- Live fork/replay is local-only. Vercel serves a clearly labeled precomputed comparison because its static filesystem cannot persist new trace files.

## Additional submission material

- [Demo recording runbook](DEMO.md)
- [Devpost copy](DEVPOST.md)
- [Submission checklist](SUBMISSION.md)

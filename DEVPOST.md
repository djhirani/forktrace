# ForkTrace — Devpost description

When an AI agent fails, developers usually get a wall of logs and rerun the whole workflow. ForkTrace creates the missing debugging loop: pause at the bad observable event, change one value, replay only what follows, and compare the result with the immutable original.

The demo records a deterministic customer-refund failure involving two nearby records: J. Ahmed (`CUST-1041`) and J. Ahmad (`CUST-1042`). The original sends the wrong ID to `process_refund` and fails. A developer forks that tool call, corrects one argument, and replays. ForkTrace marks the exact `DIVERGED` point, runs the changed in-memory tool safely, and shows the original failure beside the successful fork.

ForkTrace records observable evidence only—inputs, model messages, tool calls/results, JSON state, errors, outputs, timing, and tokens. It never claims to expose hidden reasoning. Original traces are append-only JSONL; forks carry complete lineage. Exact-match tool calls use memoized recorded results without re-executing side effects, while changed calls are visibly marked and executed live.

Built with TypeScript, the OpenAI Agents SDK, React, Vite, and a six-stage Codex/GPT-5.6 verify-gated workflow. The deterministic failure passed 10/10 audits, and record → fork → replay → diff passed three consecutive E2E rehearsals.

**Category selection note:** Developer Tools / Best Use of OpenAI Agents SDK.

**Submission assets:** public repository, sub-three-minute demo video, read-only deployed walkthrough with bundled JSONL evidence, local live demo instructions, architecture README, and Codex `/feedback` Session ID.

- Public repository: https://github.com/djhirani/forktrace
- Read-only deployed walkthrough: https://forktrace.vercel.app
- Codex `/feedback` Session ID: `019f7d30-8e3e-7583-be0c-37e6a1e388c2`
- YouTube demo: `YOUTUBE_URL_HERE`

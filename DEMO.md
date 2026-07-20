# ForkTrace demo runbook

Reset immediately before recording:

```sh
npm run demo:reset
npm run dev
```

## Click path and narration

### 0:00 — Problem

- Open ForkTrace on the empty-state/run-picker view.
- Say: “When an agent fails, developers usually get a wall of logs. ForkTrace turns observable execution evidence into something we can rewind and test.”
- Click **Run demo scenario** if the seeded run is not already selected.

### 0:30 — Original failing run

- Select the red **Original** run.
- Scroll through the 13-event timeline.
- Click the recorded error and show `CUSTOMER_MISMATCH` in the detail pane.
- Say: “The requested customer is John Wheeler, but the run selected nearby record Jon Weller and sent `CUST-1042` to the refund tool.”

### 1:00 — Inspect the bad call

- Click event 8, the `process_refund` tool call.
- Show its input in the detail pane: `customer_id: CUST-1042`, `amount: 25`.
- Say: “This is observable evidence—not hidden model reasoning. The bad argument is explicit in the trace.”
- Click **Fork here**.

### 1:30 — Edit and replay

- In the editor, change only `CUST-1042` to `CUST-1041`.
- Click **Fork & Replay**.
- Say: “The original JSONL remains immutable. ForkTrace creates a lineage-stamped fork, reconstructs state at this event, and replays downstream.”

### 2:15 — Diff and divergence

- Point to the measured banner:
  - `Original: Failed | 2 tool calls | 0.0 s`
  - `Fork: Passed | 3 tool calls | 0.0 s`
- Point to **DIVERGED — live execution from here** at fork event 10.
- Say: “The changed arguments no longer match the recording, so ForkTrace marks the exact divergence and executes the safe in-memory tool live.”

### 2:45 — Finding and close

- Point to: **Fork recorded 1 first divergence at event 10 for process_refund.**
- Show its evidence citation: **fork event 10**.
- Say: “One edit changed failure to success, and every number and finding comes from recorded events. ForkTrace: Agent failed? Rewind it. Fix one step. Replay from there.”

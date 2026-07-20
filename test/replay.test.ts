import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { forkRun } from "../src/fork.js";
import { JsonlTraceRecorder, readTrace } from "../src/recorder.js";
import {
  InMemoryRefundStore,
  reconstructReplayState,
  replayFork,
  stableStringify,
} from "../src/replay.js";
import type { NewTraceEvent, TraceEvent } from "../src/types.js";

const base = (overrides: Partial<NewTraceEvent>): NewTraceEvent => ({
  event_type: "context_snapshot",
  input: null,
  output: null,
  context_snapshot: null,
  tool_name: null,
  tool_call_id: null,
  status: "completed",
  latency_ms: null,
  token_usage: null,
  ...overrides,
});

async function createOriginal(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "forktrace-replay-"));
  const path = join(directory, "original.jsonl");
  const recorder = await JsonlTraceRecorder.create(path, {
    runId: "original-run",
  });
  await recorder.append(
    base({
      event_type: "run_started",
      output: { model: "forktrace-deterministic-customer-support-v1" },
    }),
  );
  await recorder.append(
    base({ event_type: "user_input", input: "Refund John Wheeler" }),
  );
  await recorder.append(
    base({
      event_type: "context_snapshot",
      context_snapshot: {
        selected_customer_id: "CUST-1042",
        poison_after_fork: false,
      },
    }),
  );
  await recorder.append(
    base({
      event_type: "model_output",
      output: { decision: "process_refund" },
    }),
  );
  await recorder.append(
    base({
      event_type: "tool_call",
      input: { customer_id: "CUST-1042", amount: 25, currency: "USD" },
      tool_name: "process_refund",
      tool_call_id: "refund-original",
      status: "started",
    }),
  );
  await recorder.append(
    base({
      event_type: "tool_result",
      output: {
        ok: false,
        error: "Customer ID does not match the requested customer",
      },
      tool_name: "process_refund",
      tool_call_id: "refund-original",
      status: "failed",
    }),
  );
  await recorder.append(
    base({ event_type: "run_completed", status: "failed" }),
  );
  return path;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

void test("reconstructs messages and context only through fork_at_event", async () => {
  const originalPath = await createOriginal();
  const forkPath = await forkRun(originalPath, 4, {
    type: "tool_call_argument",
    arguments: { customer_id: "CUST-1041", amount: 25, currency: "USD" },
  });
  const fork = await readTrace(forkPath);
  const poison = {
    ...fork[2],
    event_index: 5,
    event_type: "context_snapshot",
    context_snapshot: { poison_after_fork: true },
  } as TraceEvent;
  const state = reconstructReplayState([...fork, poison]);

  assert.deepEqual(state.contextSnapshot, {
    selected_customer_id: "CUST-1042",
    poison_after_fork: false,
  });
  assert.deepEqual(
    state.messageHistory.map(({ event_index }) => event_index),
    [1, 3],
  );
});

void test("a corrected fork diverges at the edit, executes live, and passes", async () => {
  const originalPath = await createOriginal();
  const originalHash = await sha256(originalPath);
  const forkPath = await forkRun(originalPath, 4, {
    type: "tool_call_argument",
    arguments: { amount: 25, currency: "USD", customer_id: "CUST-1041" },
  });
  const store = new InMemoryRefundStore();
  const result = await replayFork(forkPath, { store });
  const replayed = await readTrace(forkPath);
  const divergedIndex = replayed.findIndex(
    ({ event_type }) => event_type === "diverged",
  );

  assert.equal(result.summary.status, "ok");
  assert.equal(result.summary.temperature, 0);
  assert.equal(result.summary.live_tool_calls, 1);
  assert.equal(result.summary.memoized_tool_calls, 0);
  assert.equal(result.summary.diverged_events, 1);
  assert.equal(store.executionCount, 1);
  assert.equal(replayed[divergedIndex]?.last_matching_event_index, 3);
  assert.equal(replayed[divergedIndex + 1]?.event_type, "tool_call");
  assert.equal(replayed.at(-2)?.event_type, "final_output");
  assert.equal(replayed.at(-2)?.status, "ok");
  assert.equal(replayed.at(-1)?.event_type, "run_completed");
  assert.equal(replayed.at(-1)?.status, "ok");
  assert.deepEqual(
    replayed.map(({ event_index }) => event_index),
    replayed.map((_, index) => index),
  );
  assert.equal(await sha256(originalPath), originalHash);
});

void test("a no-op fork memoizes the tool without executing its body or diverging", async () => {
  const originalPath = await createOriginal();
  const forkPath = await forkRun(originalPath, 4, {
    type: "tool_call_argument",
    arguments: { customer_id: "CUST-1042", amount: 25, currency: "USD" },
  });
  const store = new InMemoryRefundStore();
  const result = await replayFork(forkPath, { store });
  const replayed = await readTrace(forkPath);

  assert.equal(result.summary.live_tool_calls, 0);
  assert.equal(result.summary.memoized_tool_calls, 1);
  assert.equal(result.summary.diverged_events, 0);
  assert.equal(store.executionCount, 0);
  assert.equal(
    replayed.some(({ event_type }) => event_type === "diverged"),
    false,
  );
  assert.equal(
    replayed.some(
      ({ replayed_from_recording }) => replayed_from_recording === true,
    ),
    true,
  );
});

void test("normalizes nested object keys while preserving array order", () => {
  assert.equal(
    stableStringify({ z: 1, a: { y: 2, x: [3, 4] } }),
    stableStringify({ a: { x: [3, 4], y: 2 }, z: 1 }),
  );
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
});

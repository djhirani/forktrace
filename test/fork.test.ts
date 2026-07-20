import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ForkError, forkRun, type ForkEdit } from "../src/fork.js";
import { JsonlTraceRecorder, readTrace } from "../src/recorder.js";
import type { NewTraceEvent } from "../src/types.js";

const base = (event: Partial<NewTraceEvent>): NewTraceEvent => ({
  event_type: "context_snapshot",
  input: null,
  output: null,
  context_snapshot: null,
  tool_name: null,
  tool_call_id: null,
  status: "completed",
  latency_ms: null,
  token_usage: null,
  ...event,
});

async function sourceTrace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "forktrace-fork-"));
  const path = join(directory, "original.jsonl");
  const recorder = await JsonlTraceRecorder.create(path, {
    runId: "original-run",
  });
  await recorder.append(base({ event_type: "run_started" }));
  await recorder.append(
    base({ event_type: "user_input", input: "Refund John Wheeler" }),
  );
  await recorder.append(
    base({
      event_type: "context_snapshot",
      context_snapshot: {
        requested_customer_id: "CUST-1041",
        selected_customer_id: "CUST-1042",
      },
    }),
  );
  await recorder.append(
    base({
      event_type: "tool_call",
      input: { customer_id: "CUST-1042", amount: 25, currency: "USD" },
      tool_name: "process_refund",
      tool_call_id: "refund-1",
      status: "started",
    }),
  );
  await recorder.append(
    base({
      event_type: "tool_result",
      output: { ok: false, error: "customer mismatch" },
      tool_name: "process_refund",
      tool_call_id: "refund-1",
      status: "failed",
    }),
  );
  return path;
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

void test("forks through N, stamps lineage, edits N, and preserves source bytes", async () => {
  const sourcePath = await sourceTrace();
  const before = await sha256(sourcePath);
  const forkPath = await forkRun(sourcePath, 3, {
    type: "tool_call_argument",
    arguments: { customer_id: "CUST-1041", amount: 25, currency: "USD" },
  });
  const fork = await readTrace(forkPath);

  assert.equal(fork.length, 4);
  assert.deepEqual(
    fork.map(({ event_index }) => event_index),
    [0, 1, 2, 3],
  );
  assert.ok(fork.every(({ run_id }) => run_id === fork[0]?.run_id));
  assert.ok(
    fork.every(({ parent_run_id }) => parent_run_id === "original-run"),
  );
  assert.ok(
    fork.every(
      ({ forked_from_run_id }) => forked_from_run_id === "original-run",
    ),
  );
  assert.ok(fork.every(({ fork_at_event }) => fork_at_event === 3));
  assert.deepEqual(fork[3]?.input, {
    customer_id: "CUST-1041",
    amount: 25,
    currency: "USD",
  });
  assert.equal(fork[3].status, "ok");
  assert.equal(fork[3].edited, true);
  assert.equal(await sha256(sourcePath), before);
  assert.deepEqual(JSON.parse(JSON.stringify(fork[2]?.context_snapshot)), {
    requested_customer_id: "CUST-1041",
    selected_customer_id: "CUST-1042",
  });
});

void test("supports tool-result and instruction edit variants", async () => {
  const resultSource = await sourceTrace();
  const resultFork = await readTrace(
    await forkRun(resultSource, 4, {
      type: "tool_result",
      output: { ok: true, refund_id: "refund-123" },
    }),
  );
  assert.deepEqual(resultFork[4]?.output, {
    ok: true,
    refund_id: "refund-123",
  });

  const instructionSource = await sourceTrace();
  const instructionFork = await readTrace(
    await forkRun(instructionSource, 1, {
      type: "instruction",
      content: "Use exact customer IDs.",
      mode: "append",
    }),
  );
  assert.equal(
    instructionFork[1]?.input,
    "Refund John Wheeler\nUse exact customer IDs.",
  );
  assert.equal(instructionFork[1].edited, true);
});

void test("rejects invalid indexes, edit kinds, and edit targets with typed errors", async () => {
  const sourcePath = await sourceTrace();
  await assert.rejects(
    forkRun(sourcePath, 99, { type: "tool_result", output: null }),
    (error) => {
      assert.ok(error instanceof ForkError);
      assert.equal(error.code, "INVALID_EVENT_INDEX");
      return true;
    },
  );
  await assert.rejects(
    forkRun(sourcePath, 3, { type: "unsupported" } as unknown as ForkEdit),
    (error) => {
      assert.ok(error instanceof ForkError);
      assert.equal(error.code, "INVALID_EDIT");
      return true;
    },
  );
  await assert.rejects(
    forkRun(sourcePath, 1, {
      type: "tool_call_argument",
      arguments: { customer_id: "CUST-1041" },
    }),
    (error) => {
      assert.ok(error instanceof ForkError);
      assert.equal(error.code, "EDIT_TARGET_MISMATCH");
      return true;
    },
  );
});

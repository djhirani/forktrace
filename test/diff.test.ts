import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DiffError, diffRuns, renderDiffText } from "../src/diff.js";
import { JsonlTraceRecorder, readTrace } from "../src/recorder.js";

const { originalPath, forkPath } = await createFixture();

async function createFixture(): Promise<{
  originalPath: string;
  forkPath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "forktrace-diff-fixture-"));
  const originalPath = join(directory, "original.jsonl");
  const forkPath = join(directory, "original.fork-fixture.jsonl");
  const original = await JsonlTraceRecorder.create(originalPath, {
    runId: "original-run",
  });
  await original.append(event({ event_type: "run_started" }));
  await original.append(
    event({
      event_type: "tool_call",
      input: { customer_id: "CUST-1042", amount: 25 },
      tool_name: "process_refund",
      tool_call_id: "original-call",
      status: "started",
      latency_ms: 100,
    }),
  );
  await original.append(
    event({
      event_type: "tool_result",
      output: { ok: false },
      tool_name: "process_refund",
      tool_call_id: "original-call",
      status: "failed",
      latency_ms: 50,
      token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
  );
  await original.append(
    event({ event_type: "run_completed", status: "failed" }),
  );

  const fork = await JsonlTraceRecorder.create(forkPath, {
    runId: "fork-run",
    lineage: {
      parent_run_id: "original-run",
      forked_from_run_id: "original-run",
      fork_at_event: 1,
    },
  });
  await fork.append(event({ event_type: "run_started" }));
  await fork.append(
    event({
      event_type: "tool_call",
      input: { customer_id: "CUST-1041", amount: 25 },
      tool_name: "process_refund",
      tool_call_id: "original-call",
      status: "ok",
      latency_ms: 100,
      edited: true,
    }),
  );
  await fork.append(
    event({
      event_type: "diverged",
      tool_name: "process_refund",
      status: "diverged",
      last_matching_event_index: 0,
    }),
  );
  await fork.append(
    event({
      event_type: "tool_call",
      input: { customer_id: "CUST-1041", amount: 25 },
      tool_name: "process_refund",
      tool_call_id: "replay-call",
      status: "ok",
    }),
  );
  await fork.append(
    event({
      event_type: "tool_result",
      output: { ok: true },
      tool_name: "process_refund",
      tool_call_id: "replay-call",
      status: "ok",
    }),
  );
  await fork.append(
    event({ event_type: "final_output", output: { ok: true }, status: "ok" }),
  );
  await fork.append(event({ event_type: "run_completed", status: "ok" }));
  return { originalPath, forkPath };
}

function event(
  overrides: Partial<Parameters<JsonlTraceRecorder["append"]>[0]>,
): Parameters<JsonlTraceRecorder["append"]>[0] {
  return {
    event_type: "context_snapshot",
    input: null,
    output: null,
    context_snapshot: null,
    tool_name: null,
    tool_call_id: null,
    status: "ok",
    latency_ms: null,
    token_usage: null,
    ...overrides,
  };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

void test("computes exact fixture metrics and edit evidence from the logs", async () => {
  const [originalHash, forkHash] = await Promise.all([
    sha256(originalPath),
    sha256(forkPath),
  ]);
  const report = await diffRuns(originalPath, forkPath);

  assert.deepEqual(report.original, {
    status: "failed",
    tool_calls: 1,
    total_latency_ms: 150,
    token_usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    event_count: 4,
  });
  assert.deepEqual(report.fork, {
    status: "passed",
    tool_calls: 2,
    total_latency_ms: 100,
    token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    event_count: 7,
  });
  assert.equal(report.lineage.fork_at_event, 1);
  assert.deepEqual(report.edit.before, {
    customer_id: "CUST-1042",
    amount: 25,
  });
  assert.deepEqual(report.edit.after, {
    customer_id: "CUST-1041",
    amount: 25,
  });
  assert.equal(report.first_divergence_event_index, 2);
  assert.equal(report.diverged_tool_name, "process_refund");
  assert.equal(await sha256(originalPath), originalHash);
  assert.equal(await sha256(forkPath), forkHash);
});

void test("every finding cites event indexes that exist in its named trace", async () => {
  const [report, original, fork] = await Promise.all([
    diffRuns(originalPath, forkPath),
    readTrace(originalPath),
    readTrace(forkPath),
  ]);
  const indexes = {
    original: new Set(original.map(({ event_index }) => event_index)),
    fork: new Set(fork.map(({ event_index }) => event_index)),
  };

  assert.ok(report.findings.length > 0);
  for (const finding of report.findings) {
    assert.ok(finding.evidence.length > 0);
    for (const evidence of finding.evidence) {
      assert.ok(evidence.event_indexes.length > 0);
      assert.ok(
        evidence.event_indexes.every((index) =>
          indexes[evidence.trace].has(index),
        ),
      );
    }
  }
});

void test("rejects traces without a lineage relationship using a typed error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forktrace-diff-"));
  const unrelatedPath = join(directory, "unrelated.jsonl");
  const recorder = await JsonlTraceRecorder.create(unrelatedPath, {
    runId: "unrelated-run",
  });
  await recorder.append({
    event_type: "run_started",
    input: null,
    output: null,
    context_snapshot: null,
    tool_name: null,
    tool_call_id: null,
    status: "ok",
    latency_ms: null,
    token_usage: null,
  });

  await assert.rejects(diffRuns(unrelatedPath, forkPath), (error) => {
    assert.ok(error instanceof DiffError);
    assert.equal(error.code, "UNRELATED_RUNS");
    return true;
  });
});

void test("renders the exact fixed-width demo summary", async () => {
  assert.equal(
    renderDiffText(await diffRuns(originalPath, forkPath)),
    [
      "Original: Failed | 1 tool calls |  0.1 s",
      "Fork:     Passed | 2 tool calls |  0.1 s",
    ].join("\n"),
  );
});

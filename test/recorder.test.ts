import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { JsonlTraceRecorder, readTrace } from "../src/recorder.js";
import type { JsonObject, NewTraceEvent } from "../src/types.js";

const event = (
  output: string,
  context: JsonObject = { count: 1 },
): NewTraceEvent => ({
  event_type: "context_snapshot",
  input: null,
  output,
  context_snapshot: context,
  tool_name: null,
  tool_call_id: null,
  status: "completed",
  latency_ms: null,
  token_usage: null,
});

void test("appends ordered, monotonic JSONL with lineage and round-trip-safe snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forktrace-"));
  const path = join(directory, "run.jsonl");
  const recorder = await JsonlTraceRecorder.create(path, { runId: "run-1" });
  await Promise.all([
    recorder.append(event("first")),
    recorder.append(event("second", { count: 2 })),
  ]);

  const rawLines = (await readFile(path, "utf8")).trim().split("\n");
  const stored = await readTrace(path);
  assert.equal(rawLines.length, 2);
  assert.deepEqual(
    stored.map(({ event_index, output }) => ({ event_index, output })),
    [
      { event_index: 0, output: "first" },
      { event_index: 1, output: "second" },
    ],
  );
  assert.deepEqual(JSON.parse(JSON.stringify(stored[1]?.context_snapshot)), {
    count: 2,
  });
  for (const item of stored) {
    assert.ok("parent_run_id" in item);
    assert.ok("forked_from_run_id" in item);
    assert.ok("fork_at_event" in item);
  }
});

void test("returned events cannot mutate the stored log or recorder state", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forktrace-"));
  const path = join(directory, "run.jsonl");
  const recorder = await JsonlTraceRecorder.create(path);
  const returned = await recorder.append(event("original"));
  assert.throws(
    () => Object.assign(returned, { output: "changed" }),
    TypeError,
  );
  assert.equal((await readTrace(path))[0]?.output, "original");
  assert.equal(
    typeof (recorder as unknown as { update?: unknown }).update,
    "undefined",
  );
});

void test("rejects context snapshots that lose data during JSON serialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "forktrace-"));
  const recorder = await JsonlTraceRecorder.create(
    join(directory, "run.jsonl"),
  );
  const invalid = {
    present: true,
    missing: undefined,
  } as unknown as JsonObject;
  await assert.rejects(recorder.append(event("invalid", invalid)), /data loss/);
});

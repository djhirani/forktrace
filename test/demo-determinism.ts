import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordDemoRun } from "../src/demo-run.js";
import { readTrace } from "../src/recorder.js";

const directory = await mkdtemp(join(tmpdir(), "forktrace-audit-"));
try {
  for (let run = 1; run <= 10; run += 1) {
    const path = join(directory, `audit-${String(run)}.jsonl`);
    await recordDemoRun(path, `audit-run-${String(run)}`);
    const events = await readTrace(path);
    const refundCall = events.find(
      ({ event_type, tool_name }) =>
        event_type === "tool_call" && tool_name === "process_refund",
    );
    const refundResult = events.find(
      ({ event_type, tool_name }) =>
        event_type === "tool_result" && tool_name === "process_refund",
    );
    const error = events.find(({ event_type }) => event_type === "error");
    const terminal = events.at(-1);

    assert.deepEqual(refundCall?.input, {
      customer_id: "CUST-1042",
      amount: 25,
      currency: "USD",
    });
    assert.equal(refundResult?.status, "failed");
    assert.deepEqual(error?.output, {
      code: "CUSTOMER_MISMATCH",
      customer_id: "CUST-1042",
    });
    assert.equal(terminal?.event_type, "run_completed");
    assert.equal(terminal.status, "failed");
    console.log(
      `Audit run ${String(run)}/10: structural CUSTOMER_MISMATCH failure`,
    );
  }
  console.log(
    "DETERMINISM PASS: 10/10 runs failed for the planted wrong customer ID",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

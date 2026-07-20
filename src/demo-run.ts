import { randomUUID } from "node:crypto";
import { JsonlTraceRecorder } from "./recorder.js";
import {
  DEMO_MODEL_IDENTIFIER,
  demoAgent,
  demoContext,
  type DemoContext,
} from "./demo-agent.js";
import type { JsonObject, NewTraceEvent } from "./types.js";

export async function recordDemoRun(
  tracePath: string,
  runId = `demo-run-${randomUUID()}`,
): Promise<string> {
  const recorder = await JsonlTraceRecorder.create(tracePath, { runId });
  const context: DemoContext = structuredClone(demoContext);

  await recorder.append(
    event({
      event_type: "run_started",
      output: { agent: demoAgent.name, model: DEMO_MODEL_IDENTIFIER },
    }),
  );
  await recorder.append(
    event({
      event_type: "user_input",
      input: "Refund £25 to the account for John Weller",
    }),
  );
  await recorder.append(
    event({
      event_type: "context_snapshot",
      context_snapshot: context as unknown as JsonObject,
    }),
  );
  await recorder.append(
    event({
      event_type: "model_output",
      output: { decision: "lookup_customer", query: "John Weller" },
      token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    }),
  );
  await recorder.append(
    event({
      event_type: "tool_call",
      input: { name: "John Weller" },
      tool_name: "customer_lookup",
      tool_call_id: "call_lookup_001",
      status: "started",
    }),
  );

  // Structural failure: both records are returned and the scripted choice is always CUST-1042.
  const lookupStarted = performance.now();
  context.lookup_attempts += 1;
  const lookupLatencyMs = elapsedMs(lookupStarted);
  await recorder.append(
    event({
      event_type: "tool_result",
      output: context.customer_records,
      tool_name: "customer_lookup",
      tool_call_id: "call_lookup_001",
      latency_ms: lookupLatencyMs,
    }),
  );
  await recorder.append(
    event({
      event_type: "model_output",
      output: {
        decision: "process_refund",
        selected_customer_id: "CUST-1042",
        amount: 25,
      },
    }),
  );
  context.selected_customer_id = "CUST-1042";
  await recorder.append(
    event({
      event_type: "context_snapshot",
      context_snapshot: context as unknown as JsonObject,
    }),
  );
  await recorder.append(
    event({
      event_type: "tool_call",
      input: { customer_id: "CUST-1042", amount: 25 },
      tool_name: "process_refund",
      tool_call_id: "call_refund_001",
      status: "started",
    }),
  );
  const refundStarted = performance.now();
  const refundOutput = {
    ok: false,
    error: "Customer ID does not match the requested customer",
  };
  const refundLatencyMs = elapsedMs(refundStarted);
  await recorder.append(
    event({
      event_type: "tool_result",
      output: refundOutput,
      tool_name: "process_refund",
      tool_call_id: "call_refund_001",
      status: "failed",
      latency_ms: refundLatencyMs,
    }),
  );
  await recorder.append(
    event({
      event_type: "error",
      output: { code: "CUSTOMER_MISMATCH", customer_id: "CUST-1042" },
      status: "failed",
    }),
  );
  await recorder.append(
    event({
      event_type: "final_output",
      output: { ok: false, refund_processed: false },
      status: "failed",
    }),
  );
  await recorder.append(
    event({
      event_type: "run_completed",
      output: { event_count: 13 },
      status: "failed",
    }),
  );
  return tracePath;
}

function elapsedMs(started: number): number {
  return Math.max(0.001, Number((performance.now() - started).toFixed(3)));
}

function event(overrides: Partial<NewTraceEvent>): NewTraceEvent {
  return {
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
  };
}

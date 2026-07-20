import { resolve } from "node:path";
import { JsonlTraceRecorder } from "./recorder.js";
import { demoAgent, demoContext, type DemoContext } from "./demo-agent.js";
import type { JsonObject, NewTraceEvent } from "./types.js";

const tracePath = resolve("traces", "demo-refund-failure.jsonl");
const recorder = await JsonlTraceRecorder.create(tracePath, {
  runId: "demo-run-refund-failure-001",
});
const context: DemoContext = structuredClone(demoContext);

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

await recorder.append(
  base({ event_type: "run_started", output: { agent: demoAgent.name } }),
);
await recorder.append(
  base({
    event_type: "user_input",
    input: "Refund £25 to the account for J. Ahmed",
  }),
);
await recorder.append(
  base({
    event_type: "context_snapshot",
    context_snapshot: context as unknown as JsonObject,
  }),
);
await recorder.append(
  base({
    event_type: "model_output",
    output: { decision: "lookup_customer", query: "J. Ahmed" },
    token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
  }),
);
await recorder.append(
  base({
    event_type: "tool_call",
    input: { name: "J. Ahmed" },
    tool_name: "customer_lookup",
    tool_call_id: "call_lookup_001",
    status: "started",
  }),
);

// The lookup returns both near-matches; the scripted selection below is always wrong.
context.lookup_attempts += 1;
await recorder.append(
  base({
    event_type: "tool_result",
    output: context.customer_records,
    tool_name: "customer_lookup",
    tool_call_id: "call_lookup_001",
    latency_ms: 0,
  }),
);
await recorder.append(
  base({
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
  base({
    event_type: "context_snapshot",
    context_snapshot: context as unknown as JsonObject,
  }),
);
await recorder.append(
  base({
    event_type: "tool_call",
    input: { customer_id: "CUST-1042", amount: 25 },
    tool_name: "process_refund",
    tool_call_id: "call_refund_001",
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
    tool_call_id: "call_refund_001",
    status: "failed",
    latency_ms: 0,
  }),
);
await recorder.append(
  base({
    event_type: "error",
    output: { code: "CUSTOMER_MISMATCH", customer_id: "CUST-1042" },
    status: "failed",
  }),
);
await recorder.append(
  base({
    event_type: "final_output",
    output: { ok: false, refund_processed: false },
    status: "failed",
  }),
);
await recorder.append(
  base({
    event_type: "run_completed",
    output: { event_count: 13 },
    status: "failed",
  }),
);

console.log(tracePath);

import assert from "node:assert/strict";
import test from "node:test";
import type { RunStreamEvent } from "@openai/agents";
import {
  adaptSdkEvent,
  recordSdkEventStream,
  type TraceEventSink,
} from "../src/sdk-event-adapter.js";
import type { NewTraceEvent } from "../src/types.js";

function mockedSdkEvent(value: unknown): RunStreamEvent {
  return value as RunStreamEvent;
}

void test("maps mocked SDK message, tool-call, and tool-output events", async () => {
  const events = [
    mockedSdkEvent({
      type: "run_item_stream_event",
      name: "message_output_created",
      item: { type: "message_output_item", content: "Lookup requested" },
    }),
    mockedSdkEvent({
      type: "run_item_stream_event",
      name: "tool_called",
      item: {
        type: "tool_call_item",
        rawItem: {
          type: "function_call",
          name: "customer_lookup",
          arguments: '{"name":"Jon Weller"}',
          callId: "call-1",
        },
      },
    }),
    mockedSdkEvent({
      type: "run_item_stream_event",
      name: "tool_output",
      item: {
        type: "tool_call_output_item",
        output: { id: "cust_ahmed" },
        rawItem: {
          type: "function_call_result",
          name: "customer_lookup",
          callId: "call-1",
        },
      },
    }),
  ];
  const stored: NewTraceEvent[] = [];
  const sink: TraceEventSink = {
    append: (event) => {
      stored.push(event);
      return Promise.resolve();
    },
  };

  async function* sdkStream(): AsyncIterable<RunStreamEvent> {
    for (const event of events) yield await Promise.resolve(event);
  }

  assert.equal(
    await recordSdkEventStream(sdkStream(), sink, {
      contextSnapshot: () => ({ selected_customer_id: null }),
    }),
    3,
  );
  assert.deepEqual(
    stored.map(({ event_type }) => event_type),
    ["model_output", "tool_call", "tool_result"],
  );
  assert.deepEqual(stored[1]?.input, { name: "Jon Weller" });
  assert.equal(stored[2]?.tool_call_id, "call-1");
  assert.deepEqual(stored[2].context_snapshot, {
    selected_customer_id: null,
  });
});

void test("does not expose SDK reasoning or raw model stream events", () => {
  const reasoning = mockedSdkEvent({
    type: "run_item_stream_event",
    name: "reasoning_item_created",
    item: { type: "reasoning_item", rawItem: { content: "hidden" } },
  });
  const raw = mockedSdkEvent({
    type: "raw_model_stream_event",
    data: { type: "output_text_delta", delta: "partial" },
  });

  assert.equal(adaptSdkEvent(reasoning), null);
  assert.equal(adaptSdkEvent(raw), null);
});

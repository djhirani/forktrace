import type { RunStreamEvent } from "@openai/agents";
import { assertJsonRoundTrip } from "./json.js";
import type { JsonObject, JsonValue, NewTraceEvent } from "./types.js";

export interface TraceEventSink {
  append(event: NewTraceEvent): Promise<unknown>;
}

export interface SdkEventAdapterOptions {
  contextSnapshot?: () => JsonObject | null;
}

export function adaptSdkEvent(
  event: RunStreamEvent,
  options: SdkEventAdapterOptions = {},
): NewTraceEvent | null {
  if (event.type !== "run_item_stream_event") return null;

  const contextSnapshot = options.contextSnapshot?.() ?? null;
  if (event.name === "message_output_created") {
    if (event.item.type !== "message_output_item") return null;
    return baseEvent({
      event_type: "model_output",
      output: event.item.content,
      context_snapshot: contextSnapshot,
    });
  }

  if (event.name === "tool_called") {
    if (event.item.type !== "tool_call_item") return null;
    const raw = event.item.rawItem;
    return baseEvent({
      event_type: "tool_call",
      input:
        "arguments" in raw && typeof raw.arguments === "string"
          ? parseArguments(raw.arguments)
          : null,
      context_snapshot: contextSnapshot,
      tool_name: "name" in raw ? raw.name : raw.type,
      tool_call_id: "callId" in raw ? raw.callId : (raw.id ?? null),
      status: "started",
    });
  }

  if (event.name === "tool_output") {
    if (event.item.type !== "tool_call_output_item") return null;
    const raw = event.item.rawItem;
    return baseEvent({
      event_type: "tool_result",
      output: toJsonValue(event.item.output),
      context_snapshot: contextSnapshot,
      tool_name: "name" in raw ? raw.name : resultToolName(raw.type),
      tool_call_id: "callId" in raw ? raw.callId : null,
    });
  }

  // Reasoning items and non-M0 SDK orchestration events are intentionally not stored.
  return null;
}

export async function recordSdkEventStream(
  events: AsyncIterable<RunStreamEvent>,
  sink: TraceEventSink,
  options: SdkEventAdapterOptions = {},
): Promise<number> {
  let recorded = 0;
  for await (const sdkEvent of events) {
    const traceEvent = adaptSdkEvent(sdkEvent, options);
    if (traceEvent !== null) {
      await sink.append(traceEvent);
      recorded += 1;
    }
  }
  return recorded;
}

function baseEvent(overrides: Partial<NewTraceEvent>): NewTraceEvent {
  return {
    event_type: "model_output",
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

function parseArguments(argumentsJson: string): JsonValue {
  try {
    return toJsonValue(JSON.parse(argumentsJson));
  } catch {
    return argumentsJson;
  }
}

function toJsonValue(value: unknown): JsonValue {
  return assertJsonRoundTrip(value) as JsonValue;
}

function resultToolName(type: string): string {
  return type.replace(/_result$/, "").replace(/_output$/, "");
}

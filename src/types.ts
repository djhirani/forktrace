export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export const eventTypes = [
  "run_started",
  "user_input",
  "model_output",
  "tool_call",
  "tool_result",
  "context_snapshot",
  "error",
  "final_output",
  "run_completed",
  "diverged",
] as const;

export type EventType = (typeof eventTypes)[number];
export type EventStatus =
  "started" | "completed" | "failed" | "ok" | "diverged";

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
}

export interface TraceEvent {
  event_index: number;
  event_id: string;
  run_id: string;
  parent_run_id: string | null;
  forked_from_run_id: string | null;
  fork_at_event: number | null;
  event_type: EventType;
  timestamp: string;
  input: JsonValue;
  output: JsonValue;
  context_snapshot: JsonObject | null;
  tool_name: string | null;
  tool_call_id: string | null;
  status: EventStatus;
  latency_ms: number | null;
  token_usage: TokenUsage | null;
  edited?: true;
  replayed_from_recording?: true;
  last_matching_event_index?: number | null;
}

export type NewTraceEvent = Omit<
  TraceEvent,
  | "event_index"
  | "event_id"
  | "run_id"
  | "parent_run_id"
  | "forked_from_run_id"
  | "fork_at_event"
  | "timestamp"
>;

export interface RunLineage {
  parent_run_id: string | null;
  forked_from_run_id: string | null;
  fork_at_event: number | null;
}

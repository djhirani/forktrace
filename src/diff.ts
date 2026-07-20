import { readTrace } from "./recorder.js";
import type {
  EventStatus,
  JsonValue,
  TokenUsage,
  TraceEvent,
} from "./types.js";

export interface RunMetrics {
  status: "passed" | "failed";
  tool_calls: number;
  total_latency_ms: number;
  token_usage: TokenUsage;
  event_count: number;
}

export interface EditSummary {
  event_index: number;
  event_type: TraceEvent["event_type"];
  tool_name: string | null;
  before: JsonValue;
  after: JsonValue;
}

export interface FindingEvidence {
  trace: "original" | "fork";
  event_indexes: number[];
}

export interface DiffFinding {
  message: string;
  evidence: FindingEvidence[];
}

export interface DiffReport {
  original: RunMetrics;
  fork: RunMetrics;
  lineage: {
    forked_from_run_id: string;
    fork_at_event: number;
  };
  edit: EditSummary;
  first_divergence_event_index: number | null;
  diverged_tool_name: string | null;
  findings: DiffFinding[];
}

export type DiffErrorCode = "EMPTY_TRACE" | "UNRELATED_RUNS" | "MISSING_EDIT";

export class DiffError extends Error {
  readonly code: DiffErrorCode;

  constructor(code: DiffErrorCode, message: string) {
    super(message);
    this.name = "DiffError";
    this.code = code;
  }
}

export async function diffRuns(
  originalTracePath: string,
  forkTracePath: string,
): Promise<DiffReport> {
  const [originalEvents, forkEvents] = await Promise.all([
    readTrace(originalTracePath),
    readTrace(forkTracePath),
  ]);
  const originalFirst = originalEvents[0];
  const forkFirst = forkEvents[0];
  if (originalFirst === undefined || forkFirst === undefined) {
    throw new DiffError("EMPTY_TRACE", "Both traces must contain events");
  }
  if (
    forkFirst.forked_from_run_id !== originalFirst.run_id ||
    forkFirst.parent_run_id !== originalFirst.run_id ||
    forkFirst.fork_at_event === null
  ) {
    throw new DiffError(
      "UNRELATED_RUNS",
      "Fork lineage does not reference the supplied original run",
    );
  }

  const edited = forkEvents.find((event) => event.edited === true);
  if (edited === undefined) {
    throw new DiffError("MISSING_EDIT", "Fork trace has no edited event");
  }
  const originalEdited = originalEvents.find(
    ({ event_index }) => event_index === edited.event_index,
  );
  if (originalEdited === undefined) {
    throw new DiffError(
      "MISSING_EDIT",
      "Edited event index does not exist in the original trace",
    );
  }
  const divergence = forkEvents.find(
    ({ event_type }) => event_type === "diverged",
  );
  const original = metrics(originalEvents);
  const fork = metrics(forkEvents);

  return {
    original,
    fork,
    lineage: {
      forked_from_run_id: forkFirst.forked_from_run_id,
      fork_at_event: forkFirst.fork_at_event,
    },
    edit: {
      event_index: edited.event_index,
      event_type: edited.event_type,
      tool_name: edited.tool_name,
      before: editedValue(originalEdited),
      after: editedValue(edited),
    },
    first_divergence_event_index: divergence?.event_index ?? null,
    diverged_tool_name: divergence?.tool_name ?? null,
    findings: buildFindings(
      originalEvents,
      forkEvents,
      original,
      fork,
      divergence,
    ),
  };
}

export function renderDiffText(report: DiffReport): string {
  return [
    renderLine("Original:", report.original),
    renderLine("Fork:", report.fork),
  ].join("\n");
}

function metrics(events: TraceEvent[]): RunMetrics {
  return {
    status: finalStatus(events),
    tool_calls: events.filter(({ event_type }) => event_type === "tool_call")
      .length,
    total_latency_ms: events.reduce(
      (total, event) => total + (event.latency_ms ?? 0),
      0,
    ),
    token_usage: events.reduce<TokenUsage>(
      (total, event) => ({
        input_tokens:
          total.input_tokens + (event.token_usage?.input_tokens ?? 0),
        output_tokens:
          total.output_tokens + (event.token_usage?.output_tokens ?? 0),
        total_tokens:
          total.total_tokens + (event.token_usage?.total_tokens ?? 0),
      }),
      { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    ),
    event_count: events.length,
  };
}

function finalStatus(events: TraceEvent[]): "passed" | "failed" {
  const terminal = terminalEvent(events);
  if (terminal === undefined) {
    return events.some(
      ({ event_type, status }) => event_type === "error" || isFailure(status),
    )
      ? "failed"
      : "passed";
  }
  return isFailure(terminal.status) ? "failed" : "passed";
}

function isFailure(status: EventStatus): boolean {
  return status === "failed";
}

function editedValue(event: TraceEvent): JsonValue {
  return event.event_type === "tool_result" ? event.output : event.input;
}

function buildFindings(
  originalEvents: TraceEvent[],
  forkEvents: TraceEvent[],
  original: RunMetrics,
  fork: RunMetrics,
  divergence: TraceEvent | undefined,
): DiffFinding[] {
  const originalTerminal = terminalEvent(originalEvents);
  const forkTerminal = terminalEvent(forkEvents);
  const findings: DiffFinding[] = [];
  if (divergence !== undefined) {
    findings.push({
      message: `Fork recorded 1 first divergence at event ${String(divergence.event_index)} for ${divergence.tool_name ?? "an unnamed tool"}.`,
      evidence: [{ trace: "fork", event_indexes: [divergence.event_index] }],
    });
  }
  if (
    original.status !== fork.status &&
    originalTerminal !== undefined &&
    forkTerminal !== undefined
  ) {
    findings.push({
      message: `Recorded final status changed from ${capitalize(original.status)} to ${capitalize(fork.status)}.`,
      evidence: [
        { trace: "original", event_indexes: [originalTerminal.event_index] },
        { trace: "fork", event_indexes: [forkTerminal.event_index] },
      ],
    });
  }
  if (findings.length === 0) {
    const originalCalls = originalEvents
      .filter(({ event_type }) => event_type === "tool_call")
      .map(({ event_index }) => event_index);
    const forkCalls = forkEvents
      .filter(({ event_type }) => event_type === "tool_call")
      .map(({ event_index }) => event_index);
    findings.push({
      message: `Recorded tool-call count changed from ${String(original.tool_calls)} to ${String(fork.tool_calls)}.`,
      evidence: [
        { trace: "original", event_indexes: originalCalls },
        { trace: "fork", event_indexes: forkCalls },
      ],
    });
  }
  return findings;
}

function terminalEvent(events: TraceEvent[]): TraceEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (
      event !== undefined &&
      (event.event_type === "run_completed" ||
        event.event_type === "final_output")
    ) {
      return event;
    }
  }
  return undefined;
}

function renderLine(
  label: "Original:" | "Fork:",
  metricsValue: RunMetrics,
): string {
  const paddedLabel = label.padEnd(10);
  const status = capitalize(metricsValue.status);
  return `${paddedLabel}${status} | ${formatLatency(metricsValue.total_latency_ms)} | ${String(metricsValue.token_usage.total_tokens)} tokens | ${String(metricsValue.tool_calls)} tool calls`;
}

function formatLatency(milliseconds: number): string {
  return `${milliseconds.toFixed(1)} ms`;
}

function capitalize(value: "passed" | "failed"): "Passed" | "Failed" {
  return value === "passed" ? "Passed" : "Failed";
}

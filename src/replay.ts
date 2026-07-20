import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  Agent,
  Runner,
  Usage,
  setTracingDisabled,
  tool,
  type Model,
  type ModelRequest,
  type ModelResponse,
  type StreamEvent,
} from "@openai/agents";
import { z } from "zod";
import { DEMO_MODEL_IDENTIFIER } from "./demo-agent.js";
import { assertJsonRoundTrip } from "./json.js";
import { JsonlTraceRecorder, readTrace } from "./recorder.js";
import type {
  JsonObject,
  JsonValue,
  NewTraceEvent,
  TraceEvent,
} from "./types.js";

setTracingDisabled(true);

export interface ReplayState {
  messageHistory: Array<{
    event_index: number;
    event_type: "user_input" | "model_output";
    input: JsonValue;
    output: JsonValue;
  }>;
  contextSnapshot: JsonObject | null;
  forkAtEvent: number;
}

export interface ReplaySummary {
  status: "ok" | "error";
  fork_at_event: number;
  model_identifier: string;
  temperature: 0;
  memoized_tool_calls: number;
  live_tool_calls: number;
  diverged_events: number;
  last_matching_event_index: number | null;
  final_output: JsonValue;
}

export interface ReplayResult {
  forkRunFilePath: string;
  summary: ReplaySummary;
}

interface MemoizedResult {
  output: JsonValue;
  resultEventIndex: number;
}

export class InMemoryRefundStore {
  readonly refunds = new Map<string, number>();
  executionCount = 0;

  processRefund(input: RefundInput): JsonObject {
    this.executionCount += 1;
    if (input.customer_id !== "CUST-1041") {
      return {
        ok: false,
        error: "Customer ID does not match the requested customer",
      };
    }
    this.refunds.set(input.customer_id, input.amount);
    return { ok: true, customer_id: input.customer_id, amount: input.amount };
  }
}

export interface ReplayOptions {
  store?: InMemoryRefundStore;
}

const refundInput = z.object({
  customer_id: z.string(),
  amount: z.number(),
});
type RefundInput = z.infer<typeof refundInput>;

export async function replayFork(
  forkFilePath: string,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const forkBefore = await readTrace(forkFilePath);
  const forkAtEvent = forkBefore[0]?.fork_at_event;
  const originalRunId = forkBefore[0]?.forked_from_run_id;
  if (
    forkAtEvent === null ||
    forkAtEvent === undefined ||
    originalRunId === null ||
    originalRunId === undefined
  ) {
    throw new Error("Replay requires a non-empty lineage-stamped fork trace");
  }
  if (forkBefore.some((event) => event.event_index > forkAtEvent)) {
    throw new Error("Fork has already been replayed");
  }

  const originalPath = originalPathForFork(forkFilePath);
  const originalHash = await hashFile(originalPath);
  const original = await readTrace(originalPath);
  if (original[0]?.run_id !== originalRunId) {
    throw new Error("Fork lineage does not match its original trace");
  }

  const state = reconstructReplayState(forkBefore);
  const editedCall = forkBefore.find(
    (event) =>
      event.event_index === forkAtEvent && event.event_type === "tool_call",
  );
  if (editedCall?.tool_name !== "process_refund") {
    throw new Error(
      "The deterministic M2 runner requires a process_refund tool-call fork",
    );
  }
  const args = refundInput.parse(editedCall.input);
  const memoized = buildMemoizedToolIndex(original);
  const recorder = await JsonlTraceRecorder.resumeFork(forkFilePath);
  const store = options.store ?? new InMemoryRefundStore();
  const lastMatchingEventIndex = findLastMatchingEventIndex(
    original,
    forkBefore,
    forkAtEvent,
  );
  let memoizedToolCalls = 0;
  let liveToolCalls = 0;
  let divergedEvents = 0;
  let outcome: JsonObject = { ok: false, error: "Tool did not execute" };

  const model = new DeterministicReplayModel(args, recorder, () => outcome);
  const processRefund = tool({
    name: "process_refund",
    description: "Process a refund in the run-local in-memory store.",
    parameters: refundInput,
    execute: async (input, _context, details) => {
      const key = toolKey("process_refund", input);
      const recorded = memoized.get(key);
      const toolCallId = details?.toolCall.callId ?? "replay-process-refund";
      if (recorded === undefined) {
        divergedEvents += 1;
        await recorder.append(
          event({
            event_type: "diverged",
            input,
            output: {
              reason: "No recorded tool call matched normalized arguments",
            },
            tool_name: "process_refund",
            tool_call_id: toolCallId,
            status: "diverged",
            last_matching_event_index: lastMatchingEventIndex,
          }),
        );
      }
      await recorder.append(
        event({
          event_type: "tool_call",
          input,
          tool_name: "process_refund",
          tool_call_id: toolCallId,
          status: "ok",
        }),
      );
      if (recorded !== undefined) {
        memoizedToolCalls += 1;
        outcome = toJsonObject(recorded.output);
        await recorder.append(
          event({
            event_type: "tool_result",
            output: outcome,
            tool_name: "process_refund",
            tool_call_id: toolCallId,
            status: "ok",
            replayed_from_recording: true,
          }),
        );
        return outcome;
      }
      liveToolCalls += 1;
      outcome = store.processRefund(input);
      await recorder.append(
        event({
          event_type: "tool_result",
          output: outcome,
          tool_name: "process_refund",
          tool_call_id: toolCallId,
          status: outcome.ok === true ? "ok" : "failed",
        }),
      );
      return outcome;
    },
  });

  const agent = new Agent({
    name: "ForkTrace deterministic replay agent",
    instructions: "Resume the recorded customer refund from observable state.",
    model,
    modelSettings: { temperature: 0 },
    tools: [processRefund],
  });
  const runner = new Runner({
    model,
    modelSettings: { temperature: 0 },
    tracingDisabled: true,
  });
  const sdkResult = await runner.run(agent, JSON.stringify(state), {
    maxTurns: 2,
  });
  const succeeded = outcome.ok === true;
  const finalOutput = toJsonValue(sdkResult.finalOutput ?? outcome);
  await recorder.append(
    event({
      event_type: "final_output",
      output: succeeded ? outcome : finalOutput,
      status: succeeded ? "ok" : "failed",
    }),
  );
  await recorder.append(
    event({
      event_type: "run_completed",
      output: { ok: succeeded },
      status: succeeded ? "ok" : "failed",
    }),
  );

  if ((await hashFile(originalPath)) !== originalHash) {
    throw new Error("Original trace changed during replay");
  }
  return {
    forkRunFilePath: forkFilePath,
    summary: {
      status: succeeded ? "ok" : "error",
      fork_at_event: forkAtEvent,
      model_identifier: DEMO_MODEL_IDENTIFIER,
      temperature: 0,
      memoized_tool_calls: memoizedToolCalls,
      live_tool_calls: liveToolCalls,
      diverged_events: divergedEvents,
      last_matching_event_index: lastMatchingEventIndex,
      final_output: succeeded ? outcome : finalOutput,
    },
  };
}

export function reconstructReplayState(events: TraceEvent[]): ReplayState {
  const forkAtEvent = events[0]?.fork_at_event;
  if (forkAtEvent === null || forkAtEvent === undefined) {
    throw new Error("Cannot reconstruct state without fork_at_event lineage");
  }
  const prefix = events.filter(({ event_index }) => event_index <= forkAtEvent);
  let contextSnapshot: JsonObject | null = null;
  for (const item of prefix) {
    if (item.context_snapshot !== null) contextSnapshot = item.context_snapshot;
  }
  return {
    messageHistory: prefix
      .filter(
        (
          item,
        ): item is TraceEvent & {
          event_type: "user_input" | "model_output";
        } =>
          item.event_type === "user_input" ||
          item.event_type === "model_output",
      )
      .map(({ event_index, event_type, input, output }) => ({
        event_index,
        event_type,
        input,
        output,
      })),
    contextSnapshot:
      contextSnapshot === null ? null : assertJsonRoundTrip(contextSnapshot),
    forkAtEvent,
  };
}

/**
 * Canonical tool arguments use JSON with object keys sorted recursively. Array order is
 * preserved, primitives retain their JSON representation, and unsupported JSON values are
 * rejected before serialization. This makes semantic object key order irrelevant while keeping
 * arrays and scalar types exact.
 */
export function stableStringify(value: JsonValue): string {
  return JSON.stringify(sortJson(assertJsonRoundTrip(value)));
}

class DeterministicReplayModel implements Model {
  readonly modelIdentifier = DEMO_MODEL_IDENTIFIER;
  #turn = 0;

  constructor(
    private readonly args: RefundInput,
    private readonly recorder: JsonlTraceRecorder,
    private readonly getOutcome: () => JsonObject,
  ) {}

  async getResponse(request: ModelRequest): Promise<ModelResponse> {
    if (request.modelSettings.temperature !== 0) {
      throw new Error("Replay model requires temperature 0");
    }
    this.#turn += 1;
    if (this.#turn === 1) {
      await this.recorder.append(
        event({
          event_type: "model_output",
          output: { decision: "process_refund", arguments: this.args },
          status: "ok",
          token_usage: zeroUsage(),
        }),
      );
      return {
        usage: new Usage(),
        output: [
          {
            type: "function_call",
            name: "process_refund",
            arguments: JSON.stringify(this.args),
            callId: "replay-process-refund",
            status: "completed",
          },
        ],
      };
    }
    const outcome = this.getOutcome();
    const text = JSON.stringify(outcome);
    await this.recorder.append(
      event({
        event_type: "model_output",
        output: { message: text },
        status: "ok",
        token_usage: zeroUsage(),
      }),
    );
    return {
      usage: new Usage(),
      output: [
        {
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text }],
        },
      ],
    };
  }

  getStreamedResponse(): AsyncIterable<StreamEvent> {
    throw new Error("Deterministic replay uses the non-streaming SDK run loop");
  }
}

function buildMemoizedToolIndex(
  original: TraceEvent[],
): Map<string, MemoizedResult> {
  const index = new Map<string, MemoizedResult>();
  const calls = new Map<string, TraceEvent>();
  for (const item of original) {
    if (item.event_type === "tool_call" && item.tool_name !== null) {
      calls.set(item.tool_call_id ?? `event-${String(item.event_index)}`, item);
    } else if (item.event_type === "tool_result" && item.tool_name !== null) {
      const call = calls.get(item.tool_call_id ?? "");
      if (call !== undefined) {
        index.set(toolKey(item.tool_name, call.input), {
          output: item.output,
          resultEventIndex: item.event_index,
        });
      }
    }
  }
  return index;
}

function toolKey(toolName: string, input: JsonValue): string {
  return `${toolName}\u0000${stableStringify(input)}`;
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJson(value[key] ?? null)]),
    );
  }
  return value;
}

function findLastMatchingEventIndex(
  original: TraceEvent[],
  fork: TraceEvent[],
  forkAtEvent: number,
): number | null {
  let last: number | null = null;
  for (let index = 0; index <= forkAtEvent; index += 1) {
    const left = original.find((event) => event.event_index === index);
    const right = fork.find((event) => event.event_index === index);
    if (
      left === undefined ||
      right === undefined ||
      !sameObservableEvent(left, right)
    )
      break;
    last = index;
  }
  return last;
}

function sameObservableEvent(left: TraceEvent, right: TraceEvent): boolean {
  return (
    stableStringify({
      event_type: left.event_type,
      input: left.input,
      output: left.output,
      context_snapshot: left.context_snapshot,
      tool_name: left.tool_name,
      tool_call_id: left.tool_call_id,
    }) ===
    stableStringify({
      event_type: right.event_type,
      input: right.input,
      output: right.output,
      context_snapshot: right.context_snapshot,
      tool_name: right.tool_name,
      tool_call_id: right.tool_call_id,
    })
  );
}

function originalPathForFork(forkPath: string): string {
  const file = basename(forkPath);
  const marker = file.indexOf(".fork-");
  if (marker < 0)
    throw new Error("Fork filename does not identify its original trace");
  return join(dirname(forkPath), `${file.slice(0, marker)}.jsonl`);
}

function event(overrides: Partial<NewTraceEvent>): NewTraceEvent {
  return {
    event_type: "model_output",
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

function toJsonValue(value: unknown): JsonValue {
  return assertJsonRoundTrip(value) as JsonValue;
}

function toJsonObject(value: JsonValue): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return { value };
  }
  return value;
}

function zeroUsage(): {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
} {
  return { input_tokens: 0, output_tokens: 0, total_tokens: 0 };
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

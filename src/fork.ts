import { createHash, randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { assertJsonRoundTrip, snapshotContext } from "./json.js";
import { readTrace } from "./recorder.js";
import type { JsonValue, TraceEvent } from "./types.js";

export type ForkEdit =
  | { type: "tool_call_argument"; arguments: JsonValue }
  | { type: "tool_result"; output: JsonValue }
  | {
      type: "instruction";
      content: string;
      mode?: "replace" | "append";
    };

export type ForkErrorCode =
  | "EMPTY_TRACE"
  | "INVALID_EVENT_INDEX"
  | "INVALID_EDIT"
  | "EDIT_TARGET_MISMATCH"
  | "INVALID_INSTRUCTION_CONTENT"
  | "SOURCE_MUTATED";

export class ForkError extends Error {
  readonly code: ForkErrorCode;

  constructor(code: ForkErrorCode, message: string) {
    super(message);
    this.name = "ForkError";
    this.code = code;
  }
}

export async function forkRun(
  traceFilePath: string,
  forkAtEventIndex: number,
  edit: ForkEdit,
): Promise<string> {
  const originalHash = await hashFile(traceFilePath);
  const source = await readTrace(traceFilePath);
  if (source.length === 0)
    throw new ForkError("EMPTY_TRACE", "Cannot fork an empty trace");
  if (!Number.isSafeInteger(forkAtEventIndex) || forkAtEventIndex < 0) {
    throw new ForkError(
      "INVALID_EVENT_INDEX",
      `Invalid fork event index: ${String(forkAtEventIndex)}`,
    );
  }
  const sourceEvent = source.find(
    ({ event_index }) => event_index === forkAtEventIndex,
  );
  if (sourceEvent === undefined) {
    throw new ForkError(
      "INVALID_EVENT_INDEX",
      `Event index ${String(forkAtEventIndex)} does not exist`,
    );
  }
  assertForkEdit(edit);

  const sourceRunId = sourceEvent.run_id;
  if (source.some(({ run_id }) => run_id !== sourceRunId)) {
    throw new ForkError(
      "INVALID_EDIT",
      "Source trace contains multiple run IDs",
    );
  }
  const forkRunId = randomUUID();
  const lineage = {
    parent_run_id: sourceRunId,
    forked_from_run_id: sourceRunId,
    fork_at_event: forkAtEventIndex,
  };
  const forkEvents = source
    .filter(({ event_index }) => event_index <= forkAtEventIndex)
    .map((event) => {
      const context =
        event.context_snapshot === null
          ? null
          : snapshotContext(event.context_snapshot);
      const copied: TraceEvent = {
        ...event,
        event_id: randomUUID(),
        run_id: forkRunId,
        ...lineage,
        context_snapshot: context,
      };
      return event.event_index === forkAtEventIndex
        ? applyEdit(copied, edit)
        : assertJsonRoundTrip(copied);
    });

  const extension = extname(traceFilePath);
  const stem = basename(traceFilePath, extension);
  const forkPath = join(
    dirname(traceFilePath),
    `${stem}.fork-${forkRunId}${extension || ".jsonl"}`,
  );
  const handle = await open(forkPath, "wx");
  try {
    for (const event of forkEvents) {
      await handle.appendFile(`${JSON.stringify(event)}\n`, "utf8");
    }
  } finally {
    await handle.close();
  }

  if ((await hashFile(traceFilePath)) !== originalHash) {
    throw new ForkError(
      "SOURCE_MUTATED",
      "Original trace changed while it was being forked",
    );
  }
  return forkPath;
}

function applyEdit(event: TraceEvent, edit: ForkEdit): TraceEvent {
  let edited: TraceEvent;
  switch (edit.type) {
    case "tool_call_argument":
      assertTarget(event, "tool_call", edit.type);
      edited = { ...event, input: edit.arguments, status: "ok", edited: true };
      break;
    case "tool_result":
      assertTarget(event, "tool_result", edit.type);
      edited = { ...event, output: edit.output, status: "ok", edited: true };
      break;
    case "instruction": {
      assertTarget(event, "user_input", edit.type);
      if (typeof event.input !== "string") {
        throw new ForkError(
          "INVALID_INSTRUCTION_CONTENT",
          "Instruction edits require a string user_input",
        );
      }
      const input =
        edit.mode === "append"
          ? `${event.input}\n${edit.content}`
          : edit.content;
      edited = { ...event, input, status: "ok", edited: true };
      break;
    }
  }
  return assertJsonRoundTrip(edited);
}

function assertTarget(
  event: TraceEvent,
  expected: TraceEvent["event_type"],
  editType: ForkEdit["type"],
): void {
  if (event.event_type !== expected) {
    throw new ForkError(
      "EDIT_TARGET_MISMATCH",
      `${editType} cannot edit ${event.event_type} at event ${String(event.event_index)}`,
    );
  }
}

function assertForkEdit(edit: unknown): asserts edit is ForkEdit {
  if (edit === null || typeof edit !== "object" || !("type" in edit)) {
    throw new ForkError("INVALID_EDIT", "Edit must be a discriminated object");
  }
  if (
    edit.type !== "tool_call_argument" &&
    edit.type !== "tool_result" &&
    edit.type !== "instruction"
  ) {
    throw new ForkError(
      "INVALID_EDIT",
      `Unsupported edit kind: ${String(edit.type)}`,
    );
  }
  if (edit.type === "tool_call_argument" && !("arguments" in edit)) {
    throw new ForkError(
      "INVALID_EDIT",
      "tool_call_argument requires arguments",
    );
  }
  if (edit.type === "tool_result" && !("output" in edit)) {
    throw new ForkError("INVALID_EDIT", "tool_result requires output");
  }
  if (
    edit.type === "instruction" &&
    (!("content" in edit) || typeof edit.content !== "string")
  ) {
    throw new ForkError("INVALID_EDIT", "instruction requires string content");
  }
  if (
    edit.type === "instruction" &&
    "mode" in edit &&
    edit.mode !== undefined &&
    edit.mode !== "replace" &&
    edit.mode !== "append"
  ) {
    throw new ForkError(
      "INVALID_EDIT",
      "instruction mode must be replace or append",
    );
  }
}

async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

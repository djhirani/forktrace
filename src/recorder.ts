import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { assertJsonRoundTrip, snapshotContext } from "./json.js";
import type { NewTraceEvent, RunLineage, TraceEvent } from "./types.js";

const noLineage: RunLineage = {
  parent_run_id: null,
  forked_from_run_id: null,
  fork_at_event: null,
};

export class JsonlTraceRecorder {
  readonly runId: string;
  readonly filePath: string;
  readonly #lineage: RunLineage;
  #nextIndex = 0;
  #writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    filePath: string,
    runId: string,
    lineage: RunLineage,
    nextIndex: number,
  ) {
    this.filePath = filePath;
    this.runId = runId;
    this.#lineage = { ...lineage };
    this.#nextIndex = nextIndex;
  }

  static async create(
    filePath: string,
    options: { runId?: string; lineage?: RunLineage } = {},
  ): Promise<JsonlTraceRecorder> {
    await mkdir(dirname(filePath), { recursive: true });
    let existing: TraceEvent[] = [];
    try {
      existing = await readTrace(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (existing.length > 0)
      throw new Error(`Trace already exists: ${filePath}`);
    return new JsonlTraceRecorder(
      filePath,
      options.runId ?? randomUUID(),
      options.lineage ?? noLineage,
      0,
    );
  }

  async append(event: NewTraceEvent): Promise<Readonly<TraceEvent>> {
    const context =
      event.context_snapshot === null
        ? null
        : snapshotContext(event.context_snapshot);
    const stored: TraceEvent = assertJsonRoundTrip({
      event_index: this.#nextIndex,
      event_id: randomUUID(),
      run_id: this.runId,
      ...this.#lineage,
      event_type: event.event_type,
      timestamp: new Date().toISOString(),
      input: event.input,
      output: event.output,
      context_snapshot: context,
      tool_name: event.tool_name,
      tool_call_id: event.tool_call_id,
      status: event.status,
      latency_ms: event.latency_ms,
      token_usage: event.token_usage,
      ...(event.edited === true ? { edited: true as const } : {}),
    });
    this.#nextIndex += 1;
    const line = `${JSON.stringify(stored)}\n`;
    this.#writeQueue = this.#writeQueue.then(() =>
      appendFile(this.filePath, line, "utf8"),
    );
    await this.#writeQueue;
    return deepFreeze(structuredClone(stored));
  }
}

export async function readTrace(filePath: string): Promise<TraceEvent[]> {
  const contents = await readFile(filePath, "utf8");
  if (contents.length === 0) return [];
  return contents
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TraceEvent);
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

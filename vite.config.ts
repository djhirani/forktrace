import { randomUUID } from "node:crypto";
import { mkdir, readdir } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { recordDemoRun } from "./src/demo-run.js";
import { diffRuns, renderDiffText } from "./src/diff.js";
import { forkRun, type ForkEdit } from "./src/fork.js";
import { readTrace } from "./src/recorder.js";
import { replayFork } from "./src/replay.js";

const runsDirectory = resolve("traces", "runs");

export default defineConfig({
  root: "ui",
  plugins: [react(), traceApi()],
  build: {
    outDir: "../dist/ui",
    emptyOutDir: false,
  },
});

function traceApi(): Plugin {
  const middleware = (
    request: IncomingMessage,
    response: ServerResponse,
    next: (error?: unknown) => void,
  ) => {
    void handleApi(request, response, next).catch((error: unknown) => {
      response.statusCode = 400;
      sendJson(response, {
        error: error instanceof Error ? error.message : "Unknown API error",
      });
    });
  };
  return {
    name: "forktrace-local-api",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

async function handleApi(
  request: IncomingMessage,
  response: ServerResponse,
  next: (error?: unknown) => void,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://forktrace.local");
  if (!url.pathname.startsWith("/api/")) {
    next();
    return;
  }
  await mkdir(runsDirectory, { recursive: true });

  if (request.method === "GET" && url.pathname === "/api/runs") {
    const files = (await readdir(runsDirectory)).filter((file) =>
      file.endsWith(".jsonl"),
    );
    const runs = await Promise.all(
      files.map(async (file_name) => {
        const events = await readTrace(runPath(file_name));
        const first = events[0];
        const terminal = events.at(-1);
        return {
          file_name,
          run_id: first?.run_id ?? file_name,
          parent_run_id: first?.parent_run_id ?? null,
          status: terminal?.status ?? "unknown",
          event_count: events.length,
        };
      }),
    );
    sendJson(response, { runs });
    return;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/runs/")) {
    const file = decodeURIComponent(url.pathname.slice("/api/runs/".length));
    sendJson(response, {
      file_name: safeFile(file),
      events: await readTrace(runPath(file)),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/demo") {
    const id = randomUUID();
    const file_name = `demo-refund-failure-${id}.jsonl`;
    await recordDemoRun(runPath(file_name), `demo-run-${id}`);
    sendJson(response, {
      file_name,
      events: await readTrace(runPath(file_name)),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/fork") {
    const body = await readBody(request);
    const originalFile = stringField(body, "file_name");
    const eventIndex = numberField(body, "event_index");
    const edit = objectField(body, "edit") as unknown as ForkEdit;
    const originalPath = runPath(originalFile);
    const forkPath = await forkRun(originalPath, eventIndex, edit);
    const replay = await replayFork(forkPath);
    const report = await diffRuns(originalPath, forkPath);
    sendJson(response, {
      original_file_name: originalFile,
      fork_file_name: basename(forkPath),
      original_events: await readTrace(originalPath),
      fork_events: await readTrace(forkPath),
      replay: replay.summary,
      report,
      text_summary: renderDiffText(report),
    });
    return;
  }

  response.statusCode = 404;
  sendJson(response, { error: "API route not found" });
}

function runPath(file: string): string {
  return resolve(runsDirectory, safeFile(file));
}

function safeFile(file: string): string {
  const safe = basename(file);
  if (safe !== file || !safe.endsWith(".jsonl"))
    throw new Error("Invalid trace filename");
  return safe;
}

async function readBody(
  request: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const rawChunk of request) {
    const chunk: unknown = rawChunk;
    if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
    else if (chunk instanceof Uint8Array) chunks.push(chunk);
    else throw new Error("Unsupported request body chunk");
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be an object");
  }
  return parsed as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function numberField(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number") throw new Error(`${key} must be a number`);
  return value;
}

function objectField(body: Record<string, unknown>, key: string): object {
  const value = body[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${key} must be an object`);
  }
  return value;
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
}

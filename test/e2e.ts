import assert from "node:assert/strict";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
const createdFiles: string[] = [];

try {
  await server.listen();
  const address = server.httpServer?.address();
  if (
    address === null ||
    address === undefined ||
    typeof address === "string"
  ) {
    throw new Error("Vite did not expose a local test port");
  }
  const origin = `http://127.0.0.1:${String(address.port)}`;

  const demo = await request<{
    file_name: string;
    events: Array<{ event_index: number; event_type: string; status: string }>;
  }>(`${origin}/api/demo`, { method: "POST" });
  createdFiles.push(demo.file_name);
  assert.equal(demo.events.length, 13);
  assert.equal(demo.events.at(-1)?.status, "failed");

  const fork = await request<{
    fork_file_name: string;
    fork_events: Array<{
      event_index: number;
      event_type: string;
      status: string;
    }>;
    text_summary: string;
    report: {
      original: {
        status: string;
        tool_calls: number;
        total_latency_ms: number;
      };
      fork: { status: string; tool_calls: number; total_latency_ms: number };
      first_divergence_event_index: number | null;
      findings: Array<{
        message: string;
        evidence: Array<{ trace: string; event_indexes: number[] }>;
      }>;
    };
  }>(`${origin}/api/fork`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      file_name: demo.file_name,
      event_index: 8,
      edit: {
        type: "tool_call_argument",
        arguments: { customer_id: "CUST-1041", amount: 25 },
      },
    }),
  });
  createdFiles.push(fork.fork_file_name);

  assert.equal(fork.report.original.status, "failed");
  assert.equal(fork.report.fork.status, "passed");
  assert.equal(fork.report.original.tool_calls, 2);
  assert.equal(fork.report.fork.tool_calls, 3);
  assert.ok(fork.report.original.total_latency_ms > 0);
  assert.ok(fork.report.fork.total_latency_ms > 0);
  assert.equal(fork.report.first_divergence_event_index, 10);
  assert.equal(
    fork.report.findings[0]?.message,
    "Fork recorded 1 first divergence at event 10 for process_refund.",
  );
  assert.deepEqual(fork.report.findings[0].evidence, [
    { trace: "fork", event_indexes: [10] },
  ]);
  assert.match(
    fork.text_summary,
    /^Original: Failed \| [\d.]+ ms \| 0 tokens \| 2 tool calls\nFork:     Passed \| [\d.]+ ms \| 0 tokens \| 3 tool calls$/,
  );
  assert.equal(
    fork.fork_events.some(
      ({ event_type, status }) =>
        event_type === "diverged" && status === "diverged",
    ),
    true,
  );
  assert.equal(fork.fork_events.at(-1)?.event_type, "run_completed");
  assert.equal(fork.fork_events.at(-1)?.status, "ok");

  const runs = await request<{
    runs: Array<{ file_name: string; parent_run_id: string | null }>;
  }>(`${origin}/api/runs`);
  assert.ok(runs.runs.some(({ file_name }) => file_name === demo.file_name));
  assert.ok(
    runs.runs.some(
      ({ file_name, parent_run_id }) =>
        file_name === fork.fork_file_name && parent_run_id !== null,
    ),
  );

  console.log(fork.text_summary);
  console.log(`Finding: ${fork.report.findings[0].message}`);
  console.log("E2E PASS: run → fork → replay → diff");
} finally {
  await server.close();
  await Promise.all(
    createdFiles.map(async (file) => {
      try {
        await unlink(resolve("traces", "runs", file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }),
  );
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(body.error ?? `HTTP ${String(response.status)}`);
  return body;
}

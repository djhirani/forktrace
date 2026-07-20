import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { recordDemoRun } from "./demo-run.js";

const traceRoot = resolve("traces");
const runsDirectory = resolve(traceRoot, "runs");
if (traceRoot === resolve(".") || !traceRoot.endsWith("/traces")) {
  throw new Error(`Refusing to reset unsafe trace path: ${traceRoot}`);
}

await mkdir(traceRoot, { recursive: true });
for (const entry of await readdir(traceRoot)) {
  await rm(resolve(traceRoot, entry), { recursive: true, force: true });
}
await mkdir(runsDirectory, { recursive: true });
const seedPath = resolve(runsDirectory, "demo-refund-failure.jsonl");
await recordDemoRun(seedPath, "demo-run-refund-failure-seed");
console.log(seedPath);

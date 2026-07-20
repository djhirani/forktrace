import { resolve } from "node:path";
import { recordDemoRun } from "./demo-run.js";

const tracePath = resolve("traces", "demo-refund-failure.jsonl");
console.log(await recordDemoRun(tracePath, "demo-run-refund-failure-001"));

import { diffRuns, renderDiffText } from "./diff.js";

const [, , originalPath, forkPath] = process.argv;
if (originalPath === undefined || forkPath === undefined) {
  throw new Error("Usage: npm run diff -- <originalTrace> <forkTrace>");
}

const report = await diffRuns(originalPath, forkPath);
console.log(JSON.stringify(report, null, 2));
console.log(renderDiffText(report));

import { replayFork } from "./replay.js";

const [, , forkPath] = process.argv;
if (forkPath === undefined)
  throw new Error("Usage: npm run replay -- <forkFile>");

console.log(JSON.stringify(await replayFork(forkPath), null, 2));

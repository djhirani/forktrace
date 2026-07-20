import { forkRun, type ForkEdit } from "./fork.js";

const [, , tracePath, indexText, editText] = process.argv;
if (
  tracePath === undefined ||
  indexText === undefined ||
  editText === undefined
) {
  throw new Error("Usage: npm run fork -- <trace> <index> <editJson>");
}

const index = Number(indexText);
const edit = JSON.parse(editText) as ForkEdit;
console.log(await forkRun(tracePath, index, edit));

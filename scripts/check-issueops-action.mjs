import { execFileSync } from "node:child_process";

const output = execFileSync(
  "git",
  [
    "status",
    "--porcelain",
    "--",
    ".github/actions/budget-issueops/dist",
  ],
  { encoding: "utf8" },
).trim();

if (output) {
  console.error("The committed IssueOps action bundle is not current:");
  console.error(output);
  process.exitCode = 1;
}

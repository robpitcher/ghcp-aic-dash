import {
  setupIssueOps,
  type IssueOpsOperatingLevel,
} from "../src/lib/issueops/admin";

function valueAfter(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function integerAfter(name: string): number | undefined {
  const value = valueAfter(name);
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return Number(value);
}

function actionRepository(): string {
  const repository =
    valueAfter("--action-repo") ??
    process.env.ISSUEOPS_ACTION_REPOSITORY?.trim();
  if (!repository) {
    throw new Error(
      "--action-repo OWNER/REPO or ISSUEOPS_ACTION_REPOSITORY is required.",
    );
  }
  return repository;
}

async function main(): Promise<void> {
  const repository = valueAfter("--repo");
  if (!repository) {
    throw new Error("--repo OWNER/REPO is required.");
  }
  const level = (valueAfter("--level") ?? "dry-run") as IssueOpsOperatingLevel;
  if (!["triage", "dry-run", "protected-writes"].includes(level)) {
    throw new Error(
      "--level must be triage, dry-run, or protected-writes.",
    );
  }

  const result = await setupIssueOps({
    repository,
    actionRepository: actionRepository(),
    level,
    actionRef: valueAfter("--action-ref"),
    enterpriseSlug: valueAfter("--enterprise-slug") ?? null,
    maxDeltaCredits: integerAfter("--max-delta"),
    maxTotalCredits: integerAfter("--max-total"),
    apply: process.argv.includes("--apply"),
  });

  console.log(
    `${result.applied ? "Applied" : "Planned"} ${result.changes.length} change(s) using action ${result.actionSha}.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

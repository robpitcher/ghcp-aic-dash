import {
  doctorIssueOps,
  type IssueOpsOperatingLevel,
} from "../src/lib/issueops/admin";

function valueAfter(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
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

  const checks = await doctorIssueOps({
    repository,
    actionRepository: actionRepository(),
    level,
  });
  for (const check of checks) {
    console.log(
      `${check.status.toUpperCase()} ${check.name}: ${check.detail}`,
    );
  }
  if (checks.some((check) => check.status === "fail")) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

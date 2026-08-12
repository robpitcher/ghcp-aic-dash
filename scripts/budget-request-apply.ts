import { runApplyCommand } from "../src/lib/issueops/commands/apply";

async function main(): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const actor = process.env.GITHUB_ACTOR;
  const runId = process.env.GITHUB_RUN_ID;
  if (!githubToken || !repository || !actor || !runId) {
    throw new Error("Required GitHub Actions context is missing.");
  }

  await runApplyCommand({
    githubToken,
    repository,
    actor,
    runId,
    issueNumber: process.env.ISSUE_NUMBER ?? "",
    dryRun: process.env.DRY_RUN !== "false",
    writeEnabled: process.env.BUDGET_WRITE_ENABLED,
    billingToken: process.env.GH_BILLING_ADMIN_TOKEN,
    serverUrl: process.env.GITHUB_SERVER_URL,
    configPath: process.env.ISSUEOPS_CONFIG_PATH,
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

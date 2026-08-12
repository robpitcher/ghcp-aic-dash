import { appendFileSync } from "node:fs";
import { runApplyCommand } from "../../../../src/lib/issueops/commands/apply";
import { runRollbackCommand } from "../../../../src/lib/issueops/commands/rollback";
import { runTriageCommand } from "../../../../src/lib/issueops/commands/triage";

function getInput(name: string, required = false): string {
  const value =
    process.env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`]?.trim() ??
    "";
  if (required && !value) {
    throw new Error(`Action input "${name}" is required.`);
  }
  return value;
}

function getBooleanInput(name: string): boolean {
  const value = getInput(name).toLowerCase();
  if (["true", "1"].includes(value)) return true;
  if (["false", "0", ""].includes(value)) return false;
  throw new Error(`Action input "${name}" must be true or false.`);
}

function setOutput(name: string, value: string): void {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    console.log(`${name}=${value}`);
    return;
  }
  appendFileSync(outputPath, `${name}=${value}\n`, "utf8");
}

function setFailed(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const escaped = message
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  console.error(`::error::${escaped}`);
  process.exitCode = 1;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Required GitHub Actions environment value ${name} is missing.`);
  }
  return value;
}

async function run(): Promise<void> {
  const operation = getInput("operation", true);
  const configPath = getInput("config-path") || undefined;
  const githubToken = requiredEnvironment("GITHUB_TOKEN");

  if (operation === "triage") {
    await runTriageCommand({
      githubToken,
      eventPath: requiredEnvironment("GITHUB_EVENT_PATH"),
      configPath,
      log: console.log,
    });
    return;
  }

  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const actor = requiredEnvironment("GITHUB_ACTOR");
  const runId = requiredEnvironment("GITHUB_RUN_ID");
  const dryRun = getBooleanInput("dry-run");
  if (operation === "apply") {
    await runApplyCommand({
      githubToken,
      repository,
      actor,
      runId,
      issueNumber: getInput("issue-number", true),
      dryRun,
      writeEnabled: process.env.BUDGET_WRITE_ENABLED,
      billingToken: process.env.GH_BILLING_ADMIN_TOKEN,
      serverUrl: process.env.GITHUB_SERVER_URL,
      configPath,
      publishPreview: getBooleanInput("publish-preview"),
      log: console.log,
    });
    return;
  }

  if (operation === "rollback") {
    const result = await runRollbackCommand({
      githubToken,
      repository,
      actor,
      runId,
      dryRun,
      writeEnabled: process.env.BUDGET_WRITE_ENABLED,
      billingToken: process.env.GH_BILLING_ADMIN_TOKEN,
      serverUrl: process.env.GITHUB_SERVER_URL,
      configPath,
      issueNumber: getInput("issue-number"),
      forceBeforeExpiration: getBooleanInput("force-rollback"),
      log: console.log,
    });
    setOutput("expired-count", result.expiredCount.toString());
    return;
  }

  throw new Error(
    `Unsupported IssueOps operation "${operation}". Use triage, apply, or rollback.`,
  );
}

run().catch(setFailed);

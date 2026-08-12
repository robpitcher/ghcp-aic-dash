import { runTriageCommand } from "../src/lib/issueops/commands/triage";

async function main(): Promise<void> {
  const githubToken = process.env.GITHUB_TOKEN;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!githubToken || !eventPath) {
    throw new Error("GITHUB_TOKEN and GITHUB_EVENT_PATH are required.");
  }

  await runTriageCommand({
    githubToken,
    eventPath,
    configPath: process.env.ISSUEOPS_CONFIG_PATH,
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

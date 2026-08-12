import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

async function workflow(name: string): Promise<Record<string, unknown>> {
  const source = await readFile(`.github/workflows/${name}`, "utf8");
  return load(source) as Record<string, unknown>;
}

describe("IssueOps workflows", () => {
  it("uses thin local action wrappers without dependency installation", async () => {
    for (const name of [
      "budget-request-triage.yml",
      "budget-request-apply.yml",
      "budget-request-rollback.yml",
    ]) {
      const source = await readFile(`.github/workflows/${name}`, "utf8");
      expect(source).toContain("uses: ./.github/actions/budget-issueops");
      expect(source).not.toContain("actions/setup-node");
      expect(source).not.toContain("npm ci");
      expect(source).not.toContain("tsx ");
      expect(await workflow(name)).toBeTypeOf("object");
    }
  });

  it("runs protected apply when the approval label is added", async () => {
    const source = await readFile(
      ".github/workflows/budget-request-apply.yml",
      "utf8",
    );
    expect(source).toContain(
      "github.event_name == 'issues' && github.event.label.name == 'budget-approved' && vars.BUDGET_WRITE_ENABLED == 'true'",
    );
    expect(source).toContain("environment: budget-approver");
    expect(source).toContain("issue-number: ${{ github.event.issue.number }}");
    expect(source).not.toContain("inputs.dry_run");
    expect(source).toContain(
      "startsWith(github.event.issue.title, '[AI Credit Budget Request]')",
    );
    expect(source).toContain(
      "contains(github.event.issue.body, 'ghcp-aic-budget-request:v1')",
    );
    expect(source).toContain('publish-preview: "true"');
  });

  it("gates protected rollback on discovery output", async () => {
    const source = await readFile(
      ".github/workflows/budget-request-rollback.yml",
      "utf8",
    );
    expect(source).toContain(
      "needs.discovery.outputs.expired_count != '0'",
    );
    expect(source).toContain(
      "steps.discover.outputs['expired-count']",
    );
    expect(source).toContain("environment: budget-approver");
    expect(source).toContain("inputs.issue_number != ''");
    expect(source).toContain("force-rollback:");
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  doctorIssueOps,
  setupIssueOps,
  type GhApiClient,
} from "../admin";

const ACTION_SHA = "a".repeat(40);
const ACTION_REPOSITORY = "public-owner/public-repo";

function fakeClient(
  overrides: Partial<GhApiClient> = {},
): GhApiClient {
  return {
    request: vi.fn(async (path: string) => {
      if (path.includes("/commits/")) return { sha: ACTION_SHA };
      if (path.endsWith("/labels?per_page=100")) return [];
      if (path.includes("/contents/")) return undefined;
      if (path.endsWith("/actions/variables/BUDGET_WRITE_ENABLED")) {
        return undefined;
      }
      return {};
    }) as GhApiClient["request"],
    run: vi.fn(async () => ""),
    ...overrides,
  };
}

const files: Record<string, string> = {
  ".github/workflows/budget-request-triage.yml":
    "uses: ./.github/actions/budget-issueops\n",
  ".github/workflows/budget-request-apply.yml":
    "uses: ./.github/actions/budget-issueops\n",
  ".github/workflows/budget-request-rollback.yml":
    "uses: ./.github/actions/budget-issueops\n",
  "templates/issueops/ai-credit-budget-request.md": "template\n",
};

describe("IssueOps setup", () => {
  it("plans immutable action workflows without mutating GitHub", async () => {
    const client = fakeClient();
    const readText = vi.fn(async (path: string) => files[path]);
    const result = await setupIssueOps({
      repository: "acme/requests",
      actionRepository: ACTION_REPOSITORY,
      level: "dry-run",
      actionRef: "v1.2.3",
      client,
      readText,
      log: vi.fn(),
    });

    expect(result.applied).toBe(false);
    expect(result.actionSha).toBe(ACTION_SHA);
    expect(result.changes).toContain(
      "create .github/workflows/budget-request-triage.yml",
    );
    expect(result.changes).toContain(
      "create .github/ISSUE_TEMPLATE/ai-credit-budget-request.md",
    );
    expect(readText).toHaveBeenCalledWith(
      "templates/issueops/ai-credit-budget-request.md",
      "utf8",
    );
    expect(client.run).not.toHaveBeenCalled();
    expect(client.request).not.toHaveBeenCalledWith(
      expect.stringContaining("/contents/"),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("normalizes local CRLF before comparing repository contents", async () => {
    const remote =
      `uses: ${ACTION_REPOSITORY}/.github/actions/budget-issueops@` +
      `${ACTION_SHA} # v1\n`;
    const client = fakeClient({
      request: vi.fn(async (path: string) => {
        if (path.includes("/commits/")) return { sha: ACTION_SHA };
        if (path.endsWith("/labels?per_page=100")) return [];
        if (path.includes("budget-request-triage.yml")) {
          return {
            content: Buffer.from(remote).toString("base64"),
            encoding: "base64",
            sha: "existing",
          };
        }
        if (path.includes("/contents/")) return undefined;
        return {};
      }) as GhApiClient["request"],
    });
    const result = await setupIssueOps({
      repository: "acme/requests",
      actionRepository: ACTION_REPOSITORY,
      level: "triage",
      actionRef: "v1",
      client,
      readText: async (path) =>
        path.includes("budget-request-triage.yml")
          ? "uses: ./.github/actions/budget-issueops\r\n"
          : files[path],
      log: vi.fn(),
    });

    expect(result.changes).not.toContain(
      "update .github/workflows/budget-request-triage.yml",
    );
  });

  it("applies managed files, labels, and the disabled write flag", async () => {
    const client = fakeClient();
    const result = await setupIssueOps({
      repository: "acme/requests",
      actionRepository: ACTION_REPOSITORY,
      level: "protected-writes",
      actionRef: "v1.2.3",
      enterpriseSlug: "acme",
      apply: true,
      client,
      readText: async (path) => files[path],
      log: vi.fn(),
    });

    expect(result.applied).toBe(true);
    expect(client.run).toHaveBeenCalledWith([
      "variable",
      "set",
      "BUDGET_WRITE_ENABLED",
      "--body",
      "false",
      "--repo",
      "acme/requests",
    ]);
    expect(client.request).toHaveBeenCalledWith(
      "repos/acme/requests/environments/budget-approver",
      {
        method: "PUT",
        body: {
          deployment_branch_policy: {
            protected_branches: true,
            custom_branch_policies: false,
          },
        },
      },
    );
    const putCalls = vi
      .mocked(client.request)
      .mock.calls.filter(([, options]) => options?.method === "PUT");
    const workflowCall = putCalls.find(([path]) =>
      path.includes("budget-request-triage.yml"),
    );
    expect(workflowCall?.[1]?.body?.content).toBeTypeOf("string");
    const decoded = Buffer.from(
      workflowCall?.[1]?.body?.content as string,
      "base64",
    ).toString("utf8");
    expect(decoded).toContain(
      `${ACTION_REPOSITORY}/.github/actions/budget-issueops@${ACTION_SHA} # v1.2.3`,
    );
  });
});

describe("IssueOps doctor", () => {
  it("fails missing installations without exposing secret values", async () => {
    const client = fakeClient();
    const checks = await doctorIssueOps({
      repository: "acme/requests",
      actionRepository: ACTION_REPOSITORY,
      level: "protected-writes",
      client,
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: ".github/ghcp-aic-issueops.yml",
          status: "fail",
        }),
        expect.objectContaining({ name: "labels", status: "fail" }),
        expect.objectContaining({ name: "write flag", status: "fail" }),
        expect.objectContaining({
          name: "administrator secret",
          status: "fail",
        }),
      ]),
    );
    expect(JSON.stringify(checks)).not.toContain("token");
  });
});

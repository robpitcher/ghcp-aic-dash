import { describe, expect, it, vi } from "vitest";
import {
  BUDGET_APPLY_PREVIEW_COMMENT_MARKER,
  BUDGET_APPLY_SCHEMA,
  ISSUEOPS_CONFIG_SCHEMA,
  buildBudgetApplyComment,
  type BudgetAdminClient,
  type BudgetApplyAudit,
  type IssueOpsClient,
  type IssueOpsConfig,
  type WorkflowIssue,
} from "../index";
import { runApplyCommand } from "../commands/apply";
import { runRollbackCommand } from "../commands/rollback";
import { runTriageCommand } from "../commands/triage";

const config: IssueOpsConfig = {
  schema: ISSUEOPS_CONFIG_SCHEMA,
  enterprise_slug: "example-enterprise",
  auto_approval: {
    max_delta_credits: 2000,
    max_total_credits: 5000,
  },
};

function validBody(): string {
  return `\`\`\`yaml
schema: "ghcp-aic-budget-request:v1"
requester: "alice"
current_budget_credits: 3000
current_consumed_credits: 425
requested_increase_credits: 1500
requested_total_credits: 4500
effective_source: "individual"
expiration_date: "2026-08-31"
generated_at: "2026-08-04T20:30:00.000Z"
\`\`\`

## Business justification

Needed for customer migration readiness.`;
}

function issue(overrides: Partial<WorkflowIssue> = {}): WorkflowIssue {
  return {
    number: 42,
    title: "[AI Credit Budget Request] alice: +1500 credits",
    body: validBody(),
    state: "open",
    user: { login: "alice" },
    labels: [{ name: "budget-approved" }],
    ...overrides,
  };
}

function issueClient(
  overrides: Partial<IssueOpsClient> = {},
): IssueOpsClient {
  return {
    getIssue: vi.fn(async () => issue()),
    getVerifiedLogin: vi.fn(async (login) => login),
    listComments: vi.fn(async () => []),
    findAppliedIssues: vi.fn(async () => []),
    ensureLabels: vi.fn(async () => undefined),
    upsertMarkedComment: vi.fn(async () => undefined),
    reconcileLabels: vi.fn(async () => undefined),
    closeIssue: vi.fn(async () => undefined),
    ...overrides,
  };
}

function billingClient(): BudgetAdminClient {
  return {
    getUserBudgets: vi.fn(async () => ({ budgets: [] })),
    createBudget: vi.fn(async () => ({ id: "created" })),
    patchBudget: vi.fn(async () => undefined),
    deleteBudget: vi.fn(async () => undefined),
  };
}

describe("IssueOps commands", () => {
  it("triage invalidates stale approval after an issue edit", async () => {
    const client = issueClient();
    const result = await runTriageCommand({
      githubToken: "token",
      eventPath: "event.json",
      readEvent: async () =>
        JSON.stringify({
          action: "edited",
          repository: { full_name: "acme/requests" },
          issue: issue(),
        }),
      createClient: () => client,
      loadConfig: async () => config,
      log: vi.fn(),
    });

    expect(result.classification).toBe("auto-eligible");
    expect(client.reconcileLabels).toHaveBeenCalledWith(
      42,
      ["budget-request", "budget-auto-eligible"],
      expect.arrayContaining(["budget-approved"]),
    );
  });

  it("preserves audit-backed state when an applied issue is edited", async () => {
    const appliedAudit: BudgetApplyAudit = {
      schema: BUDGET_APPLY_SCHEMA,
      action_type: "created-override",
      before_amount_usd: 30,
      after_amount_usd: 45,
      budget_scope: "user",
      budget_id: "budget-1",
      requester: "alice",
      expiration_date: "2026-08-31",
      run_id: "100",
      actor: "operator",
      status: "applied",
    };
    const client = issueClient({
      listComments: vi.fn(async () => [
        {
          id: 10,
          body: buildBudgetApplyComment(
            appliedAudit,
            "https://github.com/acme/requests/actions/runs/100",
          ),
          user: { type: "Bot" },
        },
      ]),
    });
    const loadConfig = vi.fn(async () => config);

    const result = await runTriageCommand({
      githubToken: "token",
      eventPath: "event.json",
      readEvent: async () =>
        JSON.stringify({
          action: "edited",
          repository: { full_name: "acme/requests" },
          issue: issue({
            body: "tampered",
            labels: [{ name: "budget-applied" }],
          }),
        }),
      createClient: () => client,
      loadConfig,
      log: vi.fn(),
    });

    expect(result.classification).toBe("applied");
    expect(loadConfig).not.toHaveBeenCalled();
    expect(client.reconcileLabels).toHaveBeenCalledWith(
      42,
      ["budget-request", "budget-applied"],
      expect.arrayContaining(["budget-invalid", "budget-approved"]),
    );
    expect(client.upsertMarkedComment).toHaveBeenCalledWith(
      42,
      expect.any(String),
      expect.stringContaining("Later edits to the issue do not change"),
    );
  });

  it("publishes one apply preview without billing mutation", async () => {
    const client = issueClient();
    const billing = billingClient();
    const result = await runApplyCommand({
      githubToken: "token",
      repository: "acme/requests",
      actor: "reviewer",
      runId: "123",
      issueNumber: "42",
      dryRun: true,
      writeEnabled: "true",
      publishPreview: true,
      createIssuesClient: () => client,
      createBillingClient: () => billing,
      loadConfig: async () => config,
      log: vi.fn(),
    });

    expect(result.mode).toBe("dry-run");
    expect(client.upsertMarkedComment).toHaveBeenCalledWith(
      42,
      BUDGET_APPLY_PREVIEW_COMMENT_MARKER,
      expect.stringContaining("No budget change was made."),
    );
    expect(billing.createBudget).not.toHaveBeenCalled();
    expect(billing.patchBudget).not.toHaveBeenCalled();
  });

  it("repairs the operational label when an apply audit already exists", async () => {
    const audit: BudgetApplyAudit = {
      schema: BUDGET_APPLY_SCHEMA,
      action_type: "patched-existing",
      before_amount_usd: 30,
      after_amount_usd: 45,
      budget_scope: "user",
      budget_id: "budget-1",
      requester: "alice",
      expiration_date: "2026-08-31",
      run_id: "100",
      actor: "operator",
      status: "applied",
    };
    const client = issueClient({
      listComments: vi.fn(async () => [
        {
          id: 10,
          body: buildBudgetApplyComment(
            audit,
            "https://github.com/acme/requests/actions/runs/100",
          ),
          user: { type: "Bot" },
        },
      ]),
    });

    const result = await runApplyCommand({
      githubToken: "token",
      repository: "acme/requests",
      actor: "reviewer",
      runId: "123",
      issueNumber: "42",
      dryRun: true,
      writeEnabled: "true",
      createIssuesClient: () => client,
      loadConfig: async () => config,
      log: vi.fn(),
    });

    expect(result.mode).toBe("noop");
    expect(client.reconcileLabels).toHaveBeenCalledWith(
      42,
      ["budget-applied"],
      expect.arrayContaining(["budget-approved"]),
    );
  });

  it("reports expired rollback candidates without loading billing config", async () => {
    const audit: BudgetApplyAudit = {
      schema: BUDGET_APPLY_SCHEMA,
      action_type: "patched-existing",
      before_amount_usd: 30,
      after_amount_usd: 45,
      budget_scope: "user",
      budget_id: "budget-1",
      requester: "alice",
      expiration_date: "2026-07-31",
      run_id: "100",
      actor: "operator",
      status: "applied",
    };
    const client = issueClient({
      findAppliedIssues: vi.fn(async () => [
        issue({ labels: [{ name: "budget-applied" }] }),
      ]),
      listComments: vi.fn(async () => [
        {
          id: 10,
          body: buildBudgetApplyComment(
            audit,
            "https://github.com/acme/requests/actions/runs/100",
          ),
          user: { type: "Bot" },
        },
      ]),
    });

    const loadConfig = vi.fn(async () => config);

    const result = await runRollbackCommand({
      githubToken: "token",
      repository: "acme/requests",
      actor: "operator",
      runId: "123",
      dryRun: true,
      writeEnabled: "true",
      now: new Date("2026-08-10T00:00:00Z"),
      createIssuesClient: () => client,
      loadConfig,
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      expiredCount: 1,
      mutatingCalls: 0,
    });
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it("selects one applied issue for an early manual rollback", async () => {
    const audit: BudgetApplyAudit = {
      schema: BUDGET_APPLY_SCHEMA,
      action_type: "created-override",
      before_amount_usd: 30,
      after_amount_usd: 45,
      budget_scope: "user",
      budget_id: "budget-1",
      requester: "alice",
      expiration_date: "2026-08-31",
      run_id: "100",
      actor: "operator",
      status: "applied",
    };
    const client = issueClient({
      getIssue: vi.fn(async () =>
        issue({ labels: [{ name: "budget-applied" }] }),
      ),
      listComments: vi.fn(async () => [
        {
          id: 10,
          body: buildBudgetApplyComment(
            audit,
            "https://github.com/acme/requests/actions/runs/100",
          ),
          user: { type: "Bot" },
        },
      ]),
    });

    const result = await runRollbackCommand({
      githubToken: "token",
      repository: "acme/requests",
      actor: "operator",
      runId: "123",
      issueNumber: "42",
      forceBeforeExpiration: true,
      dryRun: true,
      writeEnabled: "true",
      now: new Date("2026-08-10T00:00:00Z"),
      createIssuesClient: () => client,
      log: vi.fn(),
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      expiredCount: 1,
      mutatingCalls: 0,
    });
    expect(client.findAppliedIssues).not.toHaveBeenCalled();
  });

  it("skips recognized requests that have no apply audit", async () => {
    const client = issueClient({
      findAppliedIssues: vi.fn(async () =>
        [issue({ labels: [{ name: "budget-request" }] })],
      ),
      listComments: vi.fn(async () => []),
    });

    await expect(
      runRollbackCommand({
        githubToken: "token",
        repository: "acme/requests",
        actor: "operator",
        runId: "123",
        dryRun: true,
        writeEnabled: "false",
        createIssuesClient: () => client,
        log: vi.fn(),
      }),
    ).resolves.toMatchObject({ expiredCount: 0 });
  });

  it("fails rollback discovery when an applied issue has no apply audit", async () => {
    const client = issueClient({
      findAppliedIssues: vi.fn(async () => [
        issue({ labels: [{ name: "budget-applied" }] }),
      ]),
      listComments: vi.fn(async () => []),
    });

    await expect(
      runRollbackCommand({
        githubToken: "token",
        repository: "acme/requests",
        actor: "operator",
        runId: "123",
        dryRun: true,
        writeEnabled: "false",
        createIssuesClient: () => client,
        log: vi.fn(),
      }),
    ).rejects.toThrow("missing its apply audit state");
  });
});

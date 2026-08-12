import { describe, expect, it, vi } from "vitest";
import {
  BUDGET_APPLY_COMMENT_MARKER,
  BUDGET_APPLY_SCHEMA,
  BUDGET_APPROVAL_LABEL,
  BillingAdminClient,
  GitHubIssueOpsClient,
  buildBudgetApplyComment,
  buildRollbackComment,
  canWriteBudget,
  hasValidBudgetApproval,
  isBudgetWriteEnabled,
  parseBudgetApplyAudit,
  planBudgetApply,
  planBudgetRollback,
  triageBudgetRequest,
  type BudgetApplyAudit,
  type ParsedBudgetRequest,
} from "../index";

const request: ParsedBudgetRequest = {
  schema: "ghcp-aic-budget-request:v1",
  requester: "alice",
  current_budget_credits: 3000,
  current_consumed_credits: 425,
  requested_increase_credits: 1500,
  requested_total_credits: 4500,
  effective_source: "individual",
  expiration_date: "2026-08-31",
  generated_at: "2026-08-04T20:30:00.000Z",
};

const individual = {
  budgets: [
    {
      id: "user-budget",
      budget_scope: "user",
      budget_entity_name: "alice",
      budget_amount: 30,
      prevent_further_usage: true,
    },
  ],
  effective_budget: {
    id: "user-budget",
    budget_amount: 30,
    consumed_amount: 4.25,
  },
};

const inherited = {
  budgets: [
    {
      id: "cost-center",
      budget_scope: "multi_user_cost_center",
      budget_amount: 30,
    },
  ],
  effective_budget: {
    id: "cost-center",
    budget_amount: 30,
    consumed_amount: 4.25,
  },
};

function plan(overrides: Partial<Parameters<typeof planBudgetApply>[0]> = {}) {
  return planBudgetApply({
    request,
    verifiedRequester: "Alice",
    liveBudgets: individual,
    runId: "123",
    actor: "operator",
    ...overrides,
  });
}

function audit(
  overrides: Partial<BudgetApplyAudit> = {},
): BudgetApplyAudit {
  return {
    schema: BUDGET_APPLY_SCHEMA,
    action_type: "patched-existing",
    before_amount_usd: 30,
    after_amount_usd: 45,
    budget_scope: "user",
    budget_id: "user-budget",
    requester: "alice",
    expiration_date: "2026-08-31",
    run_id: "123",
    actor: "operator",
    status: "applied",
    ...overrides,
  };
}

describe("protected apply decisions", () => {
  it("keeps writes default-off and dry-run unable to write", () => {
    expect(isBudgetWriteEnabled(undefined)).toBe(false);
    expect(isBudgetWriteEnabled("TRUE")).toBe(false);
    expect(isBudgetWriteEnabled("true")).toBe(true);
    expect(canWriteBudget(true, "true")).toBe(false);
    expect(canWriteBudget(false, "false")).toBe(false);
    expect(canWriteBudget(false, "true")).toBe(true);
  });

  it("requires a valid classification-specific approval", () => {
    expect(hasValidBudgetApproval([], "auto-eligible")).toBe(false);
    expect(
      hasValidBudgetApproval(["budget-auto-eligible"], "needs approval"),
    ).toBe(false);
    expect(
      hasValidBudgetApproval(["budget-auto-eligible"], "auto-eligible"),
    ).toBe(true);
    expect(
      hasValidBudgetApproval([BUDGET_APPROVAL_LABEL], "needs approval"),
    ).toBe(true);
  });

  it("refuses policy revalidation failures", () => {
    const result = triageBudgetRequest({
      title: "[AI Credit Budget Request] alice: +1500 credits",
      body: "not structured",
      authorLogin: "alice",
      limits: { maxDeltaCredits: 2000, maxTotalCredits: 5000 },
      now: new Date("2026-08-04T00:00:00Z"),
    });
    expect(result.classification).toBe("invalid");
  });

  it("refuses a requester revalidation mismatch", () => {
    expect(plan({ verifiedRequester: "mallory" })).toMatchObject({
      outcome: "refused",
    });
  });

  it("patches an existing user budget without weakening the hard stop", () => {
    expect(plan()).toMatchObject({
      outcome: "apply",
      action: "patched-existing",
      budgetId: "user-budget",
      mutationBody: {
        budget_product_sku: "ai_credits",
        budget_amount: 45,
        prevent_further_usage: true,
      },
      audit: { before_amount_usd: 30, after_amount_usd: 45 },
    });
  });

  it("creates a hard-stop user override for inherited budgets", () => {
    expect(
      plan({
        request: { ...request, effective_source: "cost_center" },
        liveBudgets: inherited,
      }),
    ).toMatchObject({
      outcome: "apply",
      action: "created-override",
      mutationBody: {
        budget_product_sku: "ai_credits",
        budget_type: "BundlePricing",
        budget_scope: "user",
        budget_entity_name: "alice",
        user: "alice",
        budget_amount: 45,
        prevent_further_usage: true,
        budget_alerting: {
          will_alert: false,
          alert_recipients: [],
        },
      },
    });
  });

  it("does not apply the same audited increase twice", () => {
    expect(plan({ existingAudit: audit() })).toEqual({
      outcome: "noop",
      message: "This request already has an applied audit record.",
    });
  });
});

describe("audit state", () => {
  it("round-trips the documented safe audit schema", () => {
    const body = buildBudgetApplyComment(
      audit(),
      "https://github.com/acme/repo/actions/runs/123",
    );
    expect(body).toContain(BUDGET_APPLY_COMMENT_MARKER);
    expect(parseBudgetApplyAudit(body)).toEqual({
      ok: true,
      audit: audit(),
    });
  });

  it("round-trips enterprise-managed requester logins", () => {
    const comment = buildBudgetApplyComment(
      audit({ requester: "testuser_managed" }),
      "https://github.com/acme/repo/actions/runs/123",
    );
    expect(parseBudgetApplyAudit(comment)).toMatchObject({
      ok: true,
      audit: { requester: "testuser_managed" },
    });
  });

  it("attributes rollback comments to the current rollback run", () => {
    const comment = buildRollbackComment(
      audit(),
      "https://github.com/acme/repo/actions/runs/456",
      "456",
      "Live state drifted.",
    );
    expect(comment).toContain(
      "[456](https://github.com/acme/repo/actions/runs/456)",
    );
    expect(comment).not.toContain("[123]");
  });

  it("rejects malformed and prototype-polluting audit comments", () => {
    expect(parseBudgetApplyAudit(`${BUDGET_APPLY_COMMENT_MARKER}\nno yaml`).ok)
      .toBe(false);
    expect(
      parseBudgetApplyAudit(
        `${BUDGET_APPLY_COMMENT_MARKER}\n\`\`\`yaml\nschema: "${BUDGET_APPLY_SCHEMA}"\n__proto__: polluted\n\`\`\``,
      ).ok,
    ).toBe(false);
  });
});

describe("rollback decisions", () => {
  it("deletes an automation-created override after expiration", () => {
    expect(
      planBudgetRollback(
        audit({ action_type: "created-override" }),
        {
          ...individual,
          budgets: [{ ...individual.budgets[0], budget_amount: 45 }],
        },
        new Date("2026-09-01T00:00:00Z"),
      ),
    ).toEqual({
      outcome: "rollback",
      action: "delete-override",
      budgetId: "user-budget",
    });
  });

  it("restores a patched budget and preserves its hard stop", () => {
    expect(
      planBudgetRollback(
        audit(),
        { ...individual, budgets: [{ ...individual.budgets[0], budget_amount: 45 }] },
        new Date("2026-09-01T00:00:00Z"),
      ),
    ).toMatchObject({
      outcome: "rollback",
      action: "restore-existing",
      mutationBody: {
        budget_product_sku: "ai_credits",
        budget_amount: 30,
        prevent_further_usage: true,
      },
    });
  });

  it("refuses to overwrite administrator drift", () => {
    expect(
      planBudgetRollback(
        audit(),
        { ...individual, budgets: [{ ...individual.budgets[0], budget_amount: 40 }] },
        new Date("2026-09-01T00:00:00Z"),
      ),
    ).toMatchObject({ outcome: "refused" });
  });

  it("does nothing before the expiration date has passed", () => {
    expect(
      planBudgetRollback(
        audit(),
        individual,
        new Date("2026-08-31T23:59:59Z"),
      ),
    ).toMatchObject({ outcome: "not-due" });
  });

  it("allows an explicitly forced rollback before expiration", () => {
    expect(
      planBudgetRollback(
        audit(),
        {
          ...individual,
          budgets: [{ ...individual.budgets[0], budget_amount: 45 }],
        },
        new Date("2026-08-10T00:00:00Z"),
        true,
      ),
    ).toMatchObject({
      outcome: "rollback",
      action: "restore-existing",
    });
  });

  it("continues cleanup when the audit is already reverted", () => {
    expect(
      planBudgetRollback(
        audit({ status: "reverted" }),
        individual,
        new Date("2026-09-01T00:00:00Z"),
      ),
    ).toMatchObject({ outcome: "already-reverted" });
  });
});

describe("mocked GitHub API clients", () => {
  it("uses API 2026-03-10 and performs only the requested billing mutations", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ budget: { id: "new-budget" } }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new BillingAdminClient("secret", "acme", fetchMock);

    await expect(client.createBudget({ budget_amount: 45 })).resolves.toEqual({
      id: "new-budget",
    });
    await client.patchBudget("budget-1", { budget_amount: 30 });
    await client.deleteBudget("budget-1");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      expect(new Headers(call[1]?.headers).get("X-GitHub-Api-Version")).toBe(
        "2026-03-10",
      );
    }
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "PATCH",
      "DELETE",
    ]);
  });

  it("mock-tests issue reads without exposing credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          number: 17,
          title: "request",
          body: null,
          state: "open",
          user: { login: "alice" },
          labels: [],
        }),
      ),
    );
    const client = new GitHubIssueOpsClient("repo-token", "acme/repo", fetchMock);
    expect((await client.getIssue(17))?.number).toBe(17);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization"))
      .toBe("Bearer repo-token");
  });

  it("mock-tests every issue mutation and lookup path", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/users/alice")) {
        return new Response(JSON.stringify({ login: "Alice" }));
      }
      if (url.includes("/issues?state=all")) {
        return new Response(JSON.stringify([]));
      }
      if (url.endsWith("/labels?per_page=100")) {
        return new Response(JSON.stringify([]));
      }
      if (url.includes("/comments?per_page=100")) {
        return new Response(JSON.stringify([]));
      }
      if (method === "DELETE") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const client = new GitHubIssueOpsClient("repo-token", "acme/repo", fetchMock);

    expect(await client.getVerifiedLogin("alice")).toBe("Alice");
    expect(await client.findAppliedIssues()).toEqual([]);
    await client.ensureLabels([
      { name: "budget-applied", color: "1a7f37", description: "Applied" },
    ]);
    await client.upsertMarkedComment(17, "<!-- marker -->", "audit");
    await client.reconcileLabels(17, ["budget-applied"], ["budget-approved"]);
    const callsBeforeRemoveOnly = fetchMock.mock.calls.length;
    await client.reconcileLabels(17, [], ["budget-applied"]);
    expect(fetchMock.mock.calls.length - callsBeforeRemoveOnly).toBe(1);
    await client.closeIssue(17);

    const methods = fetchMock.mock.calls.map((call) => call[1]?.method ?? "GET");
    expect(methods).toEqual(
      expect.arrayContaining(["GET", "POST", "DELETE", "PATCH"]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });
});

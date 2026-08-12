import { describe, expect, it } from "vitest";
import { resolveEffectiveBudget } from "@/lib/budget";

function payload(scope: string) {
  return {
    budgets: [
      { id: "unrelated", budget_scope: "enterprise", budget_amount: 9999 },
      { id: "winner", budget_scope: scope, budget_amount: 20 },
    ],
    effective_budget: {
      id: "winner",
      budget_amount: 12.345,
      consumed_amount: 4.567,
    },
  };
}

describe("resolveEffectiveBudget", () => {
  it.each([
    ["user", "individual"],
    ["multi_user_cost_center", "cost_center"],
    ["multi_user_customer", "universal"],
  ] as const)("maps %s to %s without exposing raw fields", (scope, source) => {
    expect(resolveEffectiveBudget(payload(scope), "Alice")).toEqual({
      scopedLogin: "alice",
      hasBudget: true,
      source,
      amountUsd: 12.35,
      amountCredits: 1235,
      consumedUsd: 4.57,
      consumedCredits: 457,
      remainingUsd: 7.78,
      remainingCredits: 778,
      percentUsed: 37,
    });
  });

  it("represents no effective user budget explicitly", () => {
    expect(
      resolveEffectiveBudget({ budgets: [], effective_budget: null }, "alice"),
    ).toEqual({
      scopedLogin: "alice",
      hasBudget: false,
      source: null,
      amountUsd: null,
      amountCredits: null,
      consumedUsd: null,
      consumedCredits: null,
      remainingUsd: null,
      remainingCredits: null,
      percentUsed: null,
    });
  });

  it.each([
    null,
    [],
    {},
    { budgets: "not-an-array", effective_budget: {} },
    { budgets: [{ id: "winner", budget_scope: "user" }] },
    {
      budgets: [{ id: "other", budget_scope: "user" }],
      effective_budget: {
        id: "winner",
        budget_amount: 10,
        consumed_amount: 2,
      },
    },
    {
      budgets: [{ id: "winner", budget_scope: "enterprise" }],
      effective_budget: {
        id: "winner",
        budget_amount: 10,
        consumed_amount: 2,
      },
    },
  ])("treats malformed or non-user-level payloads as no budget", (raw) => {
    expect(resolveEffectiveBudget(raw, "alice").hasBudget).toBe(false);
  });

  it("clamps display-only remaining and percentage while preserving spend", () => {
    const result = resolveEffectiveBudget(
      {
        budgets: [{ id: "winner", budget_scope: "user" }],
        effective_budget: {
          id: "winner",
          budget_amount: 10,
          consumed_amount: 12.34,
        },
      },
      "alice",
    );
    expect(result).toMatchObject({
      hasBudget: true,
      consumedUsd: 12.34,
      remainingUsd: 0,
      remainingCredits: 0,
      percentUsed: 100,
    });
  });
});

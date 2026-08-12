import type {
  EffectiveBudget,
  EffectiveBudgetSource,
  RawGitHubBudget,
  RawGitHubBudgetsResponse,
  RawGitHubEffectiveBudget,
} from "./types";

const CREDITS_PER_USD = 100;

const SOURCE_BY_SCOPE: Record<string, EffectiveBudgetSource> = {
  user: "individual",
  multi_user_cost_center: "cost_center",
  multi_user_customer: "universal",
};

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function noBudget(scopedLogin: string): EffectiveBudget {
  return {
    scopedLogin,
    hasBudget: false,
    source: null,
    amountUsd: null,
    amountCredits: null,
    consumedUsd: null,
    consumedCredits: null,
    remainingUsd: null,
    remainingCredits: null,
    percentUsed: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve GitHub's winning budget into the only fields safe for self-service.
 *
 * Unexpected or incomplete JSON is treated as "no budget" rather than throwing:
 * an upstream schema drift must not leak unrelated raw data or break usage APIs.
 * Remaining value and percent are display fields, so overages clamp to zero and
 * 100%; authoritative consumed spend remains visible and is never recalculated.
 */
export function resolveEffectiveBudget(
  payload: RawGitHubBudgetsResponse | unknown,
  scopedLogin: string,
): EffectiveBudget {
  const login = scopedLogin.toLowerCase();
  if (!isRecord(payload) || !Array.isArray(payload.budgets)) {
    return noBudget(login);
  }

  const effective = payload.effective_budget;
  if (!isRecord(effective)) return noBudget(login);

  const typedEffective = effective as RawGitHubEffectiveBudget;
  if (
    typeof typedEffective.id !== "string" ||
    typeof typedEffective.budget_amount !== "number" ||
    !Number.isFinite(typedEffective.budget_amount) ||
    typedEffective.budget_amount < 0 ||
    typeof typedEffective.consumed_amount !== "number" ||
    !Number.isFinite(typedEffective.consumed_amount) ||
    typedEffective.consumed_amount < 0
  ) {
    return noBudget(login);
  }

  const winner = payload.budgets.find(
    (budget): budget is RawGitHubBudget =>
      isRecord(budget) && budget.id === typedEffective.id,
  );
  if (!winner || typeof winner.budget_scope !== "string") {
    return noBudget(login);
  }

  const source = SOURCE_BY_SCOPE[winner.budget_scope];
  if (!source) return noBudget(login);

  // Convert GitHub's USD values once at the normalization boundary; downstream
  // request and display code work in integer credits where possible.
  const amountUsd = round(typedEffective.budget_amount, 2);
  const consumedUsd = round(typedEffective.consumed_amount, 2);
  const remainingUsd = round(Math.max(0, amountUsd - consumedUsd), 2);
  const percentUsed =
    amountUsd === 0
      ? consumedUsd > 0
        ? 100
        : 0
      : round(Math.min(100, Math.max(0, (consumedUsd / amountUsd) * 100)), 1);

  return {
    scopedLogin: login,
    hasBudget: true,
    source,
    amountUsd,
    amountCredits: Math.round(amountUsd * CREDITS_PER_USD),
    consumedUsd,
    consumedCredits: Math.round(consumedUsd * CREDITS_PER_USD),
    remainingUsd,
    remainingCredits: Math.round(remainingUsd * CREDITS_PER_USD),
    percentUsed,
  };
}

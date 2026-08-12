/** GitHub budget scopes that can determine a user's effective AI credit budget. */
export type RawUserBudgetScope =
  | "user"
  | "multi_user_cost_center"
  | "multi_user_customer";

/** Minimal raw budget fields needed to identify the effective source. */
export interface RawGitHubBudget {
  id?: unknown;
  budget_scope?: unknown;
  budget_amount?: unknown;
  budget_product_sku?: unknown;
  [key: string]: unknown;
}

/** Minimal raw effective-budget fields returned by GitHub. */
export interface RawGitHubEffectiveBudget {
  id?: unknown;
  budget_amount?: unknown;
  consumed_amount?: unknown;
  [key: string]: unknown;
}

/** Defensive representation of one page from GitHub's budgets endpoint. */
export interface RawGitHubBudgetsResponse {
  budgets?: unknown;
  effective_budget?: unknown;
  has_next_page?: unknown;
  total_count?: unknown;
  [key: string]: unknown;
}

export type EffectiveBudgetSource =
  | "individual"
  | "cost_center"
  | "universal";

interface EffectiveBudgetBase {
  scopedLogin: string;
}

export interface NoEffectiveBudget extends EffectiveBudgetBase {
  hasBudget: false;
  source: null;
  amountUsd: null;
  amountCredits: null;
  consumedUsd: null;
  consumedCredits: null;
  remainingUsd: null;
  remainingCredits: null;
  percentUsed: null;
}

export interface AvailableEffectiveBudget extends EffectiveBudgetBase {
  hasBudget: true;
  source: EffectiveBudgetSource;
  amountUsd: number;
  amountCredits: number;
  consumedUsd: number;
  consumedCredits: number;
  remainingUsd: number;
  remainingCredits: number;
  percentUsed: number;
}

/**
 * Sanitized public model. The discriminant makes an absent user-level budget
 * explicit without exposing GitHub budget IDs or unrelated enterprise details.
 */
export type EffectiveBudget = NoEffectiveBudget | AvailableEffectiveBudget;

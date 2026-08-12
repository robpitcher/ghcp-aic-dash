import type { RawGitHubBudget, RawGitHubBudgetsResponse } from "../budget";
import { resolveEffectiveBudget } from "../budget";
import {
  BUDGET_APPLY_SCHEMA,
  type BudgetApplyAction,
  type BudgetApplyAudit,
} from "./audit";
import type { ParsedBudgetRequest } from "./parse";
import type { BudgetRequestClassification } from "./policy";
import {
  BUDGET_APPROVAL_LABEL,
} from "./audit";
import { BUDGET_AUTO_ELIGIBLE_LABEL } from "./triage";

export const BUDGET_PRODUCT_SKU = "ai_credits";
export const BUDGET_TYPE = "BundlePricing";

export interface ApplyBudgetInput {
  request: ParsedBudgetRequest;
  verifiedRequester: string;
  liveBudgets: RawGitHubBudgetsResponse | unknown;
  existingAudit?: BudgetApplyAudit;
  runId: string;
  actor: string;
}

export type ApplyBudgetPlan =
  | { outcome: "refused" | "noop"; message: string }
  | {
      outcome: "apply";
      action: BudgetApplyAction;
      audit: BudgetApplyAudit;
      budgetId?: string;
      mutationBody: Record<string, unknown>;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validUserBudget(
  value: unknown,
  requester: string,
): value is RawGitHubBudget & {
  id: string;
  budget_scope: "user";
  budget_amount: number;
} {
  if (!isRecord(value)) return false;
  const entity = value.budget_entity_name;
  return (
    typeof value.id === "string" &&
    value.budget_scope === "user" &&
    typeof value.budget_amount === "number" &&
    Number.isFinite(value.budget_amount) &&
    value.budget_amount >= 0 &&
    (entity === undefined ||
      (typeof entity === "string" &&
        entity.toLowerCase() === requester.toLowerCase()))
  );
}

export function isBudgetWriteEnabled(value: string | undefined): boolean {
  return value === "true";
}

export function canWriteBudget(
  dryRun: boolean,
  featureFlag: string | undefined,
): boolean {
  // Writes require two independent opt-ins; dry-run remains the default.
  return !dryRun && isBudgetWriteEnabled(featureFlag);
}

export function parseIssueNumber(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

export function hasValidBudgetApproval(
  labels: Iterable<string>,
  classification: BudgetRequestClassification,
): boolean {
  const names = new Set(labels);
  return (
    names.has(BUDGET_APPROVAL_LABEL) ||
    (classification === "auto-eligible" &&
      names.has(BUDGET_AUTO_ELIGIBLE_LABEL))
  );
}

export function planBudgetApply(input: ApplyBudgetInput): ApplyBudgetPlan {
  // Revalidate identity, prior audit state, and the live effective budget before
  // constructing any mutation. Submitted issue values are never trusted alone.
  const requester = input.request.requester.toLowerCase();
  if (input.verifiedRequester.toLowerCase() !== requester) {
    return {
      outcome: "refused",
      message: "Live GitHub requester verification did not match the request.",
    };
  }
  if (input.existingAudit?.status === "applied") {
    return {
      outcome: "noop",
      message: "This request already has an applied audit record.",
    };
  }

  const effective = resolveEffectiveBudget(input.liveBudgets, requester);
  if (!effective.hasBudget) {
    return { outcome: "refused", message: "No live effective budget was found." };
  }
  if (effective.source !== input.request.effective_source) {
    return {
      outcome: "refused",
      message: "The live effective budget source no longer matches the request.",
    };
  }
  if (effective.amountCredits !== input.request.current_budget_credits) {
    return {
      outcome: "refused",
      message: "The live budget amount no longer matches the request.",
    };
  }
  if (input.request.requested_increase_credits % 100 !== 0) {
    return {
      outcome: "refused",
      message: "The requested credits do not convert to whole USD.",
    };
  }

  const budgets = isRecord(input.liveBudgets)
    ? input.liveBudgets.budgets
    : undefined;
  const userBudget = Array.isArray(budgets)
    ? budgets.find((budget) => validUserBudget(budget, requester))
    : undefined;
  const before = effective.amountUsd;
  const after = before + input.request.requested_increase_credits / 100;
  const action: BudgetApplyAction = userBudget
    ? "patched-existing"
    : "created-override";
  // Planning is side-effect free: callers receive the exact mutation and audit
  // record to execute only after all refusal checks have passed.
  const budgetId = userBudget?.id ?? `pending:${requester}`;
  const audit: BudgetApplyAudit = {
    schema: BUDGET_APPLY_SCHEMA,
    action_type: action,
    before_amount_usd: before,
    after_amount_usd: after,
    budget_scope: "user",
    budget_id: budgetId,
    requester,
    expiration_date: input.request.expiration_date,
    run_id: input.runId,
    actor: input.actor,
    status: "applied",
  };

  return {
    outcome: "apply",
    action,
    audit,
    budgetId: userBudget?.id,
    mutationBody: userBudget
      ? {
          budget_product_sku: BUDGET_PRODUCT_SKU,
          budget_amount: after,
          prevent_further_usage: true,
        }
      : {
          budget_product_sku: BUDGET_PRODUCT_SKU,
          budget_type: BUDGET_TYPE,
          budget_scope: "user",
          budget_entity_name: requester,
          user: requester,
          budget_amount: after,
          prevent_further_usage: true,
          budget_alerting: {
            will_alert: false,
            alert_recipients: [],
          },
        },
  };
}

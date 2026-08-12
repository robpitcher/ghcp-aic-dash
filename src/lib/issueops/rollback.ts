import type { RawGitHubBudget, RawGitHubBudgetsResponse } from "../budget";
import type { BudgetApplyAudit } from "./audit";
import { BUDGET_PRODUCT_SKU } from "./apply";

export type RollbackBudgetPlan =
  | {
      outcome: "not-due" | "noop" | "already-reverted" | "refused";
      message: string;
    }
  | {
      outcome: "rollback";
      action: "delete-override" | "restore-existing";
      budgetId: string;
      mutationBody?: {
        budget_product_sku: typeof BUDGET_PRODUCT_SKU;
        budget_amount: number;
        prevent_further_usage: true;
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findUserBudget(
  payload: RawGitHubBudgetsResponse | unknown,
  audit: BudgetApplyAudit,
): (RawGitHubBudget & { id: string; budget_amount: number }) | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.budgets)) return undefined;
  return payload.budgets.find(
    (budget): budget is RawGitHubBudget & {
      id: string;
      budget_amount: number;
    } =>
      isRecord(budget) &&
      budget.id === audit.budget_id &&
      budget.budget_scope === "user" &&
      typeof budget.budget_amount === "number" &&
      Number.isFinite(budget.budget_amount),
  );
}

export function planBudgetRollback(
  audit: BudgetApplyAudit,
  liveBudgets: RawGitHubBudgetsResponse | unknown,
  now = new Date(),
  forceBeforeExpiration = false,
): RollbackBudgetPlan {
  // Expiration comparisons use UTC date strings to match the billing-period
  // date recorded in the apply audit.
  if (audit.status === "reverted") {
    return {
      outcome: "already-reverted",
      message: "The request is already reverted.",
    };
  }
  const today = now.toISOString().slice(0, 10);
  if (!forceBeforeExpiration && today <= audit.expiration_date) {
    return { outcome: "not-due", message: "The request has not expired." };
  }

  const userBudget = findUserBudget(liveBudgets, audit);
  if (!userBudget) {
    return {
      outcome:
        audit.action_type === "created-override"
          ? "already-reverted"
          : "refused",
      message:
        audit.action_type === "created-override"
          ? "The temporary override is already absent."
          : "The original user budget no longer exists.",
    };
  }
  if (userBudget.budget_amount !== audit.after_amount_usd) {
    // Never overwrite an administrator's later edit; surface it for review.
    return {
      outcome: "refused",
      message:
        "The live amount differs from the automation-recorded amount; an administrator changed it.",
    };
  }
  return audit.action_type === "created-override"
    ? {
        outcome: "rollback",
        action: "delete-override",
        budgetId: audit.budget_id,
      }
    : {
        outcome: "rollback",
        action: "restore-existing",
        budgetId: audit.budget_id,
        mutationBody: {
          budget_product_sku: BUDGET_PRODUCT_SKU,
          budget_amount: audit.before_amount_usd,
          prevent_further_usage: true,
        },
      };
}

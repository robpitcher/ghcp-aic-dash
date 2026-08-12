import { getCurrentBillingMonthExpiration } from "../budget";
import {
  BUDGET_REQUEST_TITLE_PREFIX,
  parseBudgetRequestBody,
  type ParsedBudgetRequest,
} from "./parse";

export type BudgetRequestClassification =
  | "invalid"
  | "auto-eligible"
  | "needs approval";

export interface BudgetRequestPolicyLimits {
  maxDeltaCredits: number;
  maxTotalCredits: number;
}

export interface BudgetRequestTriageInput {
  title: string;
  body: string;
  authorLogin: string;
  limits: BudgetRequestPolicyLimits;
  now?: Date;
}

export interface BudgetRequestTriageResult {
  classification: BudgetRequestClassification;
  errors: string[];
  request?: ParsedBudgetRequest;
}

function parseLimit(value: string | undefined): number {
  // Missing or malformed limits disable auto-eligibility rather than widening it.
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) {
    return 0;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

export function parseBudgetRequestPolicyLimits(
  maxDeltaCredits: string | undefined,
  maxTotalCredits: string | undefined,
): BudgetRequestPolicyLimits {
  return {
    maxDeltaCredits: parseLimit(maxDeltaCredits),
    maxTotalCredits: parseLimit(maxTotalCredits),
  };
}

export function triageBudgetRequest(
  input: BudgetRequestTriageInput,
): BudgetRequestTriageResult {
  // Parsing validates the structured payload before policy binds it to the
  // issue author, canonical title, and current UTC billing period.
  const parsed = parseBudgetRequestBody(input.body);
  if (!parsed.ok) {
    return { classification: "invalid", errors: parsed.errors };
  }

  const errors: string[] = [];
  const request = parsed.request;
  const expectedTitle =
    `${BUDGET_REQUEST_TITLE_PREFIX} ${request.requester}: ` +
    `+${request.requested_increase_credits} credits`;

  if (input.authorLogin.toLowerCase() !== request.requester.toLowerCase()) {
    errors.push("Issue author must match the requester GitHub login.");
  }
  if (input.title !== expectedTitle) {
    errors.push(`Issue title must be "${expectedTitle}".`);
  }

  const expiration = getCurrentBillingMonthExpiration(input.now ?? new Date());
  if (request.expiration_date !== expiration) {
    errors.push(
      `expiration_date must be ${expiration}, the end of the current UTC billing month.`,
    );
  }

  if (errors.length > 0) {
    return { classification: "invalid", errors, request };
  }

  const { maxDeltaCredits, maxTotalCredits } = input.limits;
  // Both positive thresholds must be configured; either absent limit forces
  // manual approval instead of partially enabling automatic eligibility.
  const autoEligible =
    maxDeltaCredits > 0 &&
    maxTotalCredits > 0 &&
    request.requested_increase_credits <= maxDeltaCredits &&
    request.requested_total_credits <= maxTotalCredits;

  return {
    classification: autoEligible ? "auto-eligible" : "needs approval",
    errors: [],
    request,
  };
}

import { z } from "zod";
import type { AvailableEffectiveBudget } from "./types";

export const BUDGET_REQUEST_SCHEMA_MARKER = "ghcp-aic-budget-request:v1";
export const MIN_BUDGET_REQUEST_JUSTIFICATION_LENGTH = 20;
export const MAX_BUDGET_REQUEST_JUSTIFICATION_LENGTH = 4_000;
export const MAX_BUDGET_REQUEST_INCREASE_CREDITS = 1_000_000;
export const MAX_BUDGET_REQUEST_URL_LENGTH = 7_500;

// Validate the only browser-supplied fields before combining them with
// authoritative budget and identity data fetched by the server.
export const budgetRequestInputSchema = z
  .object({
    requestedIncreaseCredits: z
      .number({
        error: "Requested increase must be a number.",
      })
      .int("Requested increase must be a whole number of credits.")
      .positive("Requested increase must be greater than zero.")
      .max(
        MAX_BUDGET_REQUEST_INCREASE_CREDITS,
        `Requested increase cannot exceed ${MAX_BUDGET_REQUEST_INCREASE_CREDITS.toLocaleString("en-US")} credits.`,
      )
      .refine(
        (value) => value % 100 === 0,
        "Requested increase must be a multiple of 100 credits.",
      ),
    justification: z
      .string({
        error: "Business justification is required.",
      })
      .trim()
      .min(
        MIN_BUDGET_REQUEST_JUSTIFICATION_LENGTH,
        `Business justification must be at least ${MIN_BUDGET_REQUEST_JUSTIFICATION_LENGTH} characters.`,
      )
      .max(
        MAX_BUDGET_REQUEST_JUSTIFICATION_LENGTH,
        `Business justification cannot exceed ${MAX_BUDGET_REQUEST_JUSTIFICATION_LENGTH.toLocaleString("en-US")} characters.`,
      ),
  })
  .strict();

export type BudgetRequestInput = z.infer<typeof budgetRequestInputSchema>;

export interface BudgetIssueRequest {
  repository: string;
  budget: AvailableEffectiveBudget;
  requestedIncreaseCredits: number;
  justification: string;
  generatedAt: Date;
}

export interface BudgetIssuePrefill {
  url: string;
  title: string;
  body: string;
  expirationDate: string;
  justificationTruncated: boolean;
}

export function getCurrentBillingMonthExpiration(generatedAt: Date): string {
  // Date.UTC avoids local-time rollover at month boundaries.
  const expiration = new Date(
    Date.UTC(
      generatedAt.getUTCFullYear(),
      generatedAt.getUTCMonth() + 1,
      0,
    ),
  );
  return expiration.toISOString().slice(0, 10);
}

function sanitizeJustification(value: string): string {
  // Normalize text and prevent user prose from terminating the YAML fence.
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/```/g, "``\\`")
    .trim();
}

function buildBody(
  request: BudgetIssueRequest,
  expirationDate: string,
  justification: string,
): string {
  const requestedTotalCredits =
    request.budget.amountCredits + request.requestedIncreaseCredits;

  return [
    "```yaml",
    `schema: ${JSON.stringify(BUDGET_REQUEST_SCHEMA_MARKER)}`,
    `requester: ${JSON.stringify(request.budget.scopedLogin)}`,
    `current_budget_credits: ${request.budget.amountCredits}`,
    `current_consumed_credits: ${request.budget.consumedCredits}`,
    `requested_increase_credits: ${request.requestedIncreaseCredits}`,
    `requested_total_credits: ${requestedTotalCredits}`,
    `effective_source: ${JSON.stringify(request.budget.source)}`,
    `expiration_date: ${JSON.stringify(expirationDate)}`,
    `generated_at: ${JSON.stringify(request.generatedAt.toISOString())}`,
    "```",
    "",
    "## Business justification",
    "",
    justification,
  ].join("\n");
}

function buildUrl(repository: string, title: string, body: string): string {
  const params = new URLSearchParams({ title, body });
  return `https://github.com/${repository}/issues/new?${params.toString()}`;
}

/**
 * Deterministically build a GitHub issue prefill from authenticated budget data.
 * The timestamp is supplied by the caller so tests and downstream automation can
 * reproduce the exact structured payload.
 */
export function buildBudgetIssuePrefill(
  request: BudgetIssueRequest,
): BudgetIssuePrefill {
  const expirationDate = getCurrentBillingMonthExpiration(request.generatedAt);
  const title =
    `[AI Credit Budget Request] ${request.budget.scopedLogin}: ` +
    `+${request.requestedIncreaseCredits} credits`;
  const sanitized = sanitizeJustification(request.justification);
  let body = buildBody(request, expirationDate, sanitized);
  let url = buildUrl(request.repository, title, body);
  let justificationTruncated = false;

  if (url.length > MAX_BUDGET_REQUEST_URL_LENGTH) {
    justificationTruncated = true;
    let low = 0;
    let high = sanitized.length;

    // Binary-search the largest justification that survives URL encoding under
    // GitHub's practical issue-prefill limit.
    while (low < high) {
      const candidateLength = Math.ceil((low + high) / 2);
      const candidate = `${sanitized.slice(0, candidateLength).trimEnd()}\n\n[Justification truncated to fit the GitHub issue URL.]`;
      const candidateBody = buildBody(request, expirationDate, candidate);
      if (
        buildUrl(request.repository, title, candidateBody).length <=
        MAX_BUDGET_REQUEST_URL_LENGTH
      ) {
        low = candidateLength;
      } else {
        high = candidateLength - 1;
      }
    }

    const truncated =
      `${sanitized.slice(0, low).trimEnd()}\n\n` +
      "[Justification truncated to fit the GitHub issue URL.]";
    body = buildBody(request, expirationDate, truncated);
    url = buildUrl(request.repository, title, body);
  }

  if (url.length > MAX_BUDGET_REQUEST_URL_LENGTH) {
    throw new RangeError(
      `The GitHub issue URL exceeds ${MAX_BUDGET_REQUEST_URL_LENGTH} characters even without the justification.`,
    );
  }

  return {
    url,
    title,
    body,
    expirationDate,
    justificationTruncated,
  };
}

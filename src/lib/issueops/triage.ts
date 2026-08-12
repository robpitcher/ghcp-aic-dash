import type {
  BudgetRequestClassification,
  BudgetRequestPolicyLimits,
  BudgetRequestTriageResult,
} from "./policy";

export const BUDGET_REQUEST_LABEL = "budget-request";
export const BUDGET_INVALID_LABEL = "budget-invalid";
export const BUDGET_NEEDS_APPROVAL_LABEL = "budget-needs-approval";
export const BUDGET_AUTO_ELIGIBLE_LABEL = "budget-auto-eligible";
export const BUDGET_TRIAGE_COMMENT_MARKER =
  "<!-- ghcp-aic-budget-triage -->";

export const BUDGET_CLASSIFICATION_LABELS = [
  BUDGET_INVALID_LABEL,
  BUDGET_NEEDS_APPROVAL_LABEL,
  BUDGET_AUTO_ELIGIBLE_LABEL,
] as const;

export const BUDGET_LABELS = [
  BUDGET_REQUEST_LABEL,
  ...BUDGET_CLASSIFICATION_LABELS,
] as const;

const LABEL_BY_CLASSIFICATION: Record<BudgetRequestClassification, string> = {
  invalid: BUDGET_INVALID_LABEL,
  "needs approval": BUDGET_NEEDS_APPROVAL_LABEL,
  "auto-eligible": BUDGET_AUTO_ELIGIBLE_LABEL,
};

export interface IssueCommentSummary {
  id: number;
  body: string | null;
  authorType?: string;
}

export function getBudgetClassificationLabel(
  classification: BudgetRequestClassification,
): string {
  return LABEL_BY_CLASSIFICATION[classification];
}

export function findBudgetTriageComments(
  comments: IssueCommentSummary[],
): IssueCommentSummary[] {
  // Only bot-authored marked comments participate in idempotent reconciliation.
  return comments.filter(
    (comment) =>
      comment.authorType === "Bot" &&
      comment.body?.includes(BUDGET_TRIAGE_COMMENT_MARKER),
  );
}

export function buildBudgetTriageComment(
  result: BudgetRequestTriageResult,
  limits: BudgetRequestPolicyLimits,
): string {
  // Classification comments explain policy without implying that a write occurred.
  const heading = `## Budget request triage: ${result.classification}`;
  const details =
    result.classification === "invalid"
      ? [
          "This request is invalid. Correct every item below and edit the issue:",
          "",
          ...result.errors.map((error) => `- ${error}`),
        ]
      : result.classification === "auto-eligible"
        ? [
            "This request is within both configured auto-eligibility limits.",
            "",
            `- Maximum increase: ${limits.maxDeltaCredits} credits`,
            `- Maximum total: ${limits.maxTotalCredits} credits`,
            "",
            "**No budget change was made.** Eligibility is classification only.",
          ]
        : [
            "This request is valid but requires approval because it is outside the configured auto-eligibility policy or auto-eligibility is disabled.",
            "",
            `- Maximum increase: ${limits.maxDeltaCredits} credits`,
            `- Maximum total: ${limits.maxTotalCredits} credits`,
            "",
            "**No budget change was made.**",
          ];

  return [BUDGET_TRIAGE_COMMENT_MARKER, heading, "", ...details].join("\n");
}

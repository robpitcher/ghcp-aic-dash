import { dump } from "js-yaml";
import {
  containsForbiddenYamlKey,
  containsYamlReference,
  hasExcessiveYamlDepth,
  isPlainObject,
  loadSafeYaml,
} from "./safe-yaml";

export const BUDGET_APPROVAL_LABEL = "budget-approved";
export const BUDGET_APPLIED_LABEL = "budget-applied";
export const BUDGET_ADMIN_REVIEW_LABEL = "budget-needs-admin-review";
export const BUDGET_APPLY_COMMENT_MARKER = "<!-- ghcp-aic-budget-apply -->";
export const BUDGET_APPLY_PREVIEW_COMMENT_MARKER =
  "<!-- ghcp-aic-budget-apply-preview -->";
export const BUDGET_ROLLBACK_COMMENT_MARKER =
  "<!-- ghcp-aic-budget-rollback -->";
export const BUDGET_APPLY_SCHEMA = "ghcp-aic-budget-apply:v1";
export const MAX_BUDGET_AUDIT_COMMENT_LENGTH = 32_768;
export const MAX_BUDGET_AUDIT_YAML_LENGTH = 8_192;
export const MAX_BUDGET_AUDIT_YAML_DEPTH = 3;

const EXPECTED_KEYS = [
  "schema",
  "action_type",
  "before_amount_usd",
  "after_amount_usd",
  "budget_scope",
  "budget_id",
  "requester",
  "expiration_date",
  "run_id",
  "actor",
  "status",
] as const;

export type BudgetApplyAction = "patched-existing" | "created-override";
export type BudgetApplyStatus = "applied" | "reverted";

export interface BudgetApplyAudit {
  schema: typeof BUDGET_APPLY_SCHEMA;
  action_type: BudgetApplyAction;
  before_amount_usd: number;
  after_amount_usd: number;
  budget_scope: "user";
  budget_id: string;
  requester: string;
  expiration_date: string;
  run_id: string;
  actor: string;
  status: BudgetApplyStatus;
}

export type BudgetAuditParseResult =
  | { ok: true; audit: BudgetApplyAudit }
  | { ok: false; errors: string[] };

function isAmount(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    Math.round(value * 100) === value * 100
  );
}

export function parseBudgetApplyAudit(body: string): BudgetAuditParseResult {
  // Audit comments are durable workflow state, so reject oversized or
  // unmarked content before attempting YAML extraction.
  if (
    body.length > MAX_BUDGET_AUDIT_COMMENT_LENGTH ||
    !body.includes(BUDGET_APPLY_COMMENT_MARKER)
  ) {
    return { ok: false, errors: ["Audit comment is missing or oversized."] };
  }

  const fence = /```yaml[^\S\r\n]*\r?\n([\s\S]*?)```/gi;
  const yaml = Array.from(body.matchAll(fence), (match) => match[1]).find(
    (block) => block.includes(BUDGET_APPLY_SCHEMA),
  );
  if (!yaml) return { ok: false, errors: ["Audit YAML block is missing."] };
  if (yaml.length > MAX_BUDGET_AUDIT_YAML_LENGTH) {
    return { ok: false, errors: ["Audit YAML exceeds the size limit."] };
  }
  if (containsForbiddenYamlKey(yaml) || containsYamlReference(yaml)) {
    return { ok: false, errors: ["Audit YAML contains unsafe constructs."] };
  }

  let document: unknown;
  try {
    document = loadSafeYaml(yaml);
  } catch {
    return { ok: false, errors: ["Audit YAML is not valid safe YAML."] };
  }
  if (
    !isPlainObject(document) ||
    hasExcessiveYamlDepth(document, MAX_BUDGET_AUDIT_YAML_DEPTH)
  ) {
    return { ok: false, errors: ["Audit YAML must be a shallow plain object."] };
  }

  // Exact keys and field order keep the persisted state deterministic and
  // prevent newer or malicious fields from changing rollback interpretation.
  const errors: string[] = [];
  const keys = Object.keys(document);
  for (const key of EXPECTED_KEYS) {
    if (!Object.hasOwn(document, key)) errors.push(`Missing field: ${key}.`);
  }
  for (const key of keys) {
    if (!(EXPECTED_KEYS as readonly string[]).includes(key)) {
      errors.push(`Unexpected field: ${key}.`);
    }
  }
  if (
    keys.length === EXPECTED_KEYS.length &&
    keys.some((key, index) => key !== EXPECTED_KEYS[index])
  ) {
    errors.push("Audit fields are not in the documented order.");
  }
  if (document.schema !== BUDGET_APPLY_SCHEMA) errors.push("Invalid schema.");
  if (
    document.action_type !== "patched-existing" &&
    document.action_type !== "created-override"
  ) {
    errors.push("Invalid action_type.");
  }
  if (!isAmount(document.before_amount_usd)) {
    errors.push("Invalid before_amount_usd.");
  }
  if (!isAmount(document.after_amount_usd)) {
    errors.push("Invalid after_amount_usd.");
  }
  if (document.budget_scope !== "user") errors.push("Invalid budget_scope.");
  if (typeof document.budget_id !== "string" || !document.budget_id) {
    errors.push("Invalid budget_id.");
  }
  if (
    typeof document.requester !== "string" ||
    !/^[A-Za-z\d](?:[A-Za-z\d_-]{0,38})$/.test(document.requester)
  ) {
    errors.push("Invalid requester.");
  }
  if (
    typeof document.expiration_date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(document.expiration_date)
  ) {
    errors.push("Invalid expiration_date.");
  }
  if (typeof document.run_id !== "string" || !/^\d+$/.test(document.run_id)) {
    errors.push("Invalid run_id.");
  }
  if (typeof document.actor !== "string" || !document.actor) {
    errors.push("Invalid actor.");
  }
  if (document.status !== "applied" && document.status !== "reverted") {
    errors.push("Invalid status.");
  }

  return errors.length
    ? { ok: false, errors }
    : { ok: true, audit: document as unknown as BudgetApplyAudit };
}

export function buildBudgetApplyComment(
  audit: BudgetApplyAudit,
  runUrl: string,
  dryRun = false,
): string {
  // The human summary and machine-readable block intentionally travel together;
  // rollback later treats this marked comment as its state store.
  const heading = dryRun
    ? "## Budget request apply: dry run"
    : audit.status === "reverted"
      ? "## Budget request reverted"
      : "## Budget request applied";
  return [
    BUDGET_APPLY_COMMENT_MARKER,
    heading,
    "",
    `- Action: \`${audit.action_type}\``,
    `- Before: $${audit.before_amount_usd}`,
    `- After: $${audit.after_amount_usd}`,
    `- Expiration: ${audit.expiration_date}`,
    `- Workflow run: [${audit.run_id}](${runUrl})`,
    `- Actor: @${audit.actor}`,
    "",
    "```yaml",
    dump(audit, { noRefs: true, lineWidth: -1, sortKeys: false }).trimEnd(),
    "```",
  ].join("\n");
}

export function buildBudgetApplyPreviewComment(input: {
  action: BudgetApplyAction;
  requestedIncreaseUsd: number;
  requestedAfterUsd: number;
  expirationDate: string;
  runId: string;
  runUrl: string;
  actor: string;
}): string {
  return [
    BUDGET_APPLY_PREVIEW_COMMENT_MARKER,
    "## Budget request apply preview",
    "",
    `- Action: \`${input.action}\``,
    `- Requested increase: $${input.requestedIncreaseUsd}`,
    `- Requested total: $${input.requestedAfterUsd}`,
    `- Expiration: ${input.expirationDate}`,
    `- Workflow run: [${input.runId}](${input.runUrl})`,
    `- Triggered by: @${input.actor}`,
    "",
    "**No budget change was made.** Requester identity and live budget state are revalidated again inside the protected write job.",
  ].join("\n");
}

export function buildRollbackComment(
  audit: BudgetApplyAudit,
  runUrl: string,
  runId: string,
  refusedReason?: string,
): string {
  return [
    BUDGET_ROLLBACK_COMMENT_MARKER,
    refusedReason
      ? "## Budget rollback requires administrator review"
      : "## Temporary budget increase reverted",
    "",
    refusedReason ??
      `Restored the pre-request state for \`${audit.action_type}\`.`,
    "",
    `- Workflow run: [${runId}](${runUrl})`,
  ].join("\n");
}

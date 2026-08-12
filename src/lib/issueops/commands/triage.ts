import { readFile } from "node:fs/promises";
import {
  BUDGET_APPROVAL_LABEL,
  BUDGET_APPLIED_LABEL,
  BUDGET_APPLY_COMMENT_MARKER,
  BUDGET_CLASSIFICATION_LABELS,
  BUDGET_LABELS,
  BUDGET_REQUEST_LABEL,
  BUDGET_TRIAGE_COMMENT_MARKER,
  GitHubIssueOpsClient,
  buildBudgetTriageComment,
  getBudgetClassificationLabel,
  getIssueOpsPolicyLimits,
  isBudgetRequestIssue,
  loadIssueOpsConfig,
  parseBudgetApplyAudit,
  triageBudgetRequest,
  type IssueOpsConfig,
  type IssueOpsClient,
} from "../index";

interface IssueEvent {
  action: string;
  repository: { full_name: string };
  issue: {
    number: number;
    title: string;
    body: string | null;
    user: { login: string };
    labels: Array<{ name: string }>;
  };
}

const LABELS = [
  {
    name: BUDGET_REQUEST_LABEL,
    color: "0969da",
    description: "Recognized AI credit budget request",
  },
  {
    name: "budget-invalid",
    color: "d1242f",
    description: "AI credit budget request failed validation",
  },
  {
    name: "budget-needs-approval",
    color: "bf8700",
    description: "AI credit budget request requires human approval",
  },
  {
    name: "budget-auto-eligible",
    color: "1a7f37",
    description: "AI credit budget request is within policy limits",
  },
] as const;

export interface TriageCommandOptions {
  githubToken: string;
  eventPath: string;
  configPath?: string;
  readEvent?: (path: string, encoding: "utf8") => Promise<string>;
  createClient?: (
    token: string,
    repository: string,
  ) => IssueOpsClient;
  loadConfig?: (path?: string) => Promise<IssueOpsConfig>;
  log?: (message: string) => void;
}

export interface TriageCommandResult {
  ignored: boolean;
  issueNumber?: number;
  classification?: string;
}

export async function runTriageCommand(
  options: TriageCommandOptions,
): Promise<TriageCommandResult> {
  const readEvent = options.readEvent ?? readFile;
  const log = options.log ?? console.log;
  const event = JSON.parse(
    await readEvent(options.eventPath, "utf8"),
  ) as IssueEvent;
  const issues =
    options.createClient?.(
      options.githubToken,
      event.repository.full_name,
    ) ??
    new GitHubIssueOpsClient(
      options.githubToken,
      event.repository.full_name,
    );
  const labels = new Set(event.issue.labels.map((label) => label.name));
  if (labels.has(BUDGET_APPLIED_LABEL)) {
    const comments = await issues.listComments(event.issue.number);
    const activeAudits = comments
      .filter(
        (comment) =>
          comment.user.type === "Bot" &&
          comment.body?.includes(BUDGET_APPLY_COMMENT_MARKER),
      )
      .map((comment) => parseBudgetApplyAudit(comment.body ?? ""))
      .filter((result) => result.ok && result.audit.status === "applied");
    if (activeAudits.length !== 1) {
      throw new Error(
        `Applied issue #${event.issue.number} must have exactly one active audit record.`,
      );
    }
    await issues.reconcileLabels(
      event.issue.number,
      [BUDGET_REQUEST_LABEL, BUDGET_APPLIED_LABEL],
      [...BUDGET_CLASSIFICATION_LABELS, BUDGET_APPROVAL_LABEL],
    );
    await issues.upsertMarkedComment(
      event.issue.number,
      BUDGET_TRIAGE_COMMENT_MARKER,
      `${BUDGET_TRIAGE_COMMENT_MARKER}
## Budget request state: applied

This request has already been applied. Later edits to the issue do not change the approved amount, expiration, or rollback schedule. The bot-authored apply audit remains authoritative.`,
    );
    log("Ignored edits to an applied request; preserved audit-backed state.");
    return {
      ignored: false,
      issueNumber: event.issue.number,
      classification: "applied",
    };
  }
  const body = event.issue.body ?? "";
  if (!isBudgetRequestIssue(event.issue.title, body)) {
    log("Ignoring unrelated issue.");
    return { ignored: true };
  }

  const config = await (options.loadConfig ?? loadIssueOpsConfig)(
    options.configPath,
  );
  const limits = getIssueOpsPolicyLimits(config);
  const result = triageBudgetRequest({
    title: event.issue.title,
    body,
    authorLogin: event.issue.user.login,
    limits,
  });
  await issues.ensureLabels([...LABELS]);
  await issues.reconcileLabels(
    event.issue.number,
    [
      BUDGET_REQUEST_LABEL,
      getBudgetClassificationLabel(result.classification),
    ],
    [
      ...BUDGET_CLASSIFICATION_LABELS,
      ...(event.action === "edited" ? [BUDGET_APPROVAL_LABEL] : []),
    ],
  );
  await issues.upsertMarkedComment(
    event.issue.number,
    BUDGET_TRIAGE_COMMENT_MARKER,
    buildBudgetTriageComment(result, limits),
  );

  log(`Classified issue as ${result.classification}.`);
  return {
    ignored: false,
    issueNumber: event.issue.number,
    classification: result.classification,
  };
}

export function getTriageLabels(): readonly string[] {
  return BUDGET_LABELS;
}

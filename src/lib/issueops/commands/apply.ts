import {
  BUDGET_ADMIN_REVIEW_LABEL,
  BUDGET_APPLIED_LABEL,
  BUDGET_APPLY_COMMENT_MARKER,
  BUDGET_APPLY_PREVIEW_COMMENT_MARKER,
  BUDGET_APPROVAL_LABEL,
  BUDGET_AUTO_ELIGIBLE_LABEL,
  BUDGET_INVALID_LABEL,
  BUDGET_NEEDS_APPROVAL_LABEL,
  BillingAdminClient,
  GitHubIssueOpsClient,
  buildBudgetApplyComment,
  buildBudgetApplyPreviewComment,
  canWriteBudget,
  getIssueOpsPolicyLimits,
  hasValidBudgetApproval,
  loadIssueOpsConfig,
  parseBudgetApplyAudit,
  parseIssueNumber,
  planBudgetApply,
  requireIssueOpsEnterpriseSlug,
  triageBudgetRequest,
  type BudgetApplyAudit,
  type BudgetAdminClient,
  type IssueOpsConfig,
  type IssueOpsClient,
} from "../index";

export interface ApplyCommandOptions {
  githubToken: string;
  repository: string;
  actor: string;
  runId: string;
  issueNumber: string;
  dryRun: boolean;
  writeEnabled: string | undefined;
  billingToken?: string;
  serverUrl?: string;
  configPath?: string;
  publishPreview?: boolean;
  createIssuesClient?: (
    token: string,
    repository: string,
  ) => IssueOpsClient;
  createBillingClient?: (
    token: string,
    enterprise: string,
  ) => BudgetAdminClient;
  loadConfig?: (path?: string) => Promise<IssueOpsConfig>;
  log?: (message: string) => void;
}

export type ApplyCommandResult =
  | {
      mode: "dry-run";
      issue: number;
      requester: string;
      action: "patched-existing" | "created-override";
      requestedIncreaseUsd: number;
      requestedAfterUsd: number;
      expirationDate: string;
      liveRevalidationRequiredBeforeWrite: true;
      mutatingCalls: 0;
    }
  | { mode: "noop"; issue: number; message: string }
  | {
      mode: "write";
      issue: number;
      action: "patched-existing" | "created-override";
    };

export async function runApplyCommand(
  options: ApplyCommandOptions,
): Promise<ApplyCommandResult> {
  const issueNumber = parseIssueNumber(options.issueNumber);
  if (!issueNumber) {
    throw new Error("ISSUE_NUMBER must contain digits only.");
  }
  const log = options.log ?? console.log;
  const config = await (options.loadConfig ?? loadIssueOpsConfig)(
    options.configPath,
  );
  const issues =
    options.createIssuesClient?.(
      options.githubToken,
      options.repository,
    ) ?? new GitHubIssueOpsClient(options.githubToken, options.repository);

  if (canWriteBudget(options.dryRun, options.writeEnabled)) {
    await issues.ensureLabels([
      {
        name: BUDGET_APPROVAL_LABEL,
        color: "8250df",
        description: "Administrator approval for an AI credit budget request",
      },
      {
        name: BUDGET_APPLIED_LABEL,
        color: "1a7f37",
        description: "Temporary AI credit budget increase applied",
      },
      {
        name: BUDGET_ADMIN_REVIEW_LABEL,
        color: "d1242f",
        description: "Budget rollback requires administrator review",
      },
    ]);
  }

  const issue = await issues.getIssue(issueNumber);
  if (!issue) {
    throw new Error(`Issue #${issueNumber} was not found.`);
  }
  const triage = triageBudgetRequest({
    title: issue.title,
    body: issue.body ?? "",
    authorLogin: issue.user.login,
    limits: getIssueOpsPolicyLimits(config),
  });
  if (triage.classification === "invalid" || !triage.request) {
    throw new Error(
      `Policy revalidation failed: ${triage.errors.join(" ")}`,
    );
  }

  const labels = new Set(issue.labels.map((label) => label.name));
  if (!hasValidBudgetApproval(labels, triage.classification)) {
    throw new Error(
      `Issue requires ${BUDGET_AUTO_ELIGIBLE_LABEL} or ${BUDGET_APPROVAL_LABEL}.`,
    );
  }

  const comments = await issues.listComments(issueNumber);
  const marked = comments.filter(
    (comment) =>
      comment.user.type === "Bot" &&
      comment.body?.includes(BUDGET_APPLY_COMMENT_MARKER),
  );
  let existingAudit: BudgetApplyAudit | undefined;
  for (const comment of marked) {
    const parsed = parseBudgetApplyAudit(comment.body ?? "");
    if (!parsed.ok) {
      throw new Error(
        `Existing audit comment is malformed: ${parsed.errors.join(" ")}`,
      );
    }
    if (parsed.audit.status === "applied") {
      existingAudit = parsed.audit;
      break;
    }
  }
  if (existingAudit?.status === "applied") {
    const message = "This request already has an applied audit record.";
    await issues.reconcileLabels(
      issueNumber,
      [BUDGET_APPLIED_LABEL],
      [
        BUDGET_AUTO_ELIGIBLE_LABEL,
        BUDGET_NEEDS_APPROVAL_LABEL,
        BUDGET_INVALID_LABEL,
        BUDGET_APPROVAL_LABEL,
      ],
    );
    log(`No-op: ${message}`);
    return { mode: "noop", issue: issueNumber, message };
  }

  const request = triage.request;
  if (!canWriteBudget(options.dryRun, options.writeEnabled)) {
    const result: ApplyCommandResult = {
      mode: "dry-run",
      issue: issueNumber,
      requester: request.requester,
      action:
        request.effective_source === "individual"
          ? "patched-existing"
          : "created-override",
      requestedIncreaseUsd: request.requested_increase_credits / 100,
      requestedAfterUsd: request.requested_total_credits / 100,
      expirationDate: request.expiration_date,
      liveRevalidationRequiredBeforeWrite: true,
      mutatingCalls: 0,
    };
    if (options.publishPreview) {
      const serverUrl = options.serverUrl ?? "https://github.com";
      const runUrl =
        `${serverUrl}/${options.repository}/actions/runs/${options.runId}`;
      await issues.upsertMarkedComment(
        issueNumber,
        BUDGET_APPLY_PREVIEW_COMMENT_MARKER,
        buildBudgetApplyPreviewComment({
          action: result.action,
          requestedIncreaseUsd: result.requestedIncreaseUsd,
          requestedAfterUsd: result.requestedAfterUsd,
          expirationDate: result.expirationDate,
          runId: options.runId,
          runUrl,
          actor: options.actor,
        }),
      );
    }
    log(JSON.stringify(result, null, 2));
    return result;
  }

  if (!options.billingToken) {
    throw new Error("GH_BILLING_ADMIN_TOKEN is required for writes.");
  }
  const enterprise = requireIssueOpsEnterpriseSlug(config);
  const verifiedRequester = await issues.getVerifiedLogin(request.requester);
  const billing =
    options.createBillingClient?.(options.billingToken, enterprise) ??
    new BillingAdminClient(options.billingToken, enterprise);
  const liveBudgets = await billing.getUserBudgets(verifiedRequester);
  const plan = planBudgetApply({
    request,
    verifiedRequester,
    liveBudgets,
    existingAudit,
    runId: options.runId,
    actor: options.actor,
  });
  if (plan.outcome !== "apply") {
    throw new Error(`${plan.outcome}: ${plan.message}`);
  }

  if (plan.action === "patched-existing" && plan.budgetId) {
    await billing.patchBudget(plan.budgetId, plan.mutationBody);
  } else {
    const created = await billing.createBudget(plan.mutationBody);
    if (!created?.id) {
      throw new Error("Created budget response did not include an id.");
    }
    plan.audit.budget_id = created.id;
  }

  const serverUrl = options.serverUrl ?? "https://github.com";
  const runUrl =
    `${serverUrl}/${options.repository}/actions/runs/${options.runId}`;
  await issues.upsertMarkedComment(
    issueNumber,
    BUDGET_APPLY_COMMENT_MARKER,
    buildBudgetApplyComment(plan.audit, runUrl),
  );
  await issues.reconcileLabels(
    issueNumber,
    [BUDGET_APPLIED_LABEL],
    [
      BUDGET_AUTO_ELIGIBLE_LABEL,
      BUDGET_NEEDS_APPROVAL_LABEL,
      BUDGET_INVALID_LABEL,
      BUDGET_APPROVAL_LABEL,
    ],
  );
  log(`Applied ${plan.action} for issue #${issueNumber}.`);
  return { mode: "write", issue: issueNumber, action: plan.action };
}

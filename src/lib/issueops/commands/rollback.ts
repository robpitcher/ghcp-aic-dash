import {
  BUDGET_ADMIN_REVIEW_LABEL,
  BUDGET_APPLIED_LABEL,
  BUDGET_APPLY_COMMENT_MARKER,
  BUDGET_ROLLBACK_COMMENT_MARKER,
  BillingAdminClient,
  GitHubIssueOpsClient,
  buildBudgetApplyComment,
  buildRollbackComment,
  canWriteBudget,
  loadIssueOpsConfig,
  parseBudgetApplyAudit,
  parseIssueNumber,
  planBudgetRollback,
  requireIssueOpsEnterpriseSlug,
  type BudgetApplyAudit,
  type BudgetAdminClient,
  type IssueOpsConfig,
  type IssueOpsClient,
  type WorkflowIssue,
} from "../index";

interface RollbackCandidate {
  issue: WorkflowIssue;
  audit: BudgetApplyAudit;
}

export interface RollbackCommandOptions {
  githubToken: string;
  repository: string;
  actor: string;
  runId: string;
  dryRun: boolean;
  writeEnabled: string | undefined;
  billingToken?: string;
  serverUrl?: string;
  configPath?: string;
  now?: Date;
  issueNumber?: string;
  forceBeforeExpiration?: boolean;
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

export interface RollbackCommandResult {
  mode: "dry-run" | "write";
  expiredCount: number;
  processedCount: number;
  mutatingCalls?: 0;
}

async function discoverRollbackCandidates(
  issues: IssueOpsClient,
  now: Date,
  issueNumber?: string,
  forceBeforeExpiration = false,
): Promise<RollbackCandidate[]> {
  let applied: WorkflowIssue[];
  if (issueNumber) {
    const parsed = parseIssueNumber(issueNumber);
    if (!parsed) {
      throw new Error("ISSUE_NUMBER must contain digits only.");
    }
    const issue = await issues.getIssue(parsed);
    if (!issue) {
      throw new Error(`Issue #${parsed} was not found.`);
    }
    applied = [issue];
  } else {
    applied = await issues.findAppliedIssues();
  }
  const candidates: RollbackCandidate[] = [];
  for (const issue of applied) {
    const comments = await issues.listComments(issue.number);
    const marked = comments.filter(
      (comment) =>
        comment.user.type === "Bot" &&
        comment.body?.includes(BUDGET_APPLY_COMMENT_MARKER),
    );
    if (marked.length === 0) {
      const labels = new Set(issue.labels.map((label) => label.name));
      if (labels.has(BUDGET_APPLIED_LABEL)) {
        throw new Error(
          `Applied issue #${issue.number} is missing its apply audit state.`,
        );
      }
      continue;
    }
    const parsed = marked.map((comment) =>
      parseBudgetApplyAudit(comment.body ?? ""),
    );
    const malformed = parsed.find((result) => !result.ok);
    if (malformed && !malformed.ok) {
      throw new Error(
        `Applied issue #${issue.number} has malformed audit state: ${malformed.errors.join(" ")}`,
      );
    }
    const active = parsed
      .filter((result) => result.ok)
      .map((result) => result.audit)
      .filter((audit) => audit.status === "applied");
    if (active.length !== 1) {
      throw new Error(
        `Applied issue #${issue.number} must have exactly one active audit record.`,
      );
    }
    const audit = active[0];
    if (
      forceBeforeExpiration ||
      now.toISOString().slice(0, 10) > audit.expiration_date
    ) {
      candidates.push({ issue, audit });
    }
  }
  return candidates;
}

export async function runRollbackCommand(
  options: RollbackCommandOptions,
): Promise<RollbackCommandResult> {
  const log = options.log ?? console.log;
  const now = options.now ?? new Date();
  const issues =
    options.createIssuesClient?.(
      options.githubToken,
      options.repository,
    ) ?? new GitHubIssueOpsClient(options.githubToken, options.repository);
  const candidates = await discoverRollbackCandidates(
    issues,
    now,
    options.issueNumber,
    options.forceBeforeExpiration,
  );

  if (!canWriteBudget(options.dryRun, options.writeEnabled)) {
    log(
      JSON.stringify(
        {
          mode: "dry-run",
          writeEnabled: options.writeEnabled === "true",
          expiredRequests: candidates.map(({ issue, audit }) => ({
            issue: issue.number,
            requester: audit.requester,
            action:
              audit.action_type === "created-override"
                ? "delete-override"
                : "restore-existing",
            originalAmountUsd: audit.before_amount_usd,
            appliedAmountUsd: audit.after_amount_usd,
          })),
          liveRevalidationRequiredBeforeWrite: true,
          mutatingCalls: 0,
        },
        null,
        2,
      ),
    );
    return {
      mode: "dry-run",
      expiredCount: candidates.length,
      processedCount: 0,
      mutatingCalls: 0,
    };
  }

  const config = await (options.loadConfig ?? loadIssueOpsConfig)(
    options.configPath,
  );
  if (!options.billingToken) {
    throw new Error("GH_BILLING_ADMIN_TOKEN is required for writes.");
  }
  const enterprise = requireIssueOpsEnterpriseSlug(config);
  const billing =
    options.createBillingClient?.(options.billingToken, enterprise) ??
    new BillingAdminClient(options.billingToken, enterprise);
  const serverUrl = options.serverUrl ?? "https://github.com";
  const runUrl =
    `${serverUrl}/${options.repository}/actions/runs/${options.runId}`;

  await issues.ensureLabels([
    {
      name: BUDGET_ADMIN_REVIEW_LABEL,
      color: "d1242f",
      description: "Budget rollback requires administrator review",
    },
  ]);

  let processedCount = 0;
  for (const { issue, audit } of candidates) {
    const verified = await issues.getVerifiedLogin(audit.requester);
    if (verified.toLowerCase() !== audit.requester) {
      throw new Error(
        `Requester revalidation failed for issue #${issue.number}.`,
      );
    }
    const live = await billing.getUserBudgets(verified);
    const plan = planBudgetRollback(
      audit,
      live,
      now,
      options.forceBeforeExpiration,
    );
    if (plan.outcome === "refused") {
      await issues.upsertMarkedComment(
        issue.number,
        BUDGET_ROLLBACK_COMMENT_MARKER,
        buildRollbackComment(
          audit,
          runUrl,
          options.runId,
          plan.message,
        ),
      );
      await issues.reconcileLabels(
        issue.number,
        [BUDGET_ADMIN_REVIEW_LABEL],
        [],
      );
      continue;
    }
    if (
      plan.outcome !== "rollback" &&
      plan.outcome !== "already-reverted"
    ) {
      log(`No-op for issue #${issue.number}: ${plan.message}`);
      continue;
    }
    if (plan.outcome === "rollback") {
      if (plan.action === "delete-override") {
        await billing.deleteBudget(plan.budgetId);
      } else {
        if (!plan.mutationBody) {
          throw new Error("Restore plan is missing its mutation body.");
        }
        await billing.patchBudget(plan.budgetId, plan.mutationBody);
      }
    }

    audit.status = "reverted";
    audit.run_id = options.runId;
    audit.actor = options.actor;
    await issues.upsertMarkedComment(
      issue.number,
      BUDGET_APPLY_COMMENT_MARKER,
      buildBudgetApplyComment(audit, runUrl),
    );
    await issues.upsertMarkedComment(
      issue.number,
      BUDGET_ROLLBACK_COMMENT_MARKER,
      buildRollbackComment(audit, runUrl, options.runId),
    );
    await issues.reconcileLabels(
      issue.number,
      [],
      [BUDGET_APPLIED_LABEL],
    );
    await issues.closeIssue(issue.number);
    processedCount += 1;
  }

  log(`Processed ${candidates.length} selected budget request(s).`);
  return {
    mode: "write",
    expiredCount: candidates.length,
    processedCount,
  };
}

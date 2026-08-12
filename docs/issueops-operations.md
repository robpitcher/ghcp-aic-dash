# IssueOps Operations

This runbook covers approval, apply, rollback, incident response, and credential
rotation. See the [IssueOps quickstart](./issueops.md) for installation and the
[protocol reference](./issueops-protocol.md) for schemas and markers.

## Triage and approval

Triage runs when a matching issue is opened or edited. It validates the request
schema, exact title, author, current UTC expiration, arithmetic, and checked-in
policy. It removes stale classification labels and applies exactly one of:

- `budget-invalid`;
- `budget-needs-approval`;
- `budget-auto-eligible`.

Editing the title or body also removes `budget-approved`. A human reviewer must
review the new content and reapply approval. This prevents approval from
silently carrying over to a changed request.

A request can pass apply authorization through:

- a current `budget-auto-eligible` label and fresh policy revalidation; or
- a human-applied `budget-approved` label.

Neither label bypasses request or live-state validation.

## Approval trigger

When a human adds `budget-approved`, the apply workflow starts the protected
write job if `BUDGET_WRITE_ENABLED=true`. The job still requires the
`budget-approver` environment and its configured reviewers before the
administrator credential is released.

If writes are disabled, the same label event runs an unprivileged preview. It
updates one marked comment with:

- the expected patch-or-override action;
- requested increase and total;
- expiration;
- workflow run and actor;
- a warning that live state will be revalidated before write.

The preview uses no administrator token and performs no billing mutation.

## Dry-run apply

Dispatch **Apply approved AI credit budget request** with:

- `issue_number`: digits only.

Dry-run re-fetches the issue, revalidates schema and approval, and reports the
request-derived plan. Output includes `"mode": "dry-run"` and
`"mutatingCalls": 0`.

## Protected apply

A real apply requires all of:

1. A human adding the `budget-approved` label.
2. Repository variable `BUDGET_WRITE_ENABLED=true`.
3. A valid issue number and request under current checked-in policy.
4. A valid policy or human approval label.
5. The protected `budget-approver` environment.
6. Required environment reviewer approval.
7. Environment secret `GH_BILLING_ADMIN_TOKEN`.
8. A configured `enterprise_slug`.
9. Matching live requester, budget source, and amount.
10. No existing active apply audit.

Immediately before mutation, apply verifies the requester through GitHub,
fetches live user budgets using API version `2026-03-10`, and confirms the
issue is not stale.

Apply patches an existing individual budget or creates a temporary user-level
override for an inherited budget. Both preserve
`prevent_further_usage: true`.

After success, apply updates one marked audit comment, adds
`budget-applied`, and removes request classification and approval labels.
That bot-authored audit is authoritative: later issue-body edits do not change
the active amount, expiration, or rollback schedule. Rollback discovery
includes open and closed applied issues, so closing a request cannot hide it
from expiration processing.

## Rollback

The rollback workflow runs daily at `04:23 UTC` and can be manually dispatched.
An administrator can roll back one applied request before expiration by
providing its `issue_number` and setting `dry_run=false`. Targeted early
rollback still requires `BUDGET_WRITE_ENABLED=true`, the protected
`budget-approver` environment, live budget revalidation, and the dedicated
administrator credential.

### Discovery

The first job is credential-free. It scans open and closed recognized and
`budget-applied` requests, treats a valid apply audit as the source of truth,
and emits the number of expired candidates. This keeps an applied request
discoverable if operational label reconciliation failed after mutation.

The protected job is queued only when:

- `BUDGET_WRITE_ENABLED=true`;
- the invocation permits writes; and
- discovery found at least one candidate.

This avoids empty environment approval requests. Discovery is only an
optimization, not authorization.

### Protected rollback

The protected job independently re-fetches issues, audits, requester identity,
and live budgets. It does not trust the earlier candidate result.

Rollback:

- deletes an automation-created user override; or
- restores the recorded amount on a patched user budget while retaining the
  hard stop.

On success, it marks the audit `reverted`, updates the rollback comment,
removes `budget-applied`, and closes the issue.

## Conflict handling

Rollback refuses to overwrite a later administrator change. If the live amount
differs from the apply audit:

- no billing mutation occurs;
- `budget-needs-admin-review` is added;
- one marked rollback comment records the reason;
- the issue and active audit remain open for investigation.

A missing automation-created override is treated as already reverted. A
missing originally patched budget requires administrator review.

## Operator checklist

Before apply:

- schema, author, title, expiration, and policy classification are current;
- the approval label is appropriate;
- the preview and manual dry-run match the intended user and amounts;
- protected environment reviewers are available;
- reviewed workflow and configuration changes are on the permitted branch.

After apply:

- one marked apply audit exists;
- `budget-applied` is present;
- budget ID, action, before/after amounts, and expiration are correct;
- scheduled rollback discovery is enabled.

After rollback:

- audit status is `reverted`;
- `budget-applied` is removed;
- the issue is closed;
- live state matches the recorded original state;
- conflicts are labeled for administrator review.

## Emergency disable

1. Set `BUDGET_WRITE_ENABLED=false` or delete the variable.
2. Cancel waiting `budget-approver` deployments.
3. Preserve audit comments.
4. Review open `budget-applied` issues.
5. Review `budget-needs-admin-review` issues.
6. Compare workflow runs with live billing state before re-enabling.

Every value other than exact lower-case `true` disables writes.

## Credential rotation

1. Disable writes.
2. Cancel waiting protected deployments.
3. Create a replacement least-privilege credential.
4. Replace `GH_BILLING_ADMIN_TOKEN` in `budget-approver`.
5. Run apply and rollback dry runs.
6. Perform an approved non-production write and rollback check.
7. Confirm audit comments and labels.
8. Revoke the old credential.
9. Re-enable writes only after verification.

Rotate the dashboard read token separately. Never replace one with the other.
The automation credential is a classic PAT with
`manage_billing:enterprise`, created by the dedicated enterprise-owner
automation identity.

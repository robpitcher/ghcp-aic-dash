# Budget Request IssueOps

IssueOps uses GitHub issues, labels, comments, and workflows to review temporary
AI credit budget increases. The dashboard can display usage and budgets without
IssueOps.

The destination repository installs thin workflows that call the bundled
IssueOps action from this repository at an immutable commit SHA. It does not
copy dashboard source, TypeScript scripts, or package dependencies.

See [operations](./issueops-operations.md) for the operator runbook,
[protocol](./issueops-protocol.md) for schemas and markers,
[configuration](./configuration.md) for dashboard settings, and
[security](./security.md) for trust boundaries.

## Safety model

- The browser submits only an increase and justification.
- The dashboard re-fetches the signed-in user's live budget and prepares a
  reviewable issue URL.
- Triage and apply previews use no billing administrator credential.
- Dry-run is the default.
- `BUDGET_WRITE_ENABLED` must equal exactly `true` before a write job can run.
- Real apply and rollback jobs use the protected `budget-approver` environment.
- `GH_BILLING_ADMIN_TOKEN` is a separate environment secret.
- Apply and rollback revalidate GitHub identity and live budget state before
  mutation.
- Marked issue comments remain the audit state store.

## Choose an operating level

| Level | Installed behavior | Administrator credential |
| --- | --- | --- |
| `triage` | Request template, validation, classification labels, and one marked triage comment | Not required |
| `dry-run` | Triage plus manual apply plans and rollback discovery | Not required |
| `protected-writes` | Dry-run behavior plus environment-protected apply and rollback | Required in `budget-approver` |

Start at `triage` or `dry-run`. Enable protected writes only after the lower
level is working.

## Prerequisites

- Node.js 20 or later and npm;
- GitHub CLI authenticated as a destination-repository administrator;
- GitHub Actions enabled in the destination repository;
- a dashboard already able to read the intended enterprise's usage and budgets;
- appropriate repository visibility for the budget and usage data stored in
  request issues;
- for protected writes, a dedicated automation identity with least-privilege
  enterprise budget administration access. Because rollback can delete a
  temporary override, the identity must be an enterprise owner under the
  current budget API authorization rules.

## Configure the action repository

Setup needs the `OWNER/REPO` where this project's IssueOps action is published.
Set it for the current shell:

```powershell
$env:ISSUEOPS_ACTION_REPOSITORY = "OWNER/REPO"
```

You can instead pass `--action-repo OWNER/REPO` to each setup or doctor
command. Public action repositories need no additional repository access.
For private or internal action repositories, configure GitHub Actions access
for each destination repository. Organization or enterprise Actions policies
can override repository settings.

## Install

From an administrator checkout of this repository:

```powershell
npm install
npm run issueops:setup -- --repo OWNER/REPO --level dry-run --action-ref issueops-v1
```

Setup is plan-only by default. It resolves the supplied release tag or ref to a
commit SHA and prints the proposed changes. Review the plan, then apply it:

```powershell
npm run issueops:setup -- --repo OWNER/REPO --level dry-run --action-ref issueops-v1 --apply
```

For protected writes, supply the enterprise slug in checked-in configuration:

```powershell
npm run issueops:setup -- --repo OWNER/REPO --level protected-writes --action-ref issueops-v1 --enterprise-slug ENTERPRISE --apply
```

Optional policy limits are non-negative credit values:

```powershell
npm run issueops:setup -- --repo OWNER/REPO --level protected-writes --action-ref issueops-v1 --enterprise-slug ENTERPRISE --max-delta 1500 --max-total 5000 --apply
```

Setup reads the budget-request template from
`templates/issueops/ai-credit-budget-request.md` in this repository and creates
it at `.github/ISSUE_TEMPLATE/ai-credit-budget-request.md` in the destination
repository. It also creates or updates the applicable workflow files,
checked-in configuration, labels, and safe write flag. Protected-write setup
also ensures the `budget-approver` environment exists and restricts it to
protected branches. It does not upload the administrator credential or choose
environment reviewers.

## Checked-in policy

The destination repository owns:

```yaml
# .github/ghcp-aic-issueops.yml
schema: "ghcp-aic-issueops:v1"
enterprise_slug: null
auto_approval:
  max_delta_credits: 0
  max_total_credits: 0
```

`enterprise_slug` may remain `null` for triage and dry-run operation. Protected
writes require a valid lower-case enterprise slug.

Both auto-approval limits must be positive and satisfied for a request to
receive `budget-auto-eligible`. Zero disables auto-eligibility and sends valid
requests to human approval. Policy changes are reviewed through the normal
branch process and apply re-reads the current file.

Protect this configuration and the workflow files with branch protection and,
where appropriate, CODEOWNERS.

## Complete protected-write setup

In **Settings** > **Environments** > **budget-approver**:

1. Add the people or teams authorized to review budget writes.
2. Enable **Prevent self-review**.
3. Restrict deployment branches or tags to reviewed workflow code.
4. Add environment secret `GH_BILLING_ADMIN_TOKEN`.

The secret must belong to a dedicated automation identity. Never reuse the
dashboard's `GITHUB_BILLING_TOKEN`, store the administrator token at repository
scope, or pass it as a setup command argument.

[Create the IssueOps automation PAT with `manage_billing:enterprise`
preselected](https://github.com/settings/tokens/new?description=ghcp-aic-issueops-automation&scopes=manage_billing%3Aenterprise).
Sign in as the dedicated automation identity, choose a short expiration, review
the selected scope, and generate the classic PAT. The token cannot grant rights
the identity does not already have.

Interactive secret entry with GitHub CLI:

```powershell
gh secret set GH_BILLING_ADMIN_TOKEN --env budget-approver --repo OWNER/REPO
```

Keep `BUDGET_WRITE_ENABLED=false` until staged verification is complete.

## Diagnose

```powershell
npm run issueops:doctor -- --repo OWNER/REPO --level dry-run
```

For protected writes:

```powershell
npm run issueops:doctor -- --repo OWNER/REPO --level protected-writes
```

Doctor checks installed files, immutable action pins, configuration validity,
labels, the write flag, and protected-write environment and secret metadata. It
does not read secret values. A failed check returns a nonzero exit code.

## Staged verification

1. Set dashboard runtime value `BUDGET_REQUEST_REPOSITORY=OWNER/REPO` and
   restart or redeploy the dashboard.
2. Submit a request through the dashboard.
3. Confirm triage applies `budget-request` and exactly one classification
   label, and updates one marked comment.
4. If human approval is required while writes are disabled, add
   `budget-approved`. Confirm the workflow creates or updates one apply-preview
   comment and performs no mutation.
5. Manually dispatch apply with `dry_run=true`.
6. Manually dispatch rollback with `dry_run=true`.
7. Run doctor for the intended operating level.

Stop here for dry-run operation.

For protected writes:

1. Reconfirm environment reviewers, prevent-self-review, branch restrictions,
   the environment-scoped secret, and checked-in enterprise slug.
2. Set repository variable `BUDGET_WRITE_ENABLED=true`.
3. Add `budget-approved` to a low-risk request.
4. Confirm the job waits for `budget-approver` approval.
5. Verify the apply audit comment and `budget-applied` label.
6. Confirm the scheduled rollback discovery remains enabled.

See [operations](./issueops-operations.md) for apply, rollback, emergency, and
rotation procedures.

## Releases and upgrades

Action releases use `issueops-v*` tags. The release workflow verifies the
IssueOps tests and confirms the committed `dist` bundle matches source.

Destination workflows execute an immutable commit SHA, with the human-readable
release ref retained as a comment. To upgrade, run setup with the new release
ref without `--apply`, review the planned workflow changes, then rerun with
`--apply`.

Never replace an installed action SHA with a floating branch or major tag.

## Installed components

- `.github/ghcp-aic-issueops.yml`;
- `.github/ISSUE_TEMPLATE/ai-credit-budget-request.md` (installed in the
  destination repository);
- `.github/workflows/budget-request-triage.yml`;
- `.github/workflows/budget-request-apply.yml` for dry-run and protected-write
  levels;
- `.github/workflows/budget-request-rollback.yml` for dry-run and
  protected-write levels.

Each workflow checks out the destination repository only to read its
configuration and invokes the bundled action. It does not run `npm ci` or
execute copied application source.

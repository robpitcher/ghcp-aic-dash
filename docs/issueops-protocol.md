# IssueOps Protocol Reference

This reference defines the stable request, label, comment, and audit contracts.
See the [quickstart](./issueops.md) and
[operations runbook](./issueops-operations.md).

## Request preparation

`/api/budget/request`:

1. requires a signed identity and enterprise membership;
2. accepts only `requestedIncreaseCredits` and `justification`;
3. forces lookup to the signed-in session login;
4. fetches the live effective budget;
5. calculates the requested total;
6. fixes expiration to the last day of the current UTC month;
7. sanitizes the justification;
8. returns a prefilled issue URL.

The dashboard does not create the issue and needs no issue-write token.

The exact title is:

```text
[AI Credit Budget Request] <requester>: +<requested_increase_credits> credits
```

## Request schema

The first fenced YAML block containing the schema marker is authoritative.
Fields are required in this order:

```yaml
schema: "ghcp-aic-budget-request:v1"
requester: "alice"
current_budget_credits: 3000
current_consumed_credits: 425
requested_increase_credits: 1500
requested_total_credits: 4500
effective_source: "cost_center"
expiration_date: "2026-08-31"
generated_at: "2026-08-04T20:30:00.000Z"
```

Rules:

| Field | Rule |
| --- | --- |
| `schema` | Exact `ghcp-aic-budget-request:v1` |
| `requester` | Lower-case GitHub login matching the issue author |
| `current_budget_credits` | Non-negative safe integer from the server read |
| `current_consumed_credits` | Non-negative safe integer from the server read |
| `requested_increase_credits` | Positive safe integer, multiple of 100, preparation cap 1,000,000 |
| `requested_total_credits` | Current budget plus requested increase |
| `effective_source` | `individual`, `cost_center`, or `universal` |
| `expiration_date` | Last day of the current UTC month |
| `generated_at` | Valid ISO 8601 UTC timestamp ending in `Z` |

The human justification follows under `## Business justification`.

Limits:

- issue body: 65,536 characters;
- request YAML: 8,192 characters;
- depth: 3;
- justification: 20 through 4,000 characters;
- prepared URL: 7,500 characters.

Parsing requires one plain object, exact keys and order, safe YAML, and no
anchors, aliases, or prototype-related keys.

## IssueOps configuration schema

```yaml
schema: "ghcp-aic-issueops:v1"
enterprise_slug: "example-enterprise"
auto_approval:
  max_delta_credits: 1500
  max_total_credits: 5000
```

Fields and order are strict. `enterprise_slug` may be `null` until protected
writes are configured. Limits are non-negative safe integers; both must be
positive for auto-eligibility.

Configuration is limited to 8,192 characters and depth 3, and uses the same
safe-YAML restrictions as requests and audits.

## Labels

| Label | Meaning |
| --- | --- |
| `budget-request` | Recognized request |
| `budget-invalid` | Failed validation |
| `budget-needs-approval` | Valid but requires human approval |
| `budget-auto-eligible` | Valid and inside both policy limits |
| `budget-approved` | Explicit human approval; removed after request edits |
| `budget-applied` | Temporary increase is active |
| `budget-needs-admin-review` | Rollback conflict requires investigation |

## Comment markers

```text
<!-- ghcp-aic-budget-triage -->
<!-- ghcp-aic-budget-apply-preview -->
<!-- ghcp-aic-budget-apply -->
<!-- ghcp-aic-budget-rollback -->
```

Automation updates one bot-authored comment per marker and removes duplicate
marked comments. Markers provide idempotent status and state reconciliation.

The preview comment is informational only. The apply comment is the durable
state store used by rollback.

## Apply audit schema

```yaml
schema: "ghcp-aic-budget-apply:v1"
action_type: "patched-existing"
before_amount_usd: 30
after_amount_usd: 45
budget_scope: "user"
budget_id: "12345"
requester: "alice"
expiration_date: "2026-08-31"
run_id: "987654321"
actor: "billing-operator"
status: "applied"
```

Rules:

- `action_type`: `patched-existing` or `created-override`;
- amounts: non-negative USD with at most two decimal places;
- `budget_scope`: exact `user`;
- `budget_id`: exact changed budget;
- `requester`: lower-case GitHub login;
- `expiration_date`: UTC date;
- `run_id`: digits only;
- `actor`: workflow actor;
- `status`: `applied` or `reverted`.

Audit parsing limits:

- comment: 32,768 characters;
- YAML: 8,192 characters;
- depth: 3;
- one shallow plain object;
- exact fields and order;
- no anchors, aliases, or prototype-related keys.

An issue must have exactly one active `status: applied` audit before rollback.
Do not delete or manually rewrite audit comments.

## Idempotency

- Triage removes stale classification labels and maintains one comment.
- Request edits remove stale human approval.
- Approval previews maintain one comment.
- Apply treats one active audit as already applied.
- Rollback marks the same audit reverted and closes the issue after success.
- Conflict comments and labels are reconciled rather than duplicated.

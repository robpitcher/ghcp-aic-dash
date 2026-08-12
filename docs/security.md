# Security Model

This guide describes the dashboard's trust boundaries and required safeguards. See [architecture](./architecture.md), [configuration](./configuration.md), [IssueOps](./issueops.md), and the [glossary](./glossary.md).

## Security goals

The design aims to ensure that:

- a user can read only their own usage and budget through `/me` routes;
- only verified members of the configured GitHub Enterprise can access live data;
- privileged billing credentials never reach the browser;
- the GitHub sign-in token is not retained;
- budget writes are disabled by default and require protected approval;
- issue content is never trusted as live billing state;
- untrusted GitHub responses and structured issue data are validated and
  bounded.

## Trust boundaries

### Browser to Next.js

Everything from the browser is untrusted, including query strings, JSON bodies, displayed login values, current usage, current budget, and requested totals.

The browser calls only same-origin application programming interface (API)
routes. Route handlers authenticate, authorize, validate, force scope, and
normalize responses. Client-side controls improve usability but are not
security controls.

### Next.js to GitHub identity

The GitHub App Open Authorization (OAuth) flow proves the user's identity. The
callback validates an anti-forgery `state` value before accepting success or
error responses.

The temporary GitHub user token is used only to read `login` and `id`, then discarded. It is not placed in the signed cookie, application logs, browser responses, or a database.

### Next.js to GitHub billing

`GITHUB_BILLING_TOKEN` is a privileged, server-only read credential. It is used for:

- per-user AI credit usage;
- per-user budget reads;
- read-only enterprise membership verification.

Only route and library code on the server can access it. The browser receives sanitized domain objects, never raw headers, credentials, or complete GitHub billing responses.

### GitHub issue to automation

Issue title, body, author, labels, comments, and checked-in policy are
security-relevant workflow input. Labels can express approval intent, but apply
also re-runs validation and checks live state. Editing a request removes prior
human approval.

The audit comment is trusted only after strict parsing of the bot-authored marker and exact schema. Malformed or ambiguous audit state stops automation.

### GitHub Actions to billing administration

`GH_BILLING_ADMIN_TOKEN` is a separate write credential. It is available only to jobs using the protected `budget-approver` environment.

The read token and write token must never be reused. Separating them limits the damage from an application compromise and prevents ordinary dashboard traffic from gaining write authority.

### Container runtime

The container image is not a secret store. Sensitive values must be injected
at runtime through an approved secret-management mechanism. The container runs
as an unprivileged operating-system user.

## Session protection

`identity_session` is:

- signed with a Hash-based Message Authentication Code using SHA-256
  (HMAC-SHA256) and `SESSION_SECRET`;
- limited to login, numeric ID, role, and issue time;
- verified using constant-time signature comparison;
- unavailable to client-side JavaScript through the Hypertext Transfer Protocol
  (HTTP)-only cookie setting;
- SameSite `Lax`;
- secure in production;
- valid for 24 hours.

It is signed, not encrypted. Do not add secrets or sensitive profile data to its payload.

The OAuth state cookie is HTTP-only, SameSite `Lax`, secure in production, and limited to ten minutes.

Rotate `SESSION_SECRET` if it is exposed. Rotation invalidates all active sessions.

## Enterprise membership is fail closed

Membership is checked before session creation and on protected data requests.

The GitHub GraphQL member search is fuzzy. The application performs an exact, case-insensitive login match and walks at most three result pages.

Outcomes are distinct:

- no valid identity: `401`;
- confirmed non-member: `403`;
- membership lookup failure: `503`.

A lookup failure is not treated as a member or non-member result. Errors are not cached. Successful positive and negative results are cached for five minutes per application process.

Keep `REQUIRE_ENTERPRISE_MEMBERSHIP=true` in production. Disabling it removes the enterprise authorization boundary.

## Self-scoped `/me` routes

`/api/usage/me`, `/api/budget/me`, and `/api/budget/request` are self-only.

The authenticated session login is authoritative. The server must not accept an arbitrary login for these routes, including from a session assigned an administrator or reserved manager role.

`resolveUserScope` is the shared scope choke point. `/me` routes must call it in a way that cannot preserve a browser-supplied user. The resulting session login is the only login passed to usage and budget clients.

Adding an endpoint that can read another user's data requires a separate, explicitly reviewed authorization design. Do not widen an existing `/me` route.

## Token handling

### GitHub App client secret

- server-only;
- used only for OAuth code exchange;
- stored in `.env` or an approved secret store;
- never use a `NEXT_PUBLIC_` name.

### Session secret

- server-only;
- strong random value;
- used only to derive the session signing key;
- rotation invalidates sessions.

### Dashboard billing token

- server-only;
- classic PAT with `manage_billing:copilot` read and `read:enterprise`;
- no budget write duties;
- never sent to client code;
- never reused as the Actions administrator token.

### Billing administrator token

- environment secret named `GH_BILLING_ADMIN_TOKEN`;
- dedicated automation identity;
- classic PAT with `manage_billing:enterprise`;
- enterprise-owner identity because rollback may delete a temporary override;
- not a repository secret;
- not available to pull-request workflows;
- released only by the protected `budget-approver` environment.

## Protected budget writes

Budget writes are protected by several independent gates:

1. Workflows are dry-run by default.
2. `BUDGET_WRITE_ENABLED` must equal exactly `true`.
3. Apply is manually dispatched with a digits-only issue number.
4. Current schema and policy validation must pass.
5. The issue needs policy or administrator approval.
6. The write job uses `budget-approver`.
7. Required reviewers must release the environment.
8. Only then is `GH_BILLING_ADMIN_TOKEN` available.
9. The requester and current budget are re-fetched.
10. The live source and amount must match the request.

Destination workflows pin the bundled action to an immutable commit SHA.
Checked-in IssueOps configuration and workflows should be branch protected and
reviewed by appropriate owners. Floating action tags must not be used for
execution.

Both patched and created user budgets preserve `prevent_further_usage: true`.

Restrict deployment branches for `budget-approver` to a protected branch
containing reviewed workflow, configuration, and immutable action references.
Disable self-review.

## Audit integrity and rollback

The apply comment records the exact:

- budget ID;
- action type;
- original amount;
- applied amount;
- requester;
- expiration;
- workflow run;
- actor;
- status.

The marker and exact ordered YAML schema make the comment deterministic and machine-readable. Do not delete it during incident response.

Credential-free rollback discovery suppresses empty protected-environment
approval requests. The protected job still independently re-fetches every
issue, audit, requester, and budget. It compares the live amount with the
recorded applied amount and refuses later administrator drift.

This compare-before-write behavior prevents rollback from silently undoing an administrator's intervening action.

## Boundary validation

Runtime environment values are validated with Zod or explicit parsers.

Examples:

- IssueOps destination must be exact `OWNER/REPO`.
- Billing scope rejects the reserved `org` value.
- Year and month are bounded.
- Budget request JSON is strict and rejects extra keys.
- Increase is positive, divisible by 100, and capped during preparation.
- Justification length is bounded and fence text is sanitized.
- Issue number is digits only and must be a safe integer.
- GitHub login uses a restricted lower-case pattern.
- Raw billing objects are checked before use.

Expected invalid client input returns `422`. Missing configuration returns `400` rather than falling into an unsafe partial mode.

## Safe YAML

YAML (YAML Ain't Markup Language) in IssueOps comments is hostile input.

Request and audit parsing enforce:

- safe YAML loading;
- one plain object;
- exact keys;
- exact field order;
- strict scalar types;
- size limits;
- depth limits;
- rejection of anchors and aliases;
- rejection of prototype-related keys;
- deterministic selection of the first request block containing the schema marker.

Never switch to an unsafe YAML loader or accept arbitrary nested data.

## Work and pagination caps

The application limits upstream work where the API shape can expand:

- enterprise membership search: at most 3 pages of 100 candidates;
- budget reads: at most 20 pages of 100 budgets;
- dashboard trend: 6 Coordinated Universal Time (UTC) months;
- usage trend requests are sequential;
- request body: 65,536 characters;
- request YAML: 8,192 characters;
- audit comment: 32,768 characters;
- audit YAML: 8,192 characters;
- structured YAML depth: 3;
- prepared issue URL: 7,500 characters.

Preserve these caps when changing providers or schemas. Add similar caps to any new pagination loop.

## Upstream response handling

GitHub API responses are treated as schema-drifting and untrusted.

- Usage items are normalized into a fixed shape.
- Unexpected numbers become safe defaults where appropriate.
- Budget responses expose only a sanitized effective budget.
- Incomplete budget data becomes "no budget."
- Error text included from GitHub is truncated.
- Permission-related `401`, `403`, and `404` responses fail fast.
- Only transient network and server failures are retried.

Do not return raw upstream payloads to the browser.

## Runtime safeguards

- Secrets are runtime configuration, not Docker build arguments.
- The standalone container runs as a non-root user.
- Credentials must be supplied by the runtime and must not be baked into the
  image.
- Production hosting must terminate HTTPS and restrict access to server-only
  environment variables.

## Logging and error handling

Do not log tokens, authorization headers, session cookies, complete secret-bearing environment objects, or raw sensitive billing payloads.

User-facing errors should be actionable but sanitized. Server logs may record a failure class or status, not credentials.

GitHub issue requests intentionally contain the user's current budget and usage values. Repository collaborators can see them. Select the request repository and its access controls accordingly.

## Emergency response

For suspected write-credential exposure:

1. Set or delete `BUDGET_WRITE_ENABLED` so it is not `true`.
2. Cancel waiting protected environment deployments.
3. Revoke or rotate `GH_BILLING_ADMIN_TOKEN`.
4. Preserve audit comments and workflow logs.
5. Review live budgets and all `budget-applied` issues.
6. Resolve `budget-needs-admin-review` issues before re-enabling.

For dashboard read-token exposure:

1. Revoke `GITHUB_BILLING_TOKEN`.
2. Replace it in local secret storage or the production secret store.
3. Restart or redeploy the application.
4. Verify membership and self-scoped reads.

For session-secret exposure:

1. replace `SESSION_SECRET`;
2. restart or redeploy all replicas;
3. require users to sign in again.

## Security review checklist

- `/me` routes ignore arbitrary user input for every role.
- membership remains enabled and fail closed;
- user OAuth tokens are discarded;
- read and administrator billing credentials are separate;
- no credential uses a `NEXT_PUBLIC_` variable;
- real writes require `budget-approver`;
- dry-run remains the default;
- write enablement still requires exact `true`;
- schemas, markers, field order, and caps remain strict;
- live state is re-fetched before apply and rollback;
- audit comments are preserved;
- deployment secrets remain in protected secret stores.

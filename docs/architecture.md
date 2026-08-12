# Architecture

This guide explains how the GitHub Copilot AI Credit Dashboard is assembled and how data moves through it. See the [glossary](./glossary.md) for shared terms, [configuration](./configuration.md) for setup, [IssueOps](./issueops.md) for budget automation, and [security](./security.md) for the trust model.

## System overview

The dashboard is a Next.js App Router application using React, TypeScript, Tailwind CSS, and Recharts. It has no application database. Identity, usage, budgets, and budget-request state come from signed cookies, GitHub application programming interfaces (APIs), and GitHub issues.

```text
Browser
  |
  | secure same-origin requests
  v
Next.js pages and API routes
  |-- GitHub App sign-in -> GitHub identity
  |-- signed identity_session cookie
  |-- enterprise membership check -> GitHub GraphQL API
  |-- self-scoped usage/budget reads -> GitHub billing API
  `-- prefilled issue URL -> configured GitHub repository

GitHub Actions in the request repository
  |-- thin workflows pinned to the bundled IssueOps action
  |-- checked-in policy and enterprise configuration
  |-- triage and approval preview
  |-- protected, optional budget apply
  `-- discovery-gated protected rollback
```

## Browser and React layer

The browser renders reusable client components from `src/components`. The main dashboard:

- displays analytics, model breakdowns, trends, budgets, and forecasts;
- calls only same-origin routes such as `/api/usage/me` and `/api/budget/me`;
- does not receive GitHub billing credentials;
- does not send a trusted requester identity or trusted current-budget value;
- opens a server-prepared GitHub issue URL for budget requests instead of creating an issue itself.

Pages under `src/app` select the dashboard view:

- `/` redirects to `/analytics`;
- `/analytics` shows monthly usage and trends;
- `/budgets` shows the effective budget and request form;
- `/login` starts the GitHub sign-in flow.

Server Components check whether identity is configured and whether a valid session exists before rendering the dashboard. Client components handle loading and display state, but authorization is always enforced again in API routes.

## Next.js route layer

Route handlers under `src/app/api` are the browser's only data boundary.

| Route | Purpose |
| --- | --- |
| `/api/auth/github/login` | Starts the GitHub App OAuth flow and creates a short-lived anti-forgery state cookie. |
| `/api/auth/github/callback` | Validates the state, exchanges the code, reads the GitHub identity, checks enterprise membership, and creates the signed session. |
| `/api/auth/session` | Returns the current sanitized identity session. |
| `/api/auth/logout` | Clears the identity session. |
| `/api/usage/me` | Returns the signed-in user's normalized monthly usage and six-month trend. |
| `/api/budget/me` | Returns the signed-in user's sanitized effective budget. |
| `/api/budget/request` | Re-fetches that user's budget and prepares a reviewable GitHub issue URL. |

Routes return structured errors for expected failure states. Important statuses include `400` for missing configuration, `401` for no valid identity, `403` for failed membership, `422` for invalid input, `502` for rejected upstream billing calls, and `503` when membership cannot be verified.

## Identity and signed session

The GitHub App is used only to prove who is signing in. OAuth means Open Authorization, the browser-based authorization flow used by GitHub Apps.

1. The login route generates a random `state` value.
2. The value is stored in a short-lived, HTTP-only, SameSite cookie and sent to GitHub.
3. The callback compares the returned state using a constant-time comparison.
4. The server exchanges the authorization code for a temporary user access token.
5. The token is used once to read the user's GitHub login and numeric ID.
6. The token is discarded. It is not stored in the session or returned to the browser.
7. After membership verification, the server creates `identity_session`.

The session is a stateless JSON payload protected by an HMAC-SHA256 signature. HMAC means Hash-based Message Authentication Code. The payload contains only the login, numeric user ID, role, and issue time. The cookie is HTTP-only, SameSite `Lax`, secure in production, and expires after 24 hours.

Because the session is stateless, no server-side session table or database is required. Changing `SESSION_SECRET` invalidates all existing sessions.

## Enterprise membership

The dashboard verifies membership twice:

- before creating a session at sign-in; and
- on protected data requests through `requireEnterpriseMember`.

The check uses the server-side billing token's `read:enterprise` scope and the GitHub GraphQL API. GraphQL is GitHub's typed query API. The enterprise member search is fuzzy, so the application performs an exact, case-insensitive login comparison before accepting a result.

Membership checks fail closed. A confirmed non-member receives `403`. A lookup failure, such as an outage, rate limit, expired token, or invalid slug, receives `503`; the application does not treat that failure as permission to continue.

Positive and negative results are cached in each application process for five minutes. Errors are never cached. In a multi-replica deployment, each replica has its own cache, so membership revocation can take up to the cache lifetime to be observed by every replica.

`REQUIRE_ENTERPRISE_MEMBERSHIP=false` bypasses this control and is only for local development or testing.

## Self-scoped usage and budget access

The browser never supplies authoritative identity. The signed session login is the source of truth.

`resolveUserScope` is the central scope-control function. The `/me` route contract is self-only, including for sessions assigned a reserved administrator or manager role. The route must pass no arbitrary login through to the billing client.

The billing token remains on the server. The application uses it to call enterprise billing endpoints with the authenticated login as the user filter. Raw GitHub responses are treated as untrusted and normalized before being returned.

## Usage libraries

`src/lib/usage` separates data retrieval from calculations:

- `LiveUsageProvider` retrieves one user's data on demand;
- aggregation functions calculate totals and per-model results;
- insight functions derive presentation-ready observations;
- UTC month helpers build a six-month trend window.

The live provider requests each trend month from GitHub. Requests are sequential to reduce pressure on GitHub rate limits. There is no background ingestion job, usage table, or cache database.

## Budget libraries

`src/lib/budget` contains pure budget logic:

- normalizing the effective budget;
- mapping GitHub scopes to `individual`, `cost_center`, or `universal`;
- converting between US dollars and AI credits;
- calculating remaining amount and percentage used;
- producing forecasts and display states;
- validating request input and building a prefilled issue.

Only a small sanitized effective-budget shape is sent to the browser. Unexpected or incomplete upstream data becomes a safe "no budget" result instead of exposing a raw response.

Budget request preparation accepts only an increase and justification from the browser. The server re-fetches the effective budget for the authenticated login, calculates the requested total, and fixes expiration to the final day of the current UTC month.

## GitHub billing clients

`src/lib/github` isolates GitHub-specific transport behavior:

- `EnterpriseBillingClient` reads usage and budgets;
- budget pagination is capped at 20 pages;
- transient network and server errors are retried with exponential backoff and jitter;
- permission-related `401`, `403`, and `404` responses fail immediately with actionable guidance;
- returned usage and budgets are normalized or validated before use;
- the GitHub API version for budget operations is `2026-03-10`.

GitHub may return `404` when a billing scope, role, or feature is missing. The client therefore treats `401`, `403`, and `404` as authorization or configuration failures rather than retryable absence.

## No application database

The dashboard deliberately has no application database:

- identity state is held in a signed cookie;
- current usage and six-month trends are fetched from GitHub when requested;
- current budgets are fetched from GitHub when requested;
- temporary budget request and apply state is stored in GitHub issues, labels, and marked audit comments.

This keeps the deployment small, but it also means dashboard availability and latency depend on GitHub APIs. There is no historical snapshot beyond what GitHub returns for the requested months.

## IssueOps flow

IssueOps is an operating model in which a GitHub issue is the review and audit surface for an operational change.

1. The dashboard prepares a structured issue in one configured repository.
2. The user reviews and submits it on GitHub.
3. A thin workflow calls the bundled action at an immutable commit SHA.
4. The action reads checked-in `.github/ghcp-aic-issueops.yml` and validates
   the exact structured block, issue author, title, current-month expiration,
   and policy.
5. Triage applies one classification label, removes stale approval after edits,
   and updates one marked bot comment.
6. Human approval triggers an unprivileged apply-preview comment.
7. A real write remains manually dispatched and requires the exact write flag,
   valid approval, and the protected environment.
8. Apply revalidates the requester and live budget, then patches an individual
   budget or creates a temporary user override.
9. A marked audit comment records the exact before and after state.
10. Rollback first discovers expired candidates without a credential. It queues
    the protected job only when candidates exist, then independently
    revalidates all live state before mutation.
11. If live state changed after apply, rollback refuses to overwrite it and
    requests administrator review.

See [IssueOps](./issueops.md) for schemas and runbooks.

## Related guides

- [Configuration](./configuration.md)
- [IssueOps operations](./issueops.md)
- [Security model](./security.md)
- [Glossary](./glossary.md)

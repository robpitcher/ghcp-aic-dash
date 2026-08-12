# Contributor onboarding

Welcome! This guide explains the project in plain language and gives you a safe
path from running the demo to making a small change.

For setup details, use the [development guide](development.md). For unfamiliar
words, use the [glossary](glossary.md).

## What this project does

GitHub Copilot usage data is available through privileged enterprise billing
interfaces. Giving that privilege to every developer would be unsafe. This app
sits in the middle:

1. A developer signs in.
2. The server confirms who they are and, by default, checks that they belong to
   the configured GitHub Enterprise.
3. The server asks GitHub for only that developer's usage and budget.
4. The browser receives a small, sanitized response rather than credentials or
   raw GitHub data.

The result is a personal dashboard with monthly usage, model breakdowns,
trends, budget information, forecasts, and comma-separated values (CSV)
export. An optional
[IssueOps](glossary.md#issueops) flow prepares a GitHub issue when a developer
needs more credits.

## Start with the demo

Demo mode is the easiest way to understand the user interface. It uses
synthetic data, does not need credentials, skips sign-in, and never contacts
GitHub.

From the repository root in PowerShell:

```powershell
npm install
$env:DEMO_ENV = "true"
npm run dev
```

Open <http://localhost:3000>. Explore both **Analytics** and **Budgets**. Budget
requests are intentionally disabled in demo mode.

Stop the server with <kbd>Ctrl</kbd>+<kbd>C</kbd>. The PowerShell environment
variable lasts only for that terminal process. Demo mode is also ignored when
`NODE_ENV=production`.

## Project map

| Path | What lives there |
| --- | --- |
| `src/app/` | Next.js pages and same-origin Application Programming Interface (API) route handlers |
| `src/components/` | Reusable React user-interface components |
| `src/lib/auth/` | Sign-in, session, membership guard, and self-scope logic |
| `src/lib/github/` | Server-only GitHub enterprise billing client |
| `src/lib/usage/` | Usage fetching, aggregation, trends, and insights |
| `src/lib/budget/` | Effective-budget calculation, forecast, and request preparation |
| `src/lib/issueops/` | Pure parsing, policy, apply, audit, and rollback logic |
| `src/lib/demo/` | Synthetic data used only by local demo mode |
| `src/lib/export/` | CSV export preparation and serialization |
| `src/lib/config.ts` | Validated runtime configuration boundary |
| `src/test/` | Shared Vitest setup |
| `scripts/` | Local IssueOps wrappers plus setup and doctor commands |
| `.github/actions/budget-issueops/` | Source and committed bundle for the distributable IssueOps action |
| `.github/workflows/` | Thin local IssueOps workflows and action release checks |
| `docs/` | Contributor and operator documentation |

Tests are normally colocated in `__tests__` directories beside the code they
cover.

## Runtime flow

### Demo mode

1. `DEMO_ENV=true` is detected by `src/lib/config.ts`.
2. The app uses the fixed `demo-user` identity.
3. Usage and budget providers return committed synthetic data.
4. No GitHub sign-in, billing request, or budget-request issue occurs.

### Configured mode

1. The browser opens the Next.js app.
2. An unauthenticated user is redirected to GitHub App sign-in. The web flow
   uses an anti-forgery `state` value; see
   [Cross-Site Request Forgery](glossary.md#csrf).
3. The server briefly uses the returned access token to read the GitHub login
   and numeric ID, then discards the token.
4. The server creates a 24-hour
   [HTTP-only identity cookie](glossary.md#http-only-cookie) signed with a
   [Hash-based Message Authentication Code (HMAC)](glossary.md#hmac).
5. Data routes require a valid session and normally verify GitHub Enterprise
   membership.
6. `resolveUserScope` forces every `/me` request to the signed-in login. A
   browser-supplied username cannot widen the request.
7. The server-only billing token reads usage or budget data from GitHub.
8. Pure library functions normalize and calculate the response before the API
   route returns it to the browser.

The app fetches live data on demand and stores no application data in a
database. Billing periods and month calculations use
[Coordinated Universal Time (UTC)](glossary.md#utc).

### Budget request flow

The optional dashboard flow accepts only an increase amount and a business
justification. The server re-fetches the signed-in developer's effective
budget, creates a prefilled issue URL for one configured repository, and opens
GitHub for the developer to review and submit. The dashboard does not create
the issue or change a budget itself.

Thin repository workflows call an immutable bundled-action revision. Triage
uses checked-in policy, approval creates a dry-run preview, and protected
rollback is queued only when credential-free discovery finds expired
candidates. Real writes remain disabled by default. See
[IssueOps](issueops.md).

## Run with real configuration

Use this only when you have access to a suitable GitHub Enterprise and billing
credential.

1. Copy the template:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Create and configure a GitHub App. For local development, its callback URL
   is `http://localhost:3000/api/auth/github/callback`.
3. Add a strong `SESSION_SECRET`.
4. Add a classic personal access token (PAT) with
   `manage_billing:copilot` (read) and `read:enterprise`.
5. Add the enterprise slug and leave membership checking enabled.
6. Run:

   ```powershell
   npm run dev
   ```

Never commit `.env`, paste its contents into an issue, or expose the billing
token to client code. Follow [Configuration](configuration.md) for the complete
setup.

## A safe small-change workflow

1. **Read first.** Find the page or route, then follow its imports into
   `src/lib/`. Read nearby tests before changing behavior.
2. **Check the worktree.**

   ```powershell
   git status --short
   ```

   Do not overwrite unrelated work.
3. **Keep responsibilities separate.** Put validation, calculations, and
   workflow planning in testable library functions. Keep route handlers focused
   on Hypertext Transfer Protocol (HTTP), authentication, configuration, and
   error mapping.
4. **Validate at the boundary.** Treat request bodies, query strings, GitHub
   responses, issue text, and environment variables as untrusted.
5. **Add or update a colocated test.** Prefer a focused test for the behavior
   you changed.
6. **Run the smallest useful checks**, then expand if needed:

   ```powershell
   npx vitest run src\lib\__tests__\auth.test.ts
   npm run lint
   npm run build
   ```

7. **Review the diff.**

   ```powershell
   git diff --check
   git diff
   ```

For all test commands, see [Development](development.md#testing-linting-and-building).

## Safety rules

- Never send `GITHUB_BILLING_TOKEN`, `GH_BILLING_ADMIN_TOKEN`, GitHub App
  secrets, or session secrets to the browser.
- Never add an endpoint that accepts an arbitrary GitHub login without an
  explicitly reviewed authorization design. `/me` routes are self-only for
  every role.
- Keep enterprise membership verification
  [fail closed](glossary.md#fail-closed): an error must deny access, not bypass
  the check.
- Do not disable membership checking in production.
- Keep billing and expiration calculations in UTC.
- Keep budget writes disabled unless the protected operator setup in
  [IssueOps](issueops.md) is complete.
- Never reuse the dashboard's read token as the administrator write token.
- Preserve dry-run defaults, audit markers, strict
  [YAML](glossary.md#yaml) validation, and
  [idempotent](glossary.md#idempotent) workflow behavior.
- Do not weaken size, pagination, retry, schema, or input limits to make a
  failing case pass.

Before changing a trust boundary, read [Security](security.md) and
[Architecture](architecture.md).

## Where to go next

- [Development](development.md): commands, Docker, conventions, troubleshooting
- [Architecture](architecture.md): component and data-flow design
- [Configuration](configuration.md): every runtime setting
- [IssueOps](issueops.md): budget automation
- [Security](security.md): credentials and access controls
- [Glossary](glossary.md): recurring terminology

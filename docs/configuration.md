# Configuration

This guide lists configuration for local use, GitHub identity, billing, and
IssueOps. Never put real credentials in documentation, source control,
container images, browser code, or example commands.

See [architecture](./architecture.md), [IssueOps](./issueops.md), [security](./security.md), and the [glossary](./glossary.md).

## Configuration categories

- **Required** means the feature cannot operate without the value.
- **Optional** means the feature is disabled or uses a safe default when omitted.
- **Server-only** means the value must never be exposed through client-side JavaScript or a public build variable.
- **Secret** means the value belongs in `.env` or an approved secret store, not a repository variable.

Runtime configuration is validated in `src/lib/config.ts`. Identity, billing, membership, and IssueOps are validated separately so an incomplete deployment can show an actionable configuration state instead of crashing.

## Local demo mode

Demo mode serves a fixed `demo-user` with synthetic usage and budget data. It does not contact GitHub and disables budget requests.

It is requested per run rather than configured in `.env`:

```powershell
docker compose --profile demo up --build   # Docker
$env:DEMO_ENV = "true"; npm run dev        # Node.js
```

Important behavior:

- demo mode is opt-in;
- it never activates when `NODE_ENV=production`;
- GitHub App and billing credentials are not required;
- `DEMO_ENV` is not part of `.env`, so a configured deployment cannot fall back to synthetic data by accident;
- use it only for local demonstrations.

For Node.js development, copy `.env.example` to `.env`, install dependencies, and use the existing development command. For Docker, `docker compose up --build` reads `.env` and serves port 3000.

## Local connected mode

Connected mode signs in through GitHub and reads live enterprise billing data. A minimal local `.env` uses placeholders like these:

```dotenv
GITHUB_APP_CLIENT_ID=example-client-id
GITHUB_APP_CLIENT_SECRET=replace-locally
SESSION_SECRET=replace-with-a-strong-random-value
GITHUB_BILLING_TOKEN=replace-locally
GITHUB_ENTERPRISE_SLUG=example-enterprise
GITHUB_BILLING_SCOPE=enterprise
REQUIRE_ENTERPRISE_MEMBERSHIP=true
APP_BASE_URL=http://localhost:3000
ADMIN_LOGINS=
```

Do not copy these placeholder values into a real deployment.

## Application environment variables

| Variable | Requirement | Visibility | Purpose and safe default |
| --- | --- | --- | --- |
| `DEMO_ENV` | Optional, local only | Server | `true` enables synthetic data outside production. Default is off. |
| `GITHUB_APP_CLIENT_ID` | Required outside demo | Non-secret server config | Identifies the GitHub App used for sign-in. |
| `GITHUB_APP_CLIENT_SECRET` | Required outside demo | **Server-only secret** | Exchanges the GitHub authorization code. |
| `SESSION_SECRET` | Required outside demo | **Server-only secret** | Signs `identity_session` with a Hash-based Message Authentication Code using SHA-256 (HMAC-SHA256). Generate a strong random value. Rotation invalidates sessions. |
| `GITHUB_BILLING_TOKEN` | Required for live data | **Server-only secret** | Classic personal access token used for usage, budget reads, and read-only enterprise membership checks. |
| `GITHUB_ENTERPRISE_SLUG` | Required for live data | Server config | Value from `github.com/enterprises/<slug>`. |
| `GITHUB_BILLING_SCOPE` | Required for live data | Server config | Use `enterprise`. `org` is reserved and rejected by the current application. |
| `REQUIRE_ENTERPRISE_MEMBERSHIP` | Optional | Server config | Defaults to secure behavior (`true`). Set `false` only for local development or testing. |
| `APP_BASE_URL` | Recommended; required behind proxies | Server config | Public origin with no trailing slash. Local default is `http://localhost:3000`. |
| `ADMIN_LOGINS` | Optional | Server config | Comma-separated reserved administrator allowlist. It does not widen `/me` endpoints. |
| `BUDGET_REQUEST_REPOSITORY` | Optional | Server config | Exact `OWNER/REPO` destination that enables prepared budget-request issues. |
| `NPM_REGISTRY` | Optional Docker build input | Build config | npm registry or approved mirror, including trailing slash. Overrides the `.npmrc` Compose mounts as a build secret. When neither is set, npm uses its standard default. |
| `NPM_CONFIG_USERCONFIG` | Optional Docker build input | Build config | Path to the npm configuration Compose mounts into the build as a secret. Defaults to the repository's committed `.npmrc`; set it to your user-level file (e.g. `C:\Users\you\.npmrc`) to install from an internal feed. Compose does not expand `~`. |

### Server-only rule

Do not prefix sensitive values with `NEXT_PUBLIC_`. Next.js exposes variables with that prefix to browser bundles. The billing token, GitHub App secret, session secret, and billing administrator token must never be sent to the browser.

## GitHub App identity

Create a GitHub App in the intended organization or enterprise when possible so it can be internal.

Configure:

- callback URL: `<APP_BASE_URL>/api/auth/github/callback`;
- webhooks: disabled;
- account permissions: none required for public `login` and `id`;
- user-token expiration: enabled;
- "Request user authorization during installation": disabled.

No installation is needed for sign-in. The user access token is used only to fetch the identity and is immediately discarded.

If the public URL changes, update both `APP_BASE_URL` and the GitHub App callback URL.

## Billing and membership

`GITHUB_BILLING_TOKEN` must be a classic personal access token (PAT) with:

- `manage_billing:copilot` read access; and
- `read:enterprise`.

[Create the dashboard read PAT with both scopes preselected](https://github.com/settings/tokens/new?description=ghcp-aic-dash-read&scopes=manage_billing%3Acopilot%2Cread%3Aenterprise).
Review the selected scopes, choose an appropriate expiration, generate the
token, and store it only as `GITHUB_BILLING_TOKEN`.

The token's owner must also have the GitHub enterprise role required by the relevant billing endpoints, such as enterprise owner, billing manager, or the supported Copilot usage role.

The application reuses this read credential for the enterprise membership query. Do not create a second membership token unless the architecture is deliberately changed and reviewed.

Use:

```dotenv
GITHUB_BILLING_SCOPE=enterprise
REQUIRE_ENTERPRISE_MEMBERSHIP=true
```

GitHub may mask missing billing permission as `404`. Check token scopes and enterprise roles before treating that response as a missing resource.

## IssueOps integration

`BUDGET_REQUEST_REPOSITORY` is the application setting that enables the
dashboard's optional budget request form. It must be an exact `OWNER/REPO`
destination. The server prepares a GitHub issue link for that repository; it
does not need an issue-write token.

The destination repository stores IssueOps policy and enterprise selection in
`.github/ghcp-aic-issueops.yml`. Thin workflows call the bundled action at an
immutable commit SHA. `BUDGET_WRITE_ENABLED` remains a fail-closed repository
variable; the protected `budget-approver` environment holds the dedicated
billing administrator credential.

Follow [Install IssueOps](./issueops.md#install) for the complete
setup command, diagnostics, and staged enablement. Policy is no longer read
from `AUTO_APPROVE_MAX_DELTA_CREDITS`,
`AUTO_APPROVE_MAX_TOTAL_CREDITS`, or an IssueOps-specific enterprise-slug
repository variable.

## Configuration checks

Before connected use:

1. Confirm the GitHub App callback exactly matches
   `<APP_BASE_URL>/api/auth/github/callback`.
2. Confirm all three identity values are present.
3. Confirm the billing token scopes and enterprise role.
4. Confirm `GITHUB_ENTERPRISE_SLUG` is the slug, not a display name or URL.
5. Keep membership verification enabled.
6. Confirm `/api/usage/me` and `/api/budget/me` return only the signed-in login.
7. If IssueOps is enabled, complete the
   [IssueOps setup and staged validation](./issueops.md#install) before
   enabling any write.

## Related guides

- [Architecture](./architecture.md)
- [IssueOps setup and operations](./issueops.md)
- [Security model](./security.md)
- [Glossary](./glossary.md)

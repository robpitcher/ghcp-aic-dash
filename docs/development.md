# Development guide

This guide covers local development, validation, Docker, conventions, and
common problems. New contributors may want to read
[Onboarding](onboarding.md) first.

## Prerequisites

Required:

- [Node.js](https://nodejs.org/) 20 or later
- npm
- Git

Optional:

- Docker Desktop or another Docker installation with Compose
- Access to a GitHub Enterprise, a GitHub App, and a billing token for
  configured mode

The development scripts support Node.js 20 or later. The committed Dockerfile
currently builds and runs on Node.js 24.

## Install dependencies

From the repository root:

```powershell
npm install
```

Use `npm install` for local development. Continuous integration (CI) and Docker
use `npm ci` with the committed lockfile for reproducible installs. Do not
manually edit `package-lock.json`.

The committed `.npmrc` omits registry-specific download URLs from the lockfile,
so developers can use an approved mirror without publishing its hostname. Set
the registry in your shell or user-level npm configuration, never in the
repository:

```powershell
$env:NPM_CONFIG_REGISTRY = "https://npm.example.invalid/"
npm install
```

Public CI can leave `NPM_CONFIG_REGISTRY` unset and install from npm's public
registry. The package names, versions, and integrity hashes remain locked.

## Demo development

Demo mode is credential-free and uses synthetic data. The quickest path is the
Docker demo, which needs no `.env`:

```powershell
docker compose up --build
```

Without Docker:

```powershell
$env:DEMO_ENV = "true"
npm run dev
```

Open <http://localhost:3000>. Demo mode:

- works only when `NODE_ENV` is not `production`;
- signs in as the fixed `demo-user`;
- does not contact GitHub; and
- disables budget-increase requests.

Stop the server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

To use a file instead of a temporary PowerShell variable, copy `.env.example`
to `.env`, set `DEMO_ENV=true`, and leave credentials blank. Never commit
`.env`.

## Configured development

Configured mode exercises real GitHub App sign-in and billing reads.

1. Copy the environment template:

   ```powershell
   Copy-Item .env.example .env
   ```

2. In `.env`, keep `DEMO_ENV=false`.
3. Configure the GitHub App callback as
   `http://localhost:3000/api/auth/github/callback`.
4. Set the GitHub App client ID and secret.
5. Generate a strong session secret, for example:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. Set a classic personal access token (PAT) with
   `manage_billing:copilot` (read) and `read:enterprise`.
7. Set the GitHub Enterprise slug and keep
   `GITHUB_BILLING_SCOPE=enterprise`.
8. Keep `REQUIRE_ENTERPRISE_MEMBERSHIP=true` except for explicit local testing.
9. Start the app:

   ```powershell
   npm run dev
   ```

See [Configuration](configuration.md) for all variables, optional issue-based
operations ([IssueOps](glossary.md#issueops)) setup, and production guidance.

## Docker

The default Compose service is the credential-free demo. It builds the
`demo` stage, which runs the development server because demo mode never
activates in a production build. No `.env` is required:

```powershell
docker compose up --build
```

For configured mode, create `.env` first, then start the `configured` profile:

```powershell
docker compose --profile configured up --build app
```

Open <http://localhost:3000>. The Compose configuration injects environment
values at runtime; secrets are not baked into the image. The demo image is for
local evaluation only and must not be deployed.

To stop and remove the Compose containers:

```powershell
docker compose down
```

The Docker build uses `npm ci`. Compose mounts your user-level `.npmrc` as a
build secret, so a build behind an internal registry needs no extra
configuration: the registry (and any credentials that file holds) is used by
`npm ci` only, and never lands in an image layer or the image history. If your
configuration lives elsewhere, point Compose at it with the same variable npm
uses — `NPM_CONFIG_USERCONFIG` — and set it to `./.npmrc` when you have no
user-level file. `npm config get userconfig` prints the path in use.

A direct image build passes the same secret explicitly:

```powershell
docker build --secret id=npmrc,src=$HOME/.npmrc -t ghcp-aic-dash:local .
```

For environments with no `.npmrc` to share, `NPM_REGISTRY` still names a
registry directly and overrides the mounted configuration:

```powershell
docker build --build-arg NPM_REGISTRY=https://npm.example.invalid/ -t ghcp-aic-dash:local .
```

Replace the example URL with your approved registry. When neither is supplied,
npm uses its standard public default.

## Testing, linting, and building

Vitest discovers `src/**/*.test.ts` and `src/**/*.test.tsx`. It uses the
`@/*` alias for `src/*` and loads `src/test/setup.ts`.

Run the full test suite once:

```powershell
npm run test
```

Run in watch mode:

```powershell
npm run test:watch
```

Run one file:

```powershell
npx vitest run src\lib\__tests__\auth.test.ts
```

Filter by test name:

```powershell
npx vitest run -t "test name"
```

Run ESLint:

```powershell
npm run lint
```

Create a production Next.js build:

```powershell
npm run build
```

Serve that build:

```powershell
npm run start
```

Use the smallest targeted test that covers your change. Before submitting a
substantial change, run the relevant tests, lint, and build.

## Development conventions

### Keep domain logic out of route handlers

Put validation, normalization, calculations, and workflow planning in
`src/lib/**`. Route handlers under `src/app/api/**` should orchestrate Hypertext
Transfer Protocol (HTTP), authentication, configuration, and error responses.

### Preserve self-scope

`resolveUserScope` is the required choke point for personal usage, personal
budget, and budget-request preparation. `/me` routes must use the authenticated
session login and must never trust a login supplied by the browser.

### Validate untrusted data

Use Zod or the existing explicit type guards for environment variables,
request input, GitHub responses, and issue content. Return sanitized domain
objects instead of raw upstream payloads.

The established route error statuses are:

| Status | Meaning |
| --- | --- |
| `400` | Required configuration is missing |
| `401` | Identity session is missing or invalid |
| `403` | The user is not an enterprise member |
| `422` | User input is invalid |
| `502` | The upstream billing service rejected or failed the request |
| `503` | Enterprise membership could not be verified |

### Keep time in UTC

Billing periods, trends, forecasts, and request expiration use
[Coordinated Universal Time (UTC)](glossary.md#utc). Do not use local dates for
billing decisions.

### Treat GitHub as schema-drifting

GitHub responses are external input. Keep normalization, pagination caps, work
limits, and transient-only retry behavior. Do not expose raw responses.

### Follow repository structure

- Import from `src` with the `@/` alias.
- Colocate tests in nearby `__tests__` directories.
- Keep reusable client UI in `src/components`.
- Keep server-only credentials and GitHub billing calls out of client
  components.
- Follow the existing ESLint configuration. The
  `react-hooks/set-state-in-effect` exception is intentional and should not be
  broadened without a concrete need.

### Preserve IssueOps protections

Structured [YAML (YAML Ain't Markup Language)](glossary.md#yaml) must remain
compatible with the documented schemas. Preserve strict keys, field order,
safe loading, size/depth limits, anchor and alias rejection, audit markers,
and [idempotent](glossary.md#idempotent) updates.

Real budget writes require `BUDGET_WRITE_ENABLED=true`, a dedicated billing
administrator token, and the protected `budget-approver` environment. Dry run
remains the default. Read [IssueOps](issueops.md) and [Security](security.md)
before changing this area.

The distributable action lives under
`.github/actions/budget-issueops/`. Build and check its committed bundle with:

```powershell
npm run typecheck:issueops-action
npm run build:issueops-action
npm run check:issueops-action
```

Destination workflows must use an immutable action commit SHA. Setup and
diagnostics are plan-first GitHub CLI commands. Set
`ISSUEOPS_ACTION_REPOSITORY=OWNER/REPO` in the shell or pass
`--action-repo OWNER/REPO` to each command:

```powershell
npm run issueops:setup -- --repo OWNER/REPO --level dry-run --action-ref issueops-v1
npm run issueops:doctor -- --repo OWNER/REPO --level dry-run
```

## Troubleshooting

### The app says it is not configured

Check that `.env` exists in the repository root and contains all identity and
billing values. Restart `npm run dev` after changing environment variables.
Use [Configuration](configuration.md) as the checklist.

### GitHub reports a callback error

The GitHub App callback must exactly match the app origin plus
`/api/auth/github/callback`. For the default local server, use:

```text
http://localhost:3000/api/auth/github/callback
```

Also keep `APP_BASE_URL=http://localhost:3000`.

### Sign-in returns "not a member"

Confirm the signed-in login belongs to the configured enterprise and that
`GITHUB_ENTERPRISE_SLUG` is the slug from
`github.com/enterprises/<slug>`.

### Membership verification is temporarily unavailable

A `503` means the membership lookup failed, not that the user is known to be a
non-member. Check token validity, `read:enterprise`, rate limits, and GitHub
availability. The app intentionally
[fails closed](glossary.md#fail-closed).

### Usage or budget loading returns a billing error

Check that the classic PAT has `manage_billing:copilot` (read), the enterprise
slug is correct, and the credential holder has suitable enterprise access.
The dashboard token is read-only and is not the IssueOps administrator token.

### Budget requests are unavailable

They are disabled in demo mode. In configured mode,
`BUDGET_REQUEST_REPOSITORY` must be a valid `OWNER/REPO`. The dashboard prepares
a URL; it does not submit the issue automatically.

### Port 3000 is already in use

Stop the process using the port, or run the development server on another port:

```powershell
npm run dev -- -p 3001
```

Update the GitHub App callback and `APP_BASE_URL` to the same port when using
configured mode.

### A local build behaves as if old files still exist

Stop the server, remove the generated Next.js directory, and restart:

```powershell
Remove-Item .next -Recurse -Force
npm run dev
```

Do not delete `node_modules` or reinstall dependencies unless the failure
indicates an installation problem.

## Related documentation

- [Onboarding](onboarding.md)
- [Architecture](architecture.md)
- [Configuration](configuration.md)
- [IssueOps](issueops.md)
- [Security](security.md)
- [Glossary](glossary.md)

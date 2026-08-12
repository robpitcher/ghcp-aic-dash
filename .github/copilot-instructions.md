# Copilot instructions

## Build, test, and lint

Use Node.js 20+ and npm. Install dependencies with `npm install` for local development; use `npm ci` in CI and Docker builds.

```bash
npm run dev          # Next.js development server at http://localhost:3000
npm run build        # Production Next.js build
npm run start        # Serve the production build
npm run lint         # ESLint
npm run test         # Vitest unit/component suite
npm run test:watch   # Vitest watch mode
```

Run one test file with `npx vitest run src/lib/__tests__/auth.test.ts`, or filter tests by name with `npx vitest run -t "test name"`. Vitest discovers `src/**/*.test.ts` and `src/**/*.test.tsx`, uses the `@/*` alias for `src/*`, and loads `src/test/setup.ts`.

For an environment close to deployment, `docker compose up --build` runs the standalone Next.js image on port 3000. Copy `.env.example` to `.env`; identity and billing secrets are runtime configuration and must not be put in the image or sent to the browser.

## Architecture

- This is a Next.js App Router application using React 19, TypeScript, Tailwind CSS, and Recharts. Pages under `src/app` compose the login flow and dashboard views; reusable client UI is under `src/components`.
- The browser talks only to same-origin route handlers under `src/app/api`. OAuth routes establish a short-lived, HMAC-signed `identity_session` cookie. The OAuth access token is used only to read the GitHub identity and is discarded.
- Data routes call `requireEnterpriseMember` before accessing billing data. `resolveUserScope` is the mandatory self-scope choke point: `/api/usage/me`, `/api/budget/me`, and budget-request preparation must use the authenticated session login, never a browser-supplied user. The privileged `GITHUB_BILLING_TOKEN` remains server-side.
- `src/lib/config.ts` is the runtime configuration boundary. Identity, billing, enterprise membership, and optional IssueOps configuration are validated independently with Zod so incomplete local deployments can render actionable configuration states.
- `src/lib/github` is the isolated GitHub enterprise billing client. It normalizes upstream usage/budget responses, paginates budgets with a cap, retries transient failures with backoff, and treats permission-related 401/403/404 responses as actionable errors.
- `src/lib/usage` provides the live on-demand usage provider and pure aggregation/insight functions. There is no application database: monthly usage and the six-month trend are fetched from GitHub when requested.
- `src/lib/budget` resolves the effective budget and builds the prefilled issue request. The browser submits only an increase amount and justification; the server re-fetches the authenticated user’s budget and opens a reviewable GitHub issue rather than creating one.
- `src/lib/issueops` contains the pure parsing, policy, triage, apply, audit, and rollback logic used by `scripts/budget-request-*.ts`. GitHub Actions in `.github/workflows` install with `npm ci` and run those scripts with `tsx`.
- Budget writes are intentionally protected: dry-run is the default, `BUDGET_WRITE_ENABLED` must be exactly `true`, and real apply/rollback jobs run in the `budget-approver` environment with required reviewers and the dedicated `GH_BILLING_ADMIN_TOKEN`. The issue audit comment is the state store for apply/rollback.

## Repository conventions

- Prefer the existing separation of pure domain logic (`src/lib/**`) from Next route handlers and client components. Put validation, normalization, calculations, and workflow planning in testable library functions; keep handlers responsible for HTTP/auth/config orchestration.
- Use the `@/` path alias for imports from `src`, and keep tests colocated in `__tests__` directories next to the module or component they cover.
- Validate untrusted input at boundaries with Zod or the existing explicit type guards. Route handlers return structured JSON errors with the established statuses: `400` for missing configuration, `401` for missing identity, `403` for failed membership, `422` for invalid input, `502` for upstream billing failures, and `503` for membership verification failures.
- Preserve fail-closed access control and data isolation. Do not add an endpoint that accepts an arbitrary GitHub login unless it has an explicitly reviewed authorization path; `/me` endpoints are self-only for every role, including admin and manager sessions.
- Keep all billing calculations and billing-period decisions in UTC. Budget requests expire on the last day of the current UTC month, and usage trends are keyed by UTC year/month.
- Treat GitHub API responses as untrusted and schema-drifting. Return sanitized domain shapes rather than raw upstream payloads, cap pagination/work, and retain the existing retry behavior only for transient failures.
- Keep structured IssueOps YAML compatible with the documented `ghcp-aic-budget-request:v1` and `ghcp-aic-budget-apply:v1` schemas. Preserve field order, strict key validation, size/depth limits, safe YAML loading, and rejection of anchors, aliases, and prototype-related keys.
- Preserve idempotency and audit markers (`budget-request-triage`, `budget-request-apply`, and `budget-request-rollback`) when changing workflow behavior. Triage removes stale classification labels and updates one bot comment rather than creating duplicates.
- Keep security-sensitive changes aligned across the route, library, script, workflow, and README surfaces. In particular, never reuse the dashboard read token as the administrator write credential, and never expose either credential to client code.
- Follow the existing ESLint configuration. The `react-hooks/set-state-in-effect` rule is intentionally disabled for the dashboard’s fetch/loading and theme initialization effects; do not broaden that exception without a concrete need.

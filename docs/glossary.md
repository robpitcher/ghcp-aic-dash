# Glossary

These definitions describe how terms are used in this repository. For project
flows, see [Onboarding](onboarding.md) and [Architecture](architecture.md).

## AI credit

A billing unit consumed by eligible GitHub Copilot features. The dashboard
shows credit usage and converts budget amounts where required by the GitHub
billing model.

## API

**Application Programming Interface.** A defined way for software systems to
exchange requests and responses. This project has same-origin API route
handlers under `src/app/api` and calls GitHub billing APIs from the server.

## API route

A server endpoint implemented with the Next.js App Router. API routes handle
HTTP details, authentication, configuration checks, and error mapping while
delegating calculations to `src/lib`.

## billing period

The year and month for which usage is calculated. This project makes billing
period decisions in Coordinated Universal Time (UTC).

## billing token

The server-only `GITHUB_BILLING_TOKEN` used to read enterprise usage, budgets,
and membership information. It must never be sent to the browser or reused as
the budget administrator write credential.

## CI

**Continuous Integration.** Automated checks that install dependencies, run
validation, or build software after changes. This repository uses `npm ci` in
CI and Docker builds.

## CSRF

**Cross-Site Request Forgery.** An attack that tricks a browser into sending an
unwanted authenticated request. The GitHub sign-in flow uses a short-lived,
random `state` value stored in an HTTP-only cookie so the callback can verify
that the login was started by this application.

## CSV

**Comma-Separated Values.** A simple tabular text format. The Analytics page can
download the signed-in developer's normalized usage data as a CSV file.

## dry run

A mode that reports a planned action without changing external state. Budget
apply and rollback workflows default to dry run, and real writes require
additional explicit controls.

## enterprise slug

The short name in a GitHub Enterprise URL, such as `example` in
`github.com/enterprises/example`. It is configured with
`GITHUB_ENTERPRISE_SLUG`.

## fail closed

To deny access when a security check cannot complete. For example, a GitHub
membership lookup error returns `503` and blocks access instead of assuming the
user is a member.

## GitHub App

A GitHub integration with its own client ID and secret. This project uses a
GitHub App web flow only to identify a developer; it does not install the app
or request account permissions for billing.

## GraphQL

An API query language and runtime. The dashboard uses GitHub's enterprise
GraphQL API for membership verification.

## HMAC

**Hash-based Message Authentication Code.** A keyed cryptographic signature
used to detect tampering. The app signs identity sessions with HMAC-SHA256 and
`SESSION_SECRET`.

## HTTP

**Hypertext Transfer Protocol.** The request-response protocol used by browsers
and web APIs. The route handlers return structured JSON and meaningful HTTP
status codes.

## HTTP-only cookie

A browser cookie that client-side JavaScript cannot read. The app stores its
signed identity session in an HTTP-only cookie to reduce exposure to script
access.

## idempotent

Safe to repeat without creating unintended duplicate effects. Budget workflows
reuse marker comments and reconcile labels or audit state instead of adding a
new copy on every run.

## IssueOps

An operational workflow driven by GitHub issues, labels, comments, and Actions.
Here, a structured budget-request issue is triaged and can later be applied or
rolled back through thin workflows pinned to a bundled action. See
[IssueOps](issueops.md).

## least privilege

Giving a credential or process only the permissions needed for its task. The
dashboard read token and the protected budget administrator write token are
deliberately separate.

## OAuth

**Open Authorization.** A standard authorization framework used in web sign-in
flows. GitHub Apps use an OAuth-style user-to-server web flow here: the app
exchanges a temporary code for an access token, reads the user's public login
and ID, and then discards the token.

## PAT

**Personal Access Token.** A GitHub credential created by a user. Configured
mode currently uses a classic PAT with `manage_billing:copilot` (read) and
`read:enterprise` as the server-side billing token.

## RBAC

**Role-Based Access Control.** Authorization based on assigned roles. Session
data can represent developer, manager, or administrator roles, but current
`/me` endpoints remain self-only for every role.

## sanitized response

A deliberately small application-owned data shape returned after validating
and normalizing external data. It excludes raw GitHub responses, unnecessary
fields, and credentials.

## scope

The boundary of data or permissions available to a request. In this project,
the supported billing scope is `enterprise`, and personal data routes enforce
self-scope.

## self-scope

The rule that a personal endpoint can access only the signed-in developer's
data. `resolveUserScope` uses the verified session login and ignores any
browser attempt to select another user.

## UTC

**Coordinated Universal Time.** A global time standard independent of local
time zones. Billing months, trends, forecasts, and budget-request expiration
are calculated in UTC.

## YAML

**YAML Ain't Markup Language.** A human-readable structured-data format.
Budget-request and audit comments contain fenced YAML with strict schemas.
Parsers use safe loading and reject unexpected keys, unsafe object names,
anchors, aliases, excessive size, and excessive depth.

## Zod

A TypeScript-first validation library. The project uses Zod at configuration
and request boundaries so invalid or incomplete data produces controlled,
actionable errors.

## Related documentation

- [README](../README.md)
- [Onboarding](onboarding.md)
- [Development](development.md)
- [Architecture](architecture.md)
- [Configuration](configuration.md)
- [IssueOps](issueops.md)
- [Security](security.md)

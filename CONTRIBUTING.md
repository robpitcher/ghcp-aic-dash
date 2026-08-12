# Contributing

Thanks for helping improve the GitHub Copilot AI Credit Dashboard.

## Before you start

Use the issue forms for bugs and feature proposals. Blank issues are also
available for questions or topics that do not fit those forms. Do not include
tokens, secrets, private usage data, or other sensitive information in issues
or pull requests. Operational AI credit budget requests belong in the
configured destination repository, not this source repository.

For security-sensitive reports, follow the private reporting process in
[SECURITY.md](SECURITY.md). Do not include exploit details in public issues.

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md).
By participating, you agree to uphold it. If you need help rather than want to
change something, read [SUPPORT.md](SUPPORT.md).

## Set up locally

Read [Onboarding](docs/onboarding.md) for the project overview and
[Development](docs/development.md) for installation, demo mode, configured
mode, Docker, testing, and troubleshooting.

The fastest credential-free setup is:

```powershell
npm install
$env:DEMO_ENV = "true"
npm run dev
```

## Make a change

1. Create a focused branch from the default branch.
2. Read the relevant code and nearby tests before changing behavior.
3. Keep validation, calculations, and workflow planning in `src/lib/**`;
   keep route handlers focused on HTTP, authentication, configuration, and
   error mapping.
4. Preserve self-scoped `/me` access, server-only credentials, fail-closed
   enterprise membership checks, UTC billing decisions, and IssueOps dry-run
   and audit protections.
5. Add or update colocated tests for behavior changes.
6. Update documentation when configuration, behavior, or operational steps
   change.

## Run checks

Before opening a pull request, run:

```powershell
npm run lint
npm run test
```

For changes affecting the application build, also run:

```powershell
npm run build
```

For changes affecting IssueOps source or the distributable action, also run:

```powershell
npm run check:issueops-action
```

Review the diff and check for whitespace errors:

```powershell
git diff --check
git diff
```

## Pull requests

Keep pull requests small and explain the user-visible or operational impact.
Include the tests and other checks you ran, call out configuration or
security implications, and identify any follow-up work. Do not commit `.env`,
credentials, generated local state, or unrelated formatting changes.

Pull requests run the repository's lint and test checks. A maintainer may ask
for a production build, IssueOps bundle check, or additional focused test when
the changed area requires it.

## Code style

Follow the existing TypeScript, React, Next.js, Tailwind, and test conventions.
Use the `@/` alias for imports from `src`, prefer existing helpers, and avoid
unnecessary type assertions or broad error handling. Comments should explain
non-obvious reasoning rather than restate code.

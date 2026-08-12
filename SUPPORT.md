# Support

Thanks for using the GitHub Copilot AI Credit Dashboard. This page explains
where to get help and what to expect.

## Before you ask

Most questions are answered in the documentation:

- [Onboarding](docs/onboarding.md) — first tour and safe first change
- [Development](docs/development.md) — local setup, demo mode, Docker, testing,
  and troubleshooting
- [Configuration](docs/configuration.md) — environment variables and GitHub setup
- [Architecture](docs/architecture.md) — components and data flow
- [IssueOps](docs/issueops.md) — installation and staged enablement
- [IssueOps operations](docs/issueops-operations.md) — approval, apply, rollback
- [Security](docs/security.md) — trust boundaries, credentials, and controls
- [Glossary](docs/glossary.md) — recurring terms and acronyms

The fastest credential-free way to reproduce behavior locally is demo mode:

```powershell
npm install
$env:DEMO_ENV = "true"
npm run dev
```

## Where to ask

| What you need | Where to go |
|---|---|
| Bug in the dashboard or IssueOps automation | Open a [bug report](../../issues/new?template=bug_report.yml) |
| New capability or change proposal | Open a [feature request](../../issues/new?template=feature_request.yml) |
| Question, setup help, or anything else | Open a blank issue |
| Suspected security vulnerability | Follow [SECURITY.md](SECURITY.md) — do **not** open a public issue |
| An AI credit budget increase for your own account | Use your organization's configured budget request repository, not this repository |

## What to include

Good reports get faster answers. Where relevant, include:

- The version or commit you are running.
- Whether you are in demo mode or configured mode.
- The exact command you ran and the full error output.
- What you expected to happen versus what happened.

Never include tokens, secrets, cookies, private usage data, enterprise slugs,
or other sensitive information. Redact values before pasting logs.

## What to expect

This project is maintained on a best-effort basis by volunteers, and there is
no service level agreement or guaranteed response time. Issues are triaged as
maintainer time allows. Security reports take priority over everything else.

Support covers this repository's source code and documentation. It does not
cover your GitHub Enterprise billing configuration, your organization's budget
approval policy, or the GitHub billing APIs themselves — contact GitHub Support
or your enterprise administrator for those.

## Helping out

Fixes and documentation improvements are welcome. Read
[CONTRIBUTING.md](CONTRIBUTING.md) to get started.

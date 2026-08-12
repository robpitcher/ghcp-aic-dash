---
name: AI credit budget request
about: Request a temporary increase to an effective AI credit budget
title: "[AI Credit Budget Request] "
labels: ""
assignees: ""
---

Replace every placeholder below without changing the key names or schema
marker. Credit values are non-negative integers,
`requested_increase_credits` is positive and divisible by 100, and
`requested_total_credits` equals `current_budget_credits` plus
`requested_increase_credits`. `effective_source` is one of `individual`,
`cost_center`, or `universal`, `expiration_date` is a UTC `YYYY-MM-DD` date,
and `generated_at` is an ISO 8601 UTC timestamp.

```yaml
schema: "ghcp-aic-budget-request:v1"
requester: "github-login"
current_budget_credits: 3000
current_consumed_credits: 425
requested_increase_credits: 1500
requested_total_credits: 4500
effective_source: "individual"
expiration_date: "2026-08-31"
generated_at: "2026-08-04T20:30:00.000Z"
```

## Business justification

Explain the business need for the requested increase.

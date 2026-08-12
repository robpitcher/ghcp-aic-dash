import { describe, expect, it } from "vitest";
import {
  MAX_BUDGET_REQUEST_URL_LENGTH,
  budgetRequestInputSchema,
  buildBudgetIssuePrefill,
  getCurrentBillingMonthExpiration,
} from "../request";
import type { AvailableEffectiveBudget } from "../types";

const budget: AvailableEffectiveBudget = {
  scopedLogin: "alice",
  hasBudget: true,
  source: "cost_center",
  amountUsd: 30,
  amountCredits: 3_000,
  consumedUsd: 4.25,
  consumedCredits: 425,
  remainingUsd: 25.75,
  remainingCredits: 2_575,
  percentUsed: 14.2,
};

describe("budget request issue generation", () => {
  it("builds a deterministic, parseable request with the stable v1 schema", () => {
    const generatedAt = new Date("2026-08-04T20:30:00.000Z");
    const input = {
      repository: "acme/ai-budget-requests",
      budget,
      requestedIncreaseCredits: 1_500,
      justification: "Needed for the customer migration readiness work.",
      generatedAt,
    };

    const first = buildBudgetIssuePrefill(input);
    const second = buildBudgetIssuePrefill(input);

    expect(second).toEqual(first);
    expect(first.title).toBe(
      "[AI Credit Budget Request] alice: +1500 credits",
    );
    expect(first.expirationDate).toBe("2026-08-31");
    expect(first.body).toBe(`\`\`\`yaml
schema: "ghcp-aic-budget-request:v1"
requester: "alice"
current_budget_credits: 3000
current_consumed_credits: 425
requested_increase_credits: 1500
requested_total_credits: 4500
effective_source: "cost_center"
expiration_date: "2026-08-31"
generated_at: "2026-08-04T20:30:00.000Z"
\`\`\`

## Business justification

Needed for the customer migration readiness work.`);

    const url = new URL(first.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://github.com/acme/ai-budget-requests/issues/new",
    );
    expect(url.searchParams.get("title")).toBe(first.title);
    expect(url.searchParams.get("body")).toBe(first.body);
  });

  it("fixes expiration to the last UTC date of leap-year February", () => {
    expect(
      getCurrentBillingMonthExpiration(
        new Date("2028-02-02T23:59:59.000-08:00"),
      ),
    ).toBe("2028-02-29");
  });

  it("keeps fence-like and YAML-looking justification outside the YAML block", () => {
    const result = buildBudgetIssuePrefill({
      repository: "acme/requests",
      budget,
      requestedIncreaseCredits: 100,
      justification:
        "Support launch work.\n```yaml\nrequester: mallory\n```\nschema: forged",
      generatedAt: new Date("2026-08-04T20:30:00.000Z"),
    });

    expect(result.body.match(/```/g)).toHaveLength(2);
    expect(result.body.indexOf("## Business justification")).toBeGreaterThan(
      result.body.indexOf('generated_at: "2026-08-04T20:30:00.000Z"'),
    );
    expect(result.body).toContain("``\\`yaml");
  });

  it("truncates encoding-heavy justification to a safe URL length and marks it", () => {
    const result = buildBudgetIssuePrefill({
      repository: "acme/requests",
      budget,
      requestedIncreaseCredits: 100,
      justification: "%".repeat(4_000),
      generatedAt: new Date("2026-08-04T20:30:00.000Z"),
    });

    expect(result.justificationTruncated).toBe(true);
    expect(result.url.length).toBeLessThanOrEqual(
      MAX_BUDGET_REQUEST_URL_LENGTH,
    );
    expect(result.body).toContain(
      "[Justification truncated to fit the GitHub issue URL.]",
    );
  });

  it("refuses a prefill whose fixed fields alone exceed the URL limit", () => {
    expect(() =>
      buildBudgetIssuePrefill({
        repository: `${"a".repeat(8_000)}/requests`,
        budget,
        requestedIncreaseCredits: 100,
        justification: "A sufficiently detailed business justification.",
        generatedAt: new Date("2026-08-04T20:30:00.000Z"),
      }),
    ).toThrow(/exceeds 7500 characters/);
  });
});

describe("budget request validation", () => {
  it.each([0, -100, 1.5, 150])("rejects invalid increase %s", (value) => {
    expect(
      budgetRequestInputSchema.safeParse({
        requestedIncreaseCredits: value,
        justification: "A sufficiently detailed business justification.",
      }).success,
    ).toBe(false);
  });

  it("rejects missing, short, and overlong justifications", () => {
    for (const justification of [undefined, "too short", "x".repeat(4_001)]) {
      expect(
        budgetRequestInputSchema.safeParse({
          requestedIncreaseCredits: 100,
          justification,
        }).success,
      ).toBe(false);
    }
  });

  it("rejects client-supplied identity fields", () => {
    const parsed = budgetRequestInputSchema.safeParse({
      requestedIncreaseCredits: 100,
      justification: "A sufficiently detailed business justification.",
      requester: "mallory",
    });
    expect(parsed.success).toBe(false);
  });
});

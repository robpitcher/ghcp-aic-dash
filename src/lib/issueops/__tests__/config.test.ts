import { describe, expect, it } from "vitest";
import {
  ISSUEOPS_CONFIG_SCHEMA,
  getIssueOpsPolicyLimits,
  parseIssueOpsConfig,
  requireIssueOpsEnterpriseSlug,
} from "../index";

function validConfig(
  overrides: Partial<{
    enterpriseSlug: string;
    maxDelta: number;
    maxTotal: number;
  }> = {},
): string {
  return `schema: "${ISSUEOPS_CONFIG_SCHEMA}"
enterprise_slug: "${overrides.enterpriseSlug ?? "example-enterprise"}"
auto_approval:
  max_delta_credits: ${overrides.maxDelta ?? 2000}
  max_total_credits: ${overrides.maxTotal ?? 5000}
`;
}

describe("IssueOps configuration", () => {
  it("parses the strict checked-in contract", () => {
    const parsed = parseIssueOpsConfig(validConfig());
    expect(parsed).toEqual({
      ok: true,
      config: {
        schema: ISSUEOPS_CONFIG_SCHEMA,
        enterprise_slug: "example-enterprise",
        auto_approval: {
          max_delta_credits: 2000,
          max_total_credits: 5000,
        },
      },
    });
    if (parsed.ok) {
      expect(getIssueOpsPolicyLimits(parsed.config)).toEqual({
        maxDeltaCredits: 2000,
        maxTotalCredits: 5000,
      });
      expect(requireIssueOpsEnterpriseSlug(parsed.config)).toBe(
        "example-enterprise",
      );
    }
  });

  it("allows null enterprise configuration before writes are enabled", () => {
    const parsed = parseIssueOpsConfig(
      validConfig().replace(
        'enterprise_slug: "example-enterprise"',
        "enterprise_slug: null",
      ),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(() => requireIssueOpsEnterpriseSlug(parsed.config)).toThrow(
        "enterprise_slug must be configured",
      );
    }
  });

  it("uses zero limits to disable auto-eligibility", () => {
    const parsed = parseIssueOpsConfig(
      validConfig({ maxDelta: 0, maxTotal: 0 }),
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(getIssueOpsPolicyLimits(parsed.config)).toEqual({
        maxDeltaCredits: 0,
        maxTotalCredits: 0,
      });
    }
  });

  it("rejects unknown and invalid fields", () => {
    const parsed = parseIssueOpsConfig(
      validConfig()
        .replace(
          "auto_approval:",
          "unexpected: true\nauto_approval:",
        )
        .replace("max_delta_credits: 2000", "max_delta_credits: -1"),
    );
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors).toEqual(
        expect.arrayContaining([
          "Unexpected configuration field: unexpected.",
          "auto_approval.max_delta_credits must be a non-negative safe integer.",
        ]),
      );
    }
  });

  it("rejects reordered fields", () => {
    const parsed = parseIssueOpsConfig(
      validConfig().replace(
        `schema: "${ISSUEOPS_CONFIG_SCHEMA}"\nenterprise_slug: "example-enterprise"`,
        `enterprise_slug: "example-enterprise"\nschema: "${ISSUEOPS_CONFIG_SCHEMA}"`,
      ),
    );
    expect(parsed).toEqual({
      ok: false,
      errors: ["configuration fields must appear in the documented order."],
    });
  });

  it("rejects unsafe YAML constructs", () => {
    expect(
      parseIssueOpsConfig(
        validConfig().replace(
          "auto_approval:",
          "__proto__: polluted\nauto_approval:",
        ),
      ),
    ).toEqual({
      ok: false,
      errors: [
        "IssueOps configuration contains a forbidden prototype-related key.",
      ],
    });
    expect(
      parseIssueOpsConfig(
        validConfig().replace(
          "enterprise_slug:",
          "enterprise_slug: &slug\ncopied_slug: *slug\nignored:",
        ),
      ).ok,
    ).toBe(false);
  });
});

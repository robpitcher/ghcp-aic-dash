import { describe, expect, it } from "vitest";
import {
  BUDGET_AUTO_ELIGIBLE_LABEL,
  BUDGET_INVALID_LABEL,
  BUDGET_NEEDS_APPROVAL_LABEL,
  BUDGET_REQUEST_LABEL,
  BUDGET_TRIAGE_COMMENT_MARKER,
  MAX_BUDGET_REQUEST_BODY_LENGTH,
  MAX_BUDGET_REQUEST_YAML_DEPTH,
  buildBudgetTriageComment,
  findBudgetTriageComments,
  getBudgetClassificationLabel,
  isBudgetRequestIssue,
  parseBudgetRequestBody,
  parseBudgetRequestPolicyLimits,
  triageBudgetRequest,
} from "../index";

const NOW = new Date("2026-08-04T20:30:00.000Z");

function validBody(overrides: Partial<Record<string, string | number>> = {}) {
  const values = {
    schema: '"ghcp-aic-budget-request:v1"',
    requester: '"alice"',
    current_budget_credits: 3000,
    current_consumed_credits: 425,
    requested_increase_credits: 1500,
    requested_total_credits: 4500,
    effective_source: '"cost_center"',
    expiration_date: '"2026-08-31"',
    generated_at: '"2026-08-04T20:30:00.000Z"',
    ...overrides,
  };

  return `\`\`\`yaml
${Object.entries(values)
  .map(([key, value]) => `${key}: ${value}`)
  .join("\n")}
\`\`\`

## Business justification

Needed for the customer migration readiness work.`;
}

function triage(
  body = validBody(),
  input: Partial<Parameters<typeof triageBudgetRequest>[0]> = {},
) {
  return triageBudgetRequest({
    title: "[AI Credit Budget Request] alice: +1500 credits",
    authorLogin: "alice",
    body,
    limits: { maxDeltaCredits: 2000, maxTotalCredits: 5000 },
    now: NOW,
    ...input,
  });
}

describe("budget request parser", () => {
  it("parses the exact layer-5 contract", () => {
    expect(parseBudgetRequestBody(validBody())).toEqual({
      ok: true,
      request: {
        schema: "ghcp-aic-budget-request:v1",
        requester: "alice",
        current_budget_credits: 3000,
        current_consumed_credits: 425,
        requested_increase_credits: 1500,
        requested_total_credits: 4500,
        effective_source: "cost_center",
        expiration_date: "2026-08-31",
        generated_at: "2026-08-04T20:30:00.000Z",
      },
    });
  });

  it("accepts GitHub login casing and underscores", () => {
    const result = parseBudgetRequestBody(
      validBody({ requester: '"Test_User"' }),
    );
    expect(result).toEqual({
      ok: true,
      request: expect.objectContaining({ requester: "Test_User" }),
    });
  });

  it("uses the first YAML block containing the schema marker", () => {
    const forged = validBody({ requester: '"mallory"' });
    const result = triage(`${forged}\n\n${validBody()}`);
    expect(result.classification).toBe("invalid");
    expect(result.errors).toContain(
      "Issue author must match the requester GitHub login.",
    );
  });

  it("rejects a body with no YAML block", () => {
    expect(
      parseBudgetRequestBody("schema marker ghcp-aic-budget-request:v1"),
    ).toEqual({
      ok: false,
      errors: [
        "Add a fenced ```yaml block containing the budget request schema marker.",
      ],
    });
  });

  it("rejects an oversized issue body", () => {
    const body =
      `${validBody()}\n` +
      "x".repeat(MAX_BUDGET_REQUEST_BODY_LENGTH - validBody().length);
    expect(parseBudgetRequestBody(body)).toEqual({
      ok: false,
      errors: [
        `Issue body exceeds the ${MAX_BUDGET_REQUEST_BODY_LENGTH}-character limit.`,
      ],
    });
  });

  it.each([
    [
      "unsafe JavaScript tag",
      validBody({ requester: "!!js/function 'function () {}'" }),
      "Structured YAML is not valid safe YAML.",
    ],
    [
      "anchors and aliases",
      validBody({ requester: "&a alice", effective_source: "*a" }),
      "YAML anchors and aliases are not allowed.",
    ],
    [
      "prototype pollution key",
      validBody().replace(
        'requester: "alice"',
        '__proto__: "polluted"\nrequester: "alice"',
      ),
      "Structured YAML contains a forbidden prototype-related key.",
    ],
  ])("rejects malicious %s", (_name, body, expectedError) => {
    const result = parseBudgetRequestBody(body);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(expectedError);
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("rejects YAML beyond the configured depth", () => {
    const body = validBody().replace(
      "current_budget_credits: 3000",
      "current_budget_credits:\n  nested:\n    deeper:\n      value: 3000",
    );
    expect(parseBudgetRequestBody(body)).toEqual({
      ok: false,
      errors: [
        `Structured YAML exceeds the maximum depth of ${MAX_BUDGET_REQUEST_YAML_DEPTH}.`,
      ],
    });
  });

  it("treats command substitutions and backticks as inert justification text", () => {
    const body = `${validBody()}\n\n$(rm -rf /) and \`touch /tmp/pwned\``;
    expect(triage(body).classification).toBe("auto-eligible");
  });

  it("rejects missing, extra, reordered, and invalid fields actionably", () => {
    const body = validBody()
      .replace('requester: "alice"\n', "")
      .replace(
        'schema: "ghcp-aic-budget-request:v1"',
        'schema: "ghcp-aic-budget-request:v1"\nextra: true',
      );
    const invalidBody = body.replace(
      "current_consumed_credits: 425",
      "current_consumed_credits: -1",
    );
    const result = parseBudgetRequestBody(invalidBody);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual(
        expect.arrayContaining([
          "Missing required field: requester.",
          "Unexpected field: extra.",
          "current_consumed_credits must be a non-negative integer.",
        ]),
      );
    }
  });
});

describe("budget request policy", () => {
  it("ignores issues unless both identifiers are present", () => {
    expect(isBudgetRequestIssue("ordinary issue", validBody())).toBe(false);
    expect(
      isBudgetRequestIssue(
        "[AI Credit Budget Request] alice: +1500 credits",
        "ordinary body",
      ),
    ).toBe(false);
    expect(
      isBudgetRequestIssue(
        "[AI Credit Budget Request] alice: +1500 credits",
        validBody(),
      ),
    ).toBe(true);
  });

  it("classifies valid requests within both positive limits as auto-eligible", () => {
    expect(triage().classification).toBe("auto-eligible");
  });

  it("defaults missing, blank, non-numeric, and unsafe limits to zero", () => {
    for (const values of [
      [undefined, undefined],
      ["", "  "],
      ["not-a-number", "5000"],
      ["2000", "3.5"],
      ["9007199254740992", "5000"],
    ] as const) {
      const limits = parseBudgetRequestPolicyLimits(values[0], values[1]);
      expect(triage(validBody(), { limits }).classification).toBe(
        "needs approval",
      );
    }
  });

  it("requires both limits to be positive and satisfied", () => {
    expect(
      triage(validBody(), {
        limits: { maxDeltaCredits: 0, maxTotalCredits: 5000 },
      }).classification,
    ).toBe("needs approval");
    expect(
      triage(validBody(), {
        limits: { maxDeltaCredits: 1000, maxTotalCredits: 5000 },
      }).classification,
    ).toBe("needs approval");
    expect(
      triage(validBody(), {
        limits: { maxDeltaCredits: 2000, maxTotalCredits: 4000 },
      }).classification,
    ).toBe("needs approval");
  });

  it("invalidates an author/requester mismatch", () => {
    const result = triage(validBody(), { authorLogin: "mallory" });
    expect(result.classification).toBe("invalid");
    expect(result.errors).toContain(
      "Issue author must match the requester GitHub login.",
    );
  });

  it("invalidates a stale expiration and mismatched title", () => {
    const result = triage(validBody({ expiration_date: '"2026-07-31"' }), {
      title: "[AI Credit Budget Request] alice: +999 credits",
    });
    expect(result.classification).toBe("invalid");
    expect(result.errors).toHaveLength(2);
  });

  it.each([
    ["negative current amount", { current_budget_credits: -1 }],
    ["fractional consumed amount", { current_consumed_credits: 1.5 }],
    ["zero increase", { requested_increase_credits: 0 }],
    ["non-100 increase", { requested_increase_credits: 150 }],
    ["incorrect total", { requested_total_credits: 9999 }],
    ["invalid source", { effective_source: '"organization"' }],
  ])("invalidates %s", (_name, overrides) => {
    expect(triage(validBody(overrides)).classification).toBe("invalid");
  });
});

describe("triage reconciliation helpers", () => {
  it("uses the stable labels and classification mapping", () => {
    expect(BUDGET_REQUEST_LABEL).toBe("budget-request");
    expect(getBudgetClassificationLabel("invalid")).toBe(BUDGET_INVALID_LABEL);
    expect(getBudgetClassificationLabel("needs approval")).toBe(
      BUDGET_NEEDS_APPROVAL_LABEL,
    );
    expect(getBudgetClassificationLabel("auto-eligible")).toBe(
      BUDGET_AUTO_ELIGIBLE_LABEL,
    );
  });

  it("finds only existing bot comments with the stable marker", () => {
    const comments = findBudgetTriageComments([
      {
        id: 1,
        body: `${BUDGET_TRIAGE_COMMENT_MARKER}\nold`,
        authorType: "Bot",
      },
      {
        id: 2,
        body: BUDGET_TRIAGE_COMMENT_MARKER,
        authorType: "User",
      },
      { id: 3, body: "ordinary bot comment", authorType: "Bot" },
      {
        id: 4,
        body: `${BUDGET_TRIAGE_COMMENT_MARKER}\nduplicate`,
        authorType: "Bot",
      },
    ]);
    expect(comments.map((comment) => comment.id)).toEqual([1, 4]);
  });

  it("lists every failed rule in the single marked comment", () => {
    const comment = buildBudgetTriageComment(
      {
        classification: "invalid",
        errors: ["Fix the requester.", "Fix the total."],
      },
      { maxDeltaCredits: 0, maxTotalCredits: 0 },
    );
    expect(comment.startsWith(BUDGET_TRIAGE_COMMENT_MARKER)).toBe(true);
    expect(comment).toContain("- Fix the requester.");
    expect(comment).toContain("- Fix the total.");
  });
});

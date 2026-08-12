import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/budget/request/route";
import { createIdentitySession } from "@/lib/auth";

const { checkEnterpriseMembership } = vi.hoisted(() => ({
  checkEnterpriseMembership: vi.fn(async () => true),
}));

vi.mock("@/lib/github", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github")>();
  return { ...actual, checkEnterpriseMembership };
});

const ENV = {
  GITHUB_APP_CLIENT_ID: "client-id",
  GITHUB_APP_CLIENT_SECRET: "client-secret",
  SESSION_SECRET: "unit-test-session-secret",
  GITHUB_BILLING_TOKEN: "privileged-billing-token",
  GITHUB_ENTERPRISE_SLUG: "acme",
  GITHUB_BILLING_SCOPE: "enterprise",
  BUDGET_REQUEST_REPOSITORY: "acme/budget-requests",
};

function devCookie(login: string): string {
  const token = createIdentitySession({ login, id: 1, role: "developer" });
  return `identity_session=${token}`;
}

function request(body: unknown, cookie?: string): NextRequest {
  return new NextRequest("https://dash.test/api/budget/request", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    headers: { get: () => null },
    json: async () => body,
    text: async () => "upstream error",
  } as unknown as Response;
}

function budgetResponse(): Response {
  return response({
    budgets: [{ id: "winner", budget_scope: "user" }],
    effective_budget: {
      id: "winner",
      budget_amount: 30,
      consumed_amount: 4.25,
    },
  });
}

describe("POST /api/budget/request", () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, ENV);
    checkEnterpriseMembership.mockReset();
    checkEnterpriseMembership.mockResolvedValue(true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T20:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    process.env = { ...original };
  });

  it("uses only authenticated server data in the configured repository", async () => {
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        fetchedUrls.push(input.toString());
        return budgetResponse();
      }),
    );

    const result = await POST(
      request(
        {
          requestedIncreaseCredits: 1_500,
          justification:
            "Needed to complete the customer migration readiness work.",
        },
        devCookie("Alice"),
      ),
    );
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body.title).toBe(
      "[AI Credit Budget Request] alice: +1500 credits",
    );
    expect(body.body).toContain('requester: "alice"');
    expect(body.body).toContain("current_budget_credits: 3000");
    expect(body.body).toContain("current_consumed_credits: 425");
    expect(body.body).toContain('effective_source: "individual"');
    expect(body.body).toContain('expiration_date: "2026-08-31"');
    expect(body.body).toContain(
      'generated_at: "2026-08-04T20:30:00.000Z"',
    );
    expect(body.url).toMatch(
      /^https:\/\/github\.com\/acme\/budget-requests\/issues\/new\?/,
    );
    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toContain("user=alice");
  });

  it("rejects attempts to submit another requester before billing access", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const result = await POST(
      request(
        {
          requester: "mallory",
          requestedIncreaseCredits: 100,
          justification: "A sufficiently detailed business justification.",
        },
        devCookie("alice"),
      ),
    );

    expect(result.status).toBe(422);
    expect((await result.json()).error).toContain(
      "Only requestedIncreaseCredits and justification",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [150, "multiple of 100"],
    [0, "greater than zero"],
    [-100, "greater than zero"],
    [1.5, "whole number"],
  ])("rejects invalid increase %s with a clear message", async (value, message) => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await POST(
      request(
        {
          requestedIncreaseCredits: value,
          justification: "A sufficiently detailed business justification.",
        },
        devCookie("alice"),
      ),
    );
    expect(result.status).toBe(422);
    expect((await result.json()).error).toContain(message);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 400 when the IssueOps destination is missing or invalid", async () => {
    process.env.BUDGET_REQUEST_REPOSITORY = "not/a/valid/repository";
    vi.stubGlobal("fetch", vi.fn());
    const result = await POST(
      request(
        {
          requestedIncreaseCredits: 100,
          justification: "A sufficiently detailed business justification.",
        },
        devCookie("alice"),
      ),
    );
    expect(result.status).toBe(400);
    expect((await result.json()).error).toContain(
      "BUDGET_REQUEST_REPOSITORY",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without an authenticated identity session", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await POST(
      request({
        requestedIncreaseCredits: 100,
        justification: "A sufficiently detailed business justification.",
      }),
    );
    expect(result.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a clear error when no effective budget exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        response({ budgets: [], effective_budget: null }),
      ),
    );
    const result = await POST(
      request(
        {
          requestedIncreaseCredits: 100,
          justification: "A sufficiently detailed business justification.",
        },
        devCookie("alice"),
      ),
    );
    expect(result.status).toBe(422);
    expect((await result.json()).error).toContain("No effective budget");
  });

  it("maps billing API failures to 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, 403)));
    const result = await POST(
      request(
        {
          requestedIncreaseCredits: 100,
          justification: "A sufficiently detailed business justification.",
        },
        devCookie("alice"),
      ),
    );
    expect(result.status).toBe(502);
  });
});

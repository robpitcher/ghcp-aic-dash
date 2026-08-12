import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/budget/me/route";
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
};

function requestWith(query: string, cookie?: string): NextRequest {
  return new NextRequest(`https://dash.test/api/budget/me${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

function devCookie(login: string): string {
  const token = createIdentitySession({ login, id: 1, role: "developer" });
  return `identity_session=${token}`;
}

function adminCookie(login: string): string {
  const token = createIdentitySession({ login, id: 2, role: "admin" });
  return `identity_session=${token}`;
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

describe("GET /api/budget/me", () => {
  const original = { ...process.env };

  beforeEach(() => {
    Object.assign(process.env, ENV);
    checkEnterpriseMembership.mockReset();
    checkEnterpriseMembership.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...original };
  });

  it("ignores a crafted user and returns only the signed-in user's budget", async () => {
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = input.toString();
        fetchedUrls.push(url);
        return response({
          budgets: [
            {
              id: "winner",
              budget_scope: "user",
              budget_amount: 30,
              secret: "must-not-leak",
            },
            { id: "other", budget_scope: "enterprise", budget_amount: 9000 },
          ],
          effective_budget: {
            id: "winner",
            budget_amount: 30,
            consumed_amount: 4.25,
          },
          total_count: 2,
        });
      }),
    );

    const result = await GET(
      requestWith("?user=bob", devCookie("Alice")),
    );
    const body = await result.json();

    expect(result.status).toBe(200);
    expect(body).toEqual({
      scopedLogin: "alice",
      hasBudget: true,
      source: "individual",
      amountUsd: 30,
      amountCredits: 3000,
      consumedUsd: 4.25,
      consumedCredits: 425,
      remainingUsd: 25.75,
      remainingCredits: 2575,
      percentUsed: 14.2,
    });
    expect(JSON.stringify(body)).not.toContain("winner");
    expect(JSON.stringify(body)).not.toContain("9000");
    expect(fetchedUrls).toHaveLength(1);
    expect(fetchedUrls[0]).toContain("user=alice");
    expect(fetchedUrls[0]).not.toContain("user=bob");
  });

  it("keeps elevated sessions self-scoped on the /me endpoint", async () => {
    const fetchedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        fetchedUrls.push(input.toString());
        return response({ budgets: [], effective_budget: null });
      }),
    );

    const result = await GET(
      requestWith("?user=bob", adminCookie("AdminAlice")),
    );

    expect(result.status).toBe(200);
    expect((await result.json()).scopedLogin).toBe("adminalice");
    expect(fetchedUrls[0]).toContain("user=adminalice");
    expect(fetchedUrls[0]).not.toContain("user=bob");
  });

  it("returns explicit no-budget output for malformed upstream JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({ unexpected: true })));
    const result = await GET(requestWith("", devCookie("alice")));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      scopedLogin: "alice",
      hasBudget: false,
      source: null,
      amountUsd: null,
    });
  });

  it("returns 400 before authentication when billing is not configured", async () => {
    delete process.env.GITHUB_BILLING_TOKEN;
    vi.stubGlobal("fetch", vi.fn());
    const result = await GET(requestWith(""));
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns 401 without an identity session", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const result = await GET(requestWith(""));
    expect(result.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 500])(
    "maps upstream %s failures to 502",
    async (status) => {
      vi.stubGlobal("fetch", vi.fn(async () => response({}, status)));
      const result = await GET(requestWith("", devCookie("alice")));
      expect(result.status).toBe(502);
      expect((await result.json()).error).toContain(`(${status} `);
    },
  );
});

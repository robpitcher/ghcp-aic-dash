import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/usage/me/route";
import { createIdentitySession } from "@/lib/auth";
import { MembershipCheckError } from "@/lib/github";

/**
 * End-to-end proof of the forced self-scope security property: a developer who
 * crafts `?user=<someone-else>` still only ever reads their OWN usage, because
 * the route forces the billing scope to the session login before any data is
 * fetched. We stub the network so every upstream call is observable.
 *
 * The enterprise membership check is mocked at the module boundary (rather
 * than stubbing its GraphQL network call) so these tests stay focused on the
 * forced-scope property; membership-check behavior itself is covered by
 * enterprise.test.ts.
 */

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

let fetchedUrls: string[] = [];

function stubFetchEchoingUser() {
  fetchedUrls = [];
  const mock = vi.fn(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    fetchedUrls.push(url);
    const user = new URL(url).searchParams.get("user");
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        usageItems: [
          {
            model: "gpt-test",
            user, // echo whoever the server actually queried
            grossQuantity: 10,
            discountQuantity: 6,
            netQuantity: 4,
            grossAmount: 1,
            discountAmount: 0.6,
            netAmount: 0.4,
            date: "2026-06-10",
          },
        ],
      }),
      text: async () => "",
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function requestWith(query: string, cookie?: string): NextRequest {
  return new NextRequest(`https://dash.test/api/usage/me${query}`, {
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

describe("GET /api/usage/me — forced self-scope", () => {
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

  it("ignores a crafted ?user= and only reads the signed-in developer's data", async () => {
    stubFetchEchoingUser();

    // Alice is signed in but asks for Bob's data via the query string.
    const res = await GET(
      requestWith("?user=bob&year=2026&month=6", devCookie("alice")),
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.scopedLogin).toBe("alice");
    expect(body.forced).toBe(true);

    // EVERY upstream billing call must be scoped to alice, never bob.
    expect(fetchedUrls.length).toBeGreaterThan(0);
    for (const url of fetchedUrls) {
      expect(url).toContain("user=alice");
      expect(url).not.toContain("user=bob");
    }
  });

  it("uses the session login when no ?user= is supplied", async () => {
    stubFetchEchoingUser();
    const res = await GET(requestWith("?year=2026&month=6", devCookie("Carol")));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.scopedLogin).toBe("carol"); // lowercased
    for (const url of fetchedUrls) expect(url).toContain("user=carol");
  });

  it("keeps reserved administrator sessions self-scoped", async () => {
    stubFetchEchoingUser();

    const res = await GET(
      requestWith("?user=bob&year=2026&month=6", adminCookie("admin")),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.scopedLogin).toBe("admin");
    expect(body.forced).toBe(false);
    for (const url of fetchedUrls) {
      expect(url).toContain("user=admin");
      expect(url).not.toContain("user=bob");
    }
  });

  it("returns 401 when there is no identity session", async () => {
    stubFetchEchoingUser();
    const res = await GET(requestWith("?year=2026&month=6"));
    expect(res.status).toBe(401);
    expect(fetchedUrls).toHaveLength(0); // never touches billing
  });

  it("returns 404 when identity mode is not configured", async () => {
    delete process.env.GITHUB_APP_CLIENT_ID;
    stubFetchEchoingUser();
    const res = await GET(requestWith("?year=2026&month=6", devCookie("alice")));
    expect(res.status).toBe(404);
    expect(fetchedUrls).toHaveLength(0);
  });

  it("returns 400 (not configured) when billing env is missing", async () => {
    delete process.env.GITHUB_BILLING_TOKEN;
    stubFetchEchoingUser();
    const res = await GET(requestWith("?year=2026&month=6", devCookie("alice")));
    expect(res.status).toBe(400);
    expect(fetchedUrls).toHaveLength(0);
  });

  it("rejects an out-of-range year via zod validation", async () => {
    stubFetchEchoingUser();
    const res = await GET(
      requestWith("?year=1999&month=6", devCookie("alice")),
    );
    expect(res.status).toBe(422);
    expect(fetchedUrls).toHaveLength(0);
  });

  it("returns 403 when the developer is not an enterprise member", async () => {
    checkEnterpriseMembership.mockResolvedValue(false);
    stubFetchEchoingUser();
    const res = await GET(requestWith("?year=2026&month=6", devCookie("eve")));
    expect(res.status).toBe(403);
    expect(fetchedUrls).toHaveLength(0); // never reaches billing
  });

  it("fails closed (503) when the membership lookup itself errors", async () => {
    checkEnterpriseMembership.mockRejectedValue(
      new MembershipCheckError("GitHub GraphQL is unavailable"),
    );
    stubFetchEchoingUser();
    const res = await GET(requestWith("?year=2026&month=6", devCookie("alice")));
    expect(res.status).toBe(503);
    expect(fetchedUrls).toHaveLength(0);
  });

  it("bypasses the membership check when REQUIRE_ENTERPRISE_MEMBERSHIP=false", async () => {
    process.env.REQUIRE_ENTERPRISE_MEMBERSHIP = "false";
    checkEnterpriseMembership.mockRejectedValue(
      new MembershipCheckError("should never be called"),
    );
    stubFetchEchoingUser();
    const res = await GET(requestWith("?year=2026&month=6", devCookie("alice")));
    expect(res.status).toBe(200);
    expect(checkEnterpriseMembership).not.toHaveBeenCalled();
  });
});

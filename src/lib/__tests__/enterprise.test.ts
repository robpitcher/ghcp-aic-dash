import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  isEnterpriseMember,
  checkEnterpriseMembership,
  __resetMembershipCache,
  MembershipCheckError,
} from "@/lib/github/enterprise";

/**
 * The single most important property of this module: `enterprise.members(query:)`
 * is a FUZZY/substring search on GitHub's side, so a query for "bob" can return
 * "bobby" as a candidate. `isEnterpriseMember` must reject such impostors via an
 * exact, case-insensitive match — never trust non-emptiness of the result set.
 */

function graphQlResponse(nodes: ({ login: string } | null)[], hasNextPage = false, endCursor: string | null = null) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({
      data: {
        enterprise: {
          members: {
            pageInfo: { hasNextPage, endCursor },
            nodes,
          },
        },
      },
    }),
    text: async () => "",
  } as unknown as Response;
}

const OPTS = { token: "billing-pat", enterpriseSlug: "acme" };

describe("isEnterpriseMember — exact-match safety", () => {
  it("rejects a fuzzy substring match that is not the exact login", async () => {
    // GitHub's fuzzy query for "bob" returns "bobby" as a candidate.
    const fetchImpl = vi.fn(async () => graphQlResponse([{ login: "bobby" }]));
    const result = await isEnterpriseMember("bob", { ...OPTS, fetchImpl });
    expect(result).toBe(false);
  });

  it("accepts an exact case-insensitive match", async () => {
    const fetchImpl = vi.fn(async () => graphQlResponse([{ login: "Bob" }]));
    const result = await isEnterpriseMember("bob", { ...OPTS, fetchImpl });
    expect(result).toBe(true);
  });

  it("accepts a match found alongside unrelated fuzzy candidates", async () => {
    const fetchImpl = vi.fn(async () =>
      graphQlResponse([{ login: "bobby" }, { login: "bob" }, { login: "bob2" }]),
    );
    const result = await isEnterpriseMember("bob", { ...OPTS, fetchImpl });
    expect(result).toBe(true);
  });

  it("handles both EnterpriseUserAccount (EMU) and User union variants identically", async () => {
    // Both inline fragments resolve to the same `{ login }` shape at runtime;
    // the client doesn't need to distinguish them.
    const fetchImpl = vi.fn(async () => graphQlResponse([{ login: "alice" }]));
    expect(await isEnterpriseMember("alice", { ...OPTS, fetchImpl })).toBe(true);
  });

  it("walks to a later page to find the member", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(graphQlResponse([{ login: "zzz" }], true, "cursor-1"))
      .mockResolvedValueOnce(graphQlResponse([{ login: "carol" }], false, null));
    const result = await isEnterpriseMember("carol", { ...OPTS, fetchImpl });
    expect(result).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("stops after the page cap and returns false rather than looping forever", async () => {
    const fetchImpl = vi.fn(async () =>
      graphQlResponse([{ login: "nobody" }], true, "cursor-next"),
    );
    const result = await isEnterpriseMember("carol", { ...OPTS, fetchImpl });
    expect(result).toBe(false);
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("returns false for an empty login", async () => {
    const fetchImpl = vi.fn();
    expect(await isEnterpriseMember("", { ...OPTS, fetchImpl })).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("isEnterpriseMember — fail closed on errors", () => {
  it("throws MembershipCheckError on network failure", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    await expect(
      isEnterpriseMember("alice", { ...OPTS, fetchImpl }),
    ).rejects.toBeInstanceOf(MembershipCheckError);
  });

  it("throws MembershipCheckError on a non-OK HTTP response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Bad credentials",
      json: async () => ({}),
    })) as unknown as typeof fetch;
    await expect(
      isEnterpriseMember("alice", { ...OPTS, fetchImpl }),
    ).rejects.toBeInstanceOf(MembershipCheckError);
  });

  it("throws MembershipCheckError on GraphQL errors payload", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
      json: async () => ({ errors: [{ message: "Could not resolve to an Enterprise" }] }),
    })) as unknown as typeof fetch;
    await expect(
      isEnterpriseMember("alice", { ...OPTS, fetchImpl }),
    ).rejects.toBeInstanceOf(MembershipCheckError);
  });

  it("throws MembershipCheckError when the response has no enterprise data", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
      json: async () => ({ data: { enterprise: null } }),
    })) as unknown as typeof fetch;
    await expect(
      isEnterpriseMember("alice", { ...OPTS, fetchImpl }),
    ).rejects.toBeInstanceOf(MembershipCheckError);
  });
});

describe("checkEnterpriseMembership — caching", () => {
  beforeEach(() => {
    __resetMembershipCache();
  });

  it("caches a positive result and doesn't re-fetch within the TTL", async () => {
    const fetchImpl = vi.fn(async () => graphQlResponse([{ login: "alice" }]));
    expect(await checkEnterpriseMembership("alice", { ...OPTS, fetchImpl })).toBe(true);
    expect(await checkEnterpriseMembership("alice", { ...OPTS, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("caches a negative result and doesn't re-fetch within the TTL", async () => {
    const fetchImpl = vi.fn(async () => graphQlResponse([]));
    expect(await checkEnterpriseMembership("eve", { ...OPTS, fetchImpl })).toBe(false);
    expect(await checkEnterpriseMembership("eve", { ...OPTS, fetchImpl })).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("is case-insensitive on the cache key", async () => {
    const fetchImpl = vi.fn(async () => graphQlResponse([{ login: "carol" }]));
    expect(await checkEnterpriseMembership("Carol", { ...OPTS, fetchImpl })).toBe(true);
    expect(await checkEnterpriseMembership("carol", { ...OPTS, fetchImpl })).toBe(true);
    expect(await checkEnterpriseMembership("CAROL", { ...OPTS, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never caches an error — the next call retries the lookup", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient outage"))
      .mockResolvedValueOnce(graphQlResponse([{ login: "dave" }]));

    await expect(
      checkEnterpriseMembership("dave", { ...OPTS, fetchImpl }),
    ).rejects.toBeInstanceOf(MembershipCheckError);

    // The failed lookup must not have been cached — this call retries and succeeds.
    expect(await checkEnterpriseMembership("dave", { ...OPTS, fetchImpl })).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("re-fetches after the TTL expires", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => graphQlResponse([{ login: "alice" }]));
      expect(await checkEnterpriseMembership("alice", { ...OPTS, fetchImpl })).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(6 * 60 * 1000); // past the 5-minute TTL

      expect(await checkEnterpriseMembership("alice", { ...OPTS, fetchImpl })).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

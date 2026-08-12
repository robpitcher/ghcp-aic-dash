import { describe, it, expect, vi } from "vitest";
import {
  EnterpriseBillingClient,
  normalizeItem,
} from "@/lib/github/client";
import { BillingApiError } from "@/lib/github/types";

function okResponse(usageItems: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ usageItems }),
    text: async () => "",
  } as unknown as Response;
}

function errResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    json: async () => ({}),
    text: async () => "error body",
  } as unknown as Response;
}

function budgetResponse(
  body: unknown,
  link: string | null = null,
): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: (name: string) => name.toLowerCase() === "link" ? link : null },
    json: async () => body,
    text: async () => "",
  } as unknown as Response;
}

const noSleep = () => Promise.resolve();

describe("normalizeItem", () => {
  it("applies defaults and lowercases the user", () => {
    const n = normalizeItem(
      { sku: "sku-9", grossQuantity: 3, user: "Alice" },
      "fallback",
    );
    expect(n.product).toBe("Copilot");
    expect(n.model).toBe("sku-9"); // model falls back to sku
    expect(n.userLogin).toBe("alice");
    expect(n.unitType).toBe("ai-credits");
  });

  it("uses the fallback user when the item has none", () => {
    const n = normalizeItem({ grossQuantity: 1 }, "Bob");
    expect(n.userLogin).toBe("bob");
  });
});

describe("getUserMonthlyUsage", () => {
  it("calls the live endpoint with the forced user and normalizes results", async () => {
    const fetchImpl = vi.fn(async () =>
      okResponse([{ model: "gpt-x", grossQuantity: 5, netAmount: 2 }]),
    );
    const client = new EnterpriseBillingClient({
      token: "secret-token",
      enterpriseSlug: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    const items = await client.getUserMonthlyUsage({
      user: "alice",
      year: 2026,
      month: 6,
    });

    expect(items).toHaveLength(1);
    expect(items[0].model).toBe("gpt-x");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("/enterprises/acme/settings/billing/ai_credit/usage");
    expect(url).toContain("year=2026");
    expect(url).toContain("month=6");
    expect(url).toContain("user=alice");
    // Privileged token travels only in the Authorization header.
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret-token");
  });

  it("retries transient 5xx then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errResponse(503))
      .mockResolvedValueOnce(okResponse([{ grossQuantity: 1 }]));
    const client = new EnterpriseBillingClient({
      token: "t",
      enterpriseSlug: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    const items = await client.getUserMonthlyUsage({
      user: "alice",
      year: 2026,
      month: 6,
    });
    expect(items).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 404 and surfaces a non-retryable scope error", async () => {
    const fetchImpl = vi.fn(async () => errResponse(404));
    const client = new EnterpriseBillingClient({
      token: "t",
      enterpriseSlug: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    await expect(
      client.getUserMonthlyUsage({ user: "alice", year: 2026, month: 6 }),
    ).rejects.toMatchObject({ name: "BillingApiError", retryable: false, status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats 401 and 403 as non-retryable", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = vi.fn(async () => errResponse(status));
      const client = new EnterpriseBillingClient({
        token: "t",
        enterpriseSlug: "acme",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: noSleep,
      });
      const err = await client
        .getUserMonthlyUsage({ user: "alice", year: 2026, month: 6 })
        .catch((e) => e);
      expect(err).toBeInstanceOf(BillingApiError);
      expect(err.retryable).toBe(false);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after exhausting retries on persistent 5xx", async () => {
    const fetchImpl = vi.fn(async () => errResponse(500));
    const client = new EnterpriseBillingClient({
      token: "t",
      enterpriseSlug: "acme",
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    await expect(
      client.getUserMonthlyUsage({ user: "alice", year: 2026, month: 6 }),
    ).rejects.toBeInstanceOf(BillingApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

describe("getUserUsageForMonths", () => {
  it("fetches one request per month keyed by year-month", async () => {
    const fetchImpl = vi.fn(async () => okResponse([{ grossQuantity: 1 }]));
    const client = new EnterpriseBillingClient({
      token: "t",
      enterpriseSlug: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    const map = await client.getUserUsageForMonths({
      user: "alice",
      months: [
        { year: 2026, month: 5 },
        { year: 2026, month: 6 },
      ],
    });
    expect(map.get("2026-5")).toHaveLength(1);
    expect(map.get("2026-6")).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("getUserBudgets", () => {
  it("follows pagination and retains the effective budget", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        budgetResponse(
          {
            budgets: [{ id: "first", budget_scope: "user" }],
            effective_budget: {
              id: "second",
              budget_amount: 10,
              consumed_amount: 1,
            },
          },
          '<https://api.github.com/budgets?page=2>; rel="next"',
        ),
      )
      .mockResolvedValueOnce(
        budgetResponse({
          budgets: [{ id: "second", budget_scope: "multi_user_customer" }],
          effective_budget: {
            id: "second",
            budget_amount: 10,
            consumed_amount: 1,
          },
        }),
      );
    const client = new EnterpriseBillingClient({
      token: "t",
      enterpriseSlug: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    const result = await client.getUserBudgets("alice");

    expect(result.budgets).toHaveLength(2);
    expect(result.effective_budget).toMatchObject({ id: "second" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const [url] of fetchImpl.mock.calls) {
      expect(url).toContain("user=alice");
      expect(url).toContain("per_page=100");
    }
    expect(fetchImpl.mock.calls[1][0]).toContain("page=2");
  });

  it.each([401, 403, 404])(
    "fails fast with a non-retryable error for %s",
    async (status) => {
      const fetchImpl = vi.fn(async () => errResponse(status));
      const client = new EnterpriseBillingClient({
        token: "t",
        enterpriseSlug: "acme",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleepImpl: noSleep,
      });
      await expect(client.getUserBudgets("alice")).rejects.toMatchObject({
        status,
        retryable: false,
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("retries 5xx and surfaces a retryable error", async () => {
    const fetchImpl = vi.fn(async () => errResponse(500));
    const client = new EnterpriseBillingClient({
      token: "t",
      enterpriseSlug: "acme",
      maxRetries: 2,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });
    await expect(client.getUserBudgets("alice")).rejects.toMatchObject({
      status: 500,
      retryable: true,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("treats invalid JSON as an empty defensive payload", async () => {
    const fetchImpl = vi.fn(async () => {
      const res = budgetResponse({});
      res.json = async () => {
        throw new SyntaxError("truncated JSON");
      };
      return res;
    });
    const client = new EnterpriseBillingClient({
      token: "t",
      enterpriseSlug: "acme",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl: noSleep,
    });

    await expect(client.getUserBudgets("alice")).resolves.toEqual({
      budgets: [],
    });
  });
});

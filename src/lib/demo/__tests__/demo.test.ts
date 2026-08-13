import { afterEach, describe, expect, it } from "vitest";
import { isDemoMode } from "@/lib/config";
import { getDemoBudget, getDemoUsageProvider } from "@/lib/demo";

describe("demo data", () => {
  it("provides a representative current period and trend without network access", async () => {
    const provider = getDemoUsageProvider();
    const monthly = await provider.getMonthlyUsage({
      login: "ignored-client-login",
      year: 2026,
      month: 8,
    });

    const trend = await provider.getTrend({
      login: "ignored-client-login",
      months: [
        { year: 2026, month: 7 },
        { year: 2026, month: 8 },
      ],
    });

    expect(monthly.period).toEqual({ year: 2026, month: 8 });
    expect(monthly.totals.grossCredits).toBeGreaterThan(0);
    expect(monthly.perModel).toHaveLength(3);
    expect(trend).toHaveLength(2);
    expect(trend[0].grossCredits).not.toBe(trend[1].grossCredits);
    expect(trend[0].grossAmount).not.toBe(trend[1].grossAmount);
    expect(monthly.perModel.map(({ model }) => model)).toEqual([
      "Gemini 3.6 Flash",
      "Claude Opus 4.7",
      "GPT-5.5",
    ]);
  });

  it("returns a self-scoped synthetic budget", () => {
    expect(getDemoBudget()).toMatchObject({
      scopedLogin: "demo-user",
      hasBudget: true,
      amountCredits: 5000,
    });
  });

  describe("demo mode configuration", () => {
    const original = { ...process.env };

    afterEach(() => {
      process.env = { ...original };
    });

    it("activates only when explicitly enabled outside production", () => {
      process.env = { NODE_ENV: "development", DEMO_ENV: " true " };

      expect(isDemoMode()).toBe(true);
    });

    it("stays disabled in production when explicitly enabled", () => {
      process.env = { NODE_ENV: "production", DEMO_ENV: "true" };

      expect(isDemoMode()).toBe(false);
    });
  });
});

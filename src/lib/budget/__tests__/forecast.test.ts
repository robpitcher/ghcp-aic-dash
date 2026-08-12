import { describe, expect, it } from "vitest";
import {
  calculateBudgetForecast,
  isCurrentUtcPeriod,
} from "@/lib/budget/forecast";
import type { EffectiveBudget } from "@/lib/budget";

const budget: EffectiveBudget = {
  scopedLogin: "octocat",
  hasBudget: true,
  source: "individual",
  amountUsd: 20,
  amountCredits: 2000,
  consumedUsd: 10,
  consumedCredits: 1000,
  remainingUsd: 10,
  remainingCredits: 1000,
  percentUsed: 50,
};

describe("calculateBudgetForecast", () => {
  it("uses one elapsed day on the first day and never divides by zero", () => {
    const result = calculateBudgetForecast(
      { ...budget, consumedCredits: 10, consumedUsd: 0.1 },
      new Date("2026-08-01T00:00:00Z"),
    );

    expect(result).toMatchObject({
      elapsedDays: 1,
      totalDays: 31,
      averageCreditsPerDay: 10,
      projectedCreditsAtMonthEnd: 310,
      projectedRemainingCreditsAtMonthEnd: 1690,
    });
  });

  it("handles zero usage without invalid values or an exhaustion date", () => {
    const result = calculateBudgetForecast(
      { ...budget, consumedCredits: 0, consumedUsd: 0 },
      new Date("2026-08-15T12:00:00Z"),
    );

    expect(result?.averageCreditsPerDay).toBe(0);
    expect(result?.projectedCreditsAtMonthEnd).toBe(0);
    expect(result?.estimatedExhaustionDate).toBeNull();
    expect(Object.values(result ?? {}).some((value) => value === Infinity)).toBe(
      false,
    );
  });

  it("marks an already-exhausted budget on the supplied UTC date", () => {
    const result = calculateBudgetForecast(
      { ...budget, remainingCredits: 0, percentUsed: 100 },
      new Date("2026-08-15T23:00:00-04:00"),
    );

    expect(result?.alreadyExhausted).toBe(true);
    expect(result?.estimatedExhaustionDate).toBe("2026-08-16");
  });

  it("returns null when there is no applied budget", () => {
    expect(
      calculateBudgetForecast(
        {
          scopedLogin: "octocat",
          hasBudget: false,
          source: null,
          amountUsd: null,
          amountCredits: null,
          consumedUsd: null,
          consumedCredits: null,
          remainingUsd: null,
          remainingCredits: null,
          percentUsed: null,
        },
        new Date("2026-08-15T00:00:00Z"),
      ),
    ).toBeNull();
  });

  it("returns no exhaustion date when the run rate stays within the month", () => {
    const result = calculateBudgetForecast(
      budget,
      new Date("2026-08-20T00:00:00Z"),
    );

    expect(result?.estimatedExhaustionDate).toBeNull();
  });

  it("estimates a UTC exhaustion date when pace crosses the budget this month", () => {
    const result = calculateBudgetForecast(
      { ...budget, amountCredits: 1500, remainingCredits: 500 },
      new Date("2026-08-10T00:00:00Z"),
    );

    expect(result?.estimatedExhaustionDate).toBe("2026-08-15");
  });
});

describe("isCurrentUtcPeriod", () => {
  it("matches only the supplied date's UTC month", () => {
    const now = new Date("2026-08-01T00:30:00Z");
    expect(isCurrentUtcPeriod(2026, 8, now)).toBe(true);
    expect(isCurrentUtcPeriod(2026, 7, now)).toBe(false);
  });
});

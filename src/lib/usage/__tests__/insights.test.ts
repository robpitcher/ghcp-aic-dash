import { describe, expect, it } from "vitest";
import { buildModelInsights } from "@/lib/usage/insights";
import type { ModelBreakdown, UsageTotals } from "@/lib/usage";

const totals: UsageTotals = {
  grossCredits: 100,
  includedCredits: 20,
  billableCredits: 80,
  grossAmount: 20,
  discountAmount: 4,
  netAmount: 16,
  discountCoveragePct: 20,
  effectivePricePerCredit: 0.2,
};

function model(
  name: string,
  grossQuantity: number,
  grossAmount: number,
  netAmount: number,
): ModelBreakdown {
  return {
    model: name,
    grossQuantity,
    discountQuantity: 0,
    netQuantity: grossQuantity,
    grossAmount,
    discountAmount: 0,
    netAmount,
  };
}

describe("buildModelInsights", () => {
  it("computes credit, effective cost, gross spend, and net spend shares", () => {
    const result = buildModelInsights(
      [model("alpha", 25, 10, 8), model("beta", 75, 10, 8)],
      totals,
    );

    expect(result.models[1]).toMatchObject({
      model: "alpha",
      percentageOfTotalCredits: 25,
      effectiveGrossUsdPerCredit: 0.4,
      percentageOfGrossSpend: 50,
      percentageOfNetSpend: 50,
    });
    expect(result.largestCreditConsumer?.model).toBe("beta");
    expect(result.largestSpendDriver?.model).toBe("alpha");
    expect(result.highestEffectiveCostPerCredit?.model).toBe("alpha");
  });

  it("breaks every ranking tie by model name ascending", () => {
    const result = buildModelInsights(
      [model("zeta", 50, 10, 8), model("alpha", 50, 10, 8)],
      totals,
    );

    expect(result.models.map((entry) => entry.model)).toEqual(["alpha", "zeta"]);
    expect(result.largestCreditConsumer?.model).toBe("alpha");
    expect(result.largestSpendDriver?.model).toBe("alpha");
    expect(result.highestEffectiveCostPerCredit?.model).toBe("alpha");
  });

  it("returns null rankings and safe percentages for empty or zero data", () => {
    const empty = buildModelInsights([], { ...totals, grossCredits: 0 });
    expect(empty).toEqual({
      models: [],
      largestCreditConsumer: null,
      largestSpendDriver: null,
      highestEffectiveCostPerCredit: null,
    });

    const zero = buildModelInsights(
      [model("alpha", 0, 0, 0)],
      {
        ...totals,
        grossCredits: 0,
        grossAmount: 0,
        netAmount: 0,
      },
    );
    expect(zero.models[0]).toMatchObject({
      percentageOfTotalCredits: 0,
      effectiveGrossUsdPerCredit: 0,
      percentageOfGrossSpend: 0,
      percentageOfNetSpend: 0,
    });
  });
});

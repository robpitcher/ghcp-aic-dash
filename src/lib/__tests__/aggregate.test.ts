import { describe, it, expect } from "vitest";
import {
  aggregateMonthly,
  buildPerModel,
  buildTrendPoint,
  deriveTotals,
  sumItems,
} from "@/lib/usage/aggregate";
import { shiftMonth, trailingMonths } from "@/lib/usage/months";
import type { NormalizedAiCreditItem } from "@/lib/github/types";

function item(
  over: Partial<NormalizedAiCreditItem> = {},
): NormalizedAiCreditItem {
  return {
    usageDate: "2026-06-10",
    product: "Copilot",
    sku: "sku-x",
    model: "gpt-test",
    costCenter: null,
    orgName: null,
    userLogin: "alice",
    teamName: null,
    unitType: "ai-credits",
    pricePerUnit: 0,
    grossQuantity: 0,
    discountQuantity: 0,
    netQuantity: 0,
    grossAmount: 0,
    discountAmount: 0,
    netAmount: 0,
    ...over,
  };
}

describe("sumItems / deriveTotals", () => {
  it("derives included = discount and billable = net", () => {
    const items = [
      item({
        grossQuantity: 100,
        discountQuantity: 70,
        netQuantity: 30,
        grossAmount: 10,
        discountAmount: 7,
        netAmount: 3,
      }),
      item({
        grossQuantity: 50,
        discountQuantity: 50,
        netQuantity: 0,
        grossAmount: 5,
        discountAmount: 5,
        netAmount: 0,
      }),
    ];
    const totals = deriveTotals(sumItems(items));
    expect(totals.grossCredits).toBe(150);
    expect(totals.includedCredits).toBe(120); // sum of discountQuantity
    expect(totals.billableCredits).toBe(30); // sum of netQuantity
    expect(totals.grossAmount).toBe(15);
    expect(totals.discountAmount).toBe(12);
    expect(totals.netAmount).toBe(3);
    // 120 / 150 = 80%
    expect(totals.discountCoveragePct).toBe(80);
    // grossAmount / grossCredits = 15 / 150 = 0.1
    expect(totals.effectivePricePerCredit).toBe(0.1);
  });

  it("handles an empty month with zeroed, safe metrics", () => {
    const totals = deriveTotals(sumItems([]));
    expect(totals.grossCredits).toBe(0);
    expect(totals.discountCoveragePct).toBe(0);
    expect(totals.effectivePricePerCredit).toBe(0);
  });
});

describe("buildPerModel", () => {
  it("buckets by model and sorts by gross credits desc", () => {
    const items = [
      item({ model: "a", grossQuantity: 10, netQuantity: 4 }),
      item({ model: "b", grossQuantity: 30, netQuantity: 9 }),
      item({ model: "a", grossQuantity: 5, netQuantity: 1 }),
    ];
    const perModel = buildPerModel(items);
    expect(perModel.map((m) => m.model)).toEqual(["b", "a"]);
    expect(perModel[1].grossQuantity).toBe(15); // a: 10 + 5
    expect(perModel[1].netQuantity).toBe(5); // a: 4 + 1
  });

  it("falls back to sku then 'unknown' for the model key", () => {
    const perModel = buildPerModel([
      item({ model: "", sku: "sku-1", grossQuantity: 1 }),
      item({ model: "", sku: "", grossQuantity: 2 }),
    ]);
    const keys = perModel.map((m) => m.model).sort();
    expect(keys).toEqual(["sku-1", "unknown"]);
  });
});

describe("aggregateMonthly", () => {
  it("returns period, totals and perModel together", () => {
    const usage = aggregateMonthly(2026, 6, [
      item({ model: "m1", grossQuantity: 8, netQuantity: 2, netAmount: 1 }),
    ]);
    expect(usage.period).toEqual({ year: 2026, month: 6 });
    expect(usage.totals.grossCredits).toBe(8);
    expect(usage.perModel).toHaveLength(1);
    expect(usage.perModel[0].model).toBe("m1");
  });
});

describe("buildTrendPoint", () => {
  it("labels by year-month and sums actual credit consumption", () => {
    const point = buildTrendPoint(2026, 5, [
      item({ grossQuantity: 4, netQuantity: 1, netAmount: 2 }),
      item({ grossQuantity: 6, netQuantity: 3, netAmount: 4 }),
    ]);
    expect(point.label).toBe("2026-5");
    expect(point.grossCredits).toBe(10);
    expect(point.billableCredits).toBe(4);
    expect(point.netAmount).toBe(6);
  });
});

describe("month helpers", () => {
  it("shiftMonth rolls across year boundaries", () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });

  it("trailingMonths returns count months ending at the selected month", () => {
    const months = trailingMonths(2026, 3, 6);
    expect(months).toHaveLength(6);
    expect(months[0]).toEqual({ year: 2025, month: 10 });
    expect(months[5]).toEqual({ year: 2026, month: 3 });
  });
});

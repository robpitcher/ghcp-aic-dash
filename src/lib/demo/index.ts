import { aggregateMonthly, buildTrendPoint } from "@/lib/usage/aggregate";
import type { MonthlyUsage, TrendPoint, UsageProvider } from "@/lib/usage/types";
import { DEMO_LOGIN, demoBudget, demoUsageItems } from "./data";

const DEMO_MODEL_ROTATION = [
  "Claude Sonnet 4.6",
  "GPT-5.4",
  "Gemini 3.6 Flash",
  "Claude Opus 4.7",
  "GPT-5.5",
  "Grok 4.5",
] as const;

const MONTH_VARIATIONS = [
  { multiplier: 0.72, modelOffset: 0 },
  { multiplier: 1.18, modelOffset: 1 },
  { multiplier: 0.91, modelOffset: 2 },
  { multiplier: 1.34, modelOffset: 3 },
  { multiplier: 0.83, modelOffset: 4 },
  { multiplier: 1.07, modelOffset: 5 },
] as const;

function itemsForMonth(year: number, month: number) {
  const variation =
    MONTH_VARIATIONS[Math.abs(year * 12 + month) % MONTH_VARIATIONS.length];

  return demoUsageItems.map((item) => ({
    ...item,
    model:
      DEMO_MODEL_ROTATION[
        (demoUsageItems.indexOf(item) + variation.modelOffset) %
          DEMO_MODEL_ROTATION.length
      ],
    usageDate: `${year}-${String(month).padStart(2, "0")}-${item.usageDate?.slice(-2) ?? "01"}`,
    grossQuantity: Math.round(item.grossQuantity * variation.multiplier),
    discountQuantity: Math.round(item.discountQuantity * variation.multiplier),
    netQuantity: Math.round(item.netQuantity * variation.multiplier),
    grossAmount: Math.round(item.grossAmount * variation.multiplier * 100) / 100,
    discountAmount:
      Math.round(item.discountAmount * variation.multiplier * 100) / 100,
    netAmount: Math.round(item.netAmount * variation.multiplier * 100) / 100,
  }));
}

export class DemoUsageProvider implements UsageProvider {
  async getMonthlyUsage(params: {
    login: string;
    year: number;
    month: number;
  }): Promise<MonthlyUsage> {
    return aggregateMonthly(
      params.year,
      params.month,
      itemsForMonth(params.year, params.month),
    );
  }

  async getTrend(params: {
    login: string;
    months: { year: number; month: number }[];
  }): Promise<TrendPoint[]> {
    return params.months.map(({ year, month }) =>
      buildTrendPoint(year, month, itemsForMonth(year, month)),
    );
  }
}

export function getDemoUsageProvider(): UsageProvider {
  return new DemoUsageProvider();
}

export function getDemoBudget() {
  return { ...demoBudget, scopedLogin: DEMO_LOGIN };
}

export { DEMO_LOGIN, demoBudget, demoUsageItems };

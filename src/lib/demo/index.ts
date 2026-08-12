import { aggregateMonthly, buildTrendPoint } from "@/lib/usage/aggregate";
import type { MonthlyUsage, TrendPoint, UsageProvider } from "@/lib/usage/types";
import { DEMO_LOGIN, demoBudget, demoUsageItems } from "./data";

function itemsForMonth(year: number, month: number) {
  return demoUsageItems.map((item) => ({
    ...item,
    usageDate: `${year}-${String(month).padStart(2, "0")}-${item.usageDate?.slice(-2) ?? "01"}`,
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

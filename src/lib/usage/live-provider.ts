import {
  EnterpriseBillingClient,
  monthKey,
  type MonthPoint,
} from "@/lib/github";
import { aggregateMonthly, buildTrendPoint } from "./aggregate";
import type { MonthlyUsage, TrendPoint, UsageProvider } from "./types";

/**
 * Live usage provider — reads from the GitHub enterprise per-user AI credit
 * endpoint on demand (no database). It is the MVP data source.
 *
 * Security: every method takes the developer's `login` directly and passes it
 * straight to the billing client as the forced `user=` value. The provider has
 * no notion of a client-supplied user, so it cannot be tricked into widening
 * scope — the forcing happens upstream in `resolveUserScope`, and the login that
 * reaches here is already authoritative.
 */
export class LiveUsageProvider implements UsageProvider {
  private readonly client: EnterpriseBillingClient;

  constructor(client: EnterpriseBillingClient) {
    this.client = client;
  }

  async getMonthlyUsage(params: {
    login: string;
    year: number;
    month: number;
  }): Promise<MonthlyUsage> {
    const items = await this.client.getUserMonthlyUsage({
      user: params.login,
      year: params.year,
      month: params.month,
    });
    return aggregateMonthly(params.year, params.month, items);
  }

  async getTrend(params: {
    login: string;
    months: MonthPoint[];
  }): Promise<TrendPoint[]> {
    const byMonth = await this.client.getUserUsageForMonths({
      user: params.login,
      months: params.months,
    });
    return params.months.map(({ year, month }) =>
      buildTrendPoint(year, month, byMonth.get(monthKey(year, month)) ?? []),
    );
  }
}

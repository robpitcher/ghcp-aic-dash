import type { MonthPoint } from "@/lib/github/types";

/** Raw additive bucket of credit quantities and USD amounts. */
export interface CreditBucket {
  grossQuantity: number;
  discountQuantity: number;
  netQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

/** Headline metrics for a single month. */
export interface UsageTotals {
  /** Total credits consumed before entitlement coverage. */
  grossCredits: number;
  /** Credits covered by the included entitlement (the discount quantity). */
  includedCredits: number;
  /** Credits actually billed (the net quantity). */
  billableCredits: number;
  grossAmount: number;
  discountAmount: number;
  /** Net spend in USD. */
  netAmount: number;
  /** Share of gross credits covered by the entitlement, 0–100. */
  discountCoveragePct: number;
  /** Average gross USD per gross credit. */
  effectivePricePerCredit: number;
}

/** Per-model aggregated bucket. */
export type ModelBreakdown = CreditBucket & { model: string };

/** Aggregated usage for one month, scoped to a single developer. */
export interface MonthlyUsage {
  period: { year: number; month: number };
  totals: UsageTotals;
  perModel: ModelBreakdown[];
}

/** One point on the trailing-month trend. */
export interface TrendPoint {
  year: number;
  month: number;
  /** `${year}-${month}` label. */
  label: string;
  grossCredits: number;
  billableCredits: number;
  grossAmount: number;
  netAmount: number;
}

/** Response payload of `GET /api/usage/me`. */
export interface UsageResponse {
  /** The login the data is scoped to (always the signed-in developer). */
  scopedLogin: string;
  /** True when scope was forced to the developer's own login. */
  forced: boolean;
  period: { year: number; month: number };
  totals: UsageTotals;
  perModel: ModelBreakdown[];
  trend: TrendPoint[];
}

/**
 * Pluggable usage data source.
 *
 * The MVP ships `LiveUsageProvider` (calls the live per-user billing endpoint).
 * The interface is intentionally narrow so a DB-backed `IngestedUsageProvider`
 * (for the future ingestion pipeline and manager role) can be dropped in with no
 * changes to the API route or dashboard.
 *
 * Implementations MUST treat `login` as authoritative and never widen scope.
 */
export interface UsageProvider {
  /** Aggregated usage for one developer for one month. */
  getMonthlyUsage(params: {
    login: string;
    year: number;
    month: number;
  }): Promise<MonthlyUsage>;

  /** Trailing-month trend points for one developer. */
  getTrend(params: {
    login: string;
    months: MonthPoint[];
  }): Promise<TrendPoint[]>;
}

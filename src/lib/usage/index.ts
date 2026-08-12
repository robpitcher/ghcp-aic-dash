import { EnterpriseBillingClient } from "@/lib/github";
import { getBillingConfig, isDemoMode } from "@/lib/config";
import { getDemoUsageProvider } from "@/lib/demo";
import { LiveUsageProvider } from "./live-provider";
import type { UsageProvider } from "./types";

/**
 * Select the active usage provider.
 *
 * MVP always returns the live, on-demand provider. This factory is the single
 * seam where a future DB-backed `IngestedUsageProvider` (for the ingestion
 * pipeline and manager role) would be chosen — e.g. switched on an env flag —
 * without any change to the API route or dashboard.
 */
export function getUsageProvider(): UsageProvider {
  if (isDemoMode()) return getDemoUsageProvider();
  const billing = getBillingConfig();
  const client = new EnterpriseBillingClient({
    token: billing.token,
    enterpriseSlug: billing.slug,
  });
  return new LiveUsageProvider(client);
}

export { LiveUsageProvider } from "./live-provider";
export { shiftMonth, trailingMonths } from "./months";
export { buildModelInsights } from "./insights";
export {
  aggregateMonthly,
  buildPerModel,
  buildTrendPoint,
  deriveTotals,
  sumItems,
  emptyBucket,
  addToBucket,
  round2,
} from "./aggregate";
export type {
  CreditBucket,
  ModelBreakdown,
  MonthlyUsage,
  TrendPoint,
  UsageProvider,
  UsageResponse,
  UsageTotals,
} from "./types";
export type {
  ModelCostInsight,
  ModelInsightRankings,
} from "./insights";

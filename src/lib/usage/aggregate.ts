import type { NormalizedAiCreditItem } from "@/lib/github/types";
import type {
  CreditBucket,
  ModelBreakdown,
  MonthlyUsage,
  TrendPoint,
  UsageTotals,
} from "./types";

/** A fresh zeroed bucket. */
export function emptyBucket(): CreditBucket {
  return {
    grossQuantity: 0,
    discountQuantity: 0,
    netQuantity: 0,
    grossAmount: 0,
    discountAmount: 0,
    netAmount: 0,
  };
}

/** Add a normalized item's quantities and amounts into a bucket (in place). */
export function addToBucket(
  bucket: CreditBucket,
  item: NormalizedAiCreditItem,
): void {
  bucket.grossQuantity += item.grossQuantity;
  bucket.discountQuantity += item.discountQuantity;
  bucket.netQuantity += item.netQuantity;
  bucket.grossAmount += item.grossAmount;
  bucket.discountAmount += item.discountAmount;
  bucket.netAmount += item.netAmount;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function roundBucket(bucket: CreditBucket): CreditBucket {
  return {
    grossQuantity: round2(bucket.grossQuantity),
    discountQuantity: round2(bucket.discountQuantity),
    netQuantity: round2(bucket.netQuantity),
    grossAmount: round2(bucket.grossAmount),
    discountAmount: round2(bucket.discountAmount),
    netAmount: round2(bucket.netAmount),
  };
}

/** Sum a list of normalized items into a single bucket. */
export function sumItems(items: NormalizedAiCreditItem[]): CreditBucket {
  const bucket = emptyBucket();
  for (const item of items) addToBucket(bucket, item);
  return bucket;
}

/** Derive headline totals from a summed bucket. */
export function deriveTotals(bucket: CreditBucket): UsageTotals {
  // GitHub's discount quantity represents entitlement-covered credits; net
  // quantity and amount are the billable values.
  const grossCredits = bucket.grossQuantity;
  const includedCredits = bucket.discountQuantity; // covered by entitlement
  const billableCredits = bucket.netQuantity;
  const discountCoveragePct =
    grossCredits > 0 ? Math.round((includedCredits / grossCredits) * 100) : 0;
  const effectivePricePerCredit =
    grossCredits > 0 ? round2(bucket.grossAmount / grossCredits) : 0;

  return {
    grossCredits: round2(grossCredits),
    includedCredits: round2(includedCredits),
    billableCredits: round2(billableCredits),
    grossAmount: round2(bucket.grossAmount),
    discountAmount: round2(bucket.discountAmount),
    netAmount: round2(bucket.netAmount),
    discountCoveragePct,
    effectivePricePerCredit,
  };
}

/** Bucket items by model, sorted by gross credits descending. */
export function buildPerModel(
  items: NormalizedAiCreditItem[],
): ModelBreakdown[] {
  // Aggregate before rounding so repeated line-item rounding cannot skew totals.
  const map = new Map<string, CreditBucket>();
  for (const item of items) {
    const key = item.model || item.sku || "unknown";
    const bucket = map.get(key) ?? emptyBucket();
    addToBucket(bucket, item);
    map.set(key, bucket);
  }
  return Array.from(map.entries())
    .map(([model, bucket]) => ({ model, ...roundBucket(bucket) }))
    .sort((a, b) => b.grossQuantity - a.grossQuantity);
}

/** Aggregate one month's normalized items into the MonthlyUsage shape. */
export function aggregateMonthly(
  year: number,
  month: number,
  items: NormalizedAiCreditItem[],
): MonthlyUsage {
  return {
    period: { year, month },
    totals: deriveTotals(sumItems(items)),
    perModel: buildPerModel(items),
  };
}

/** Build a single trend point from one month's normalized items. */
export function buildTrendPoint(
  year: number,
  month: number,
  items: NormalizedAiCreditItem[],
): TrendPoint {
  const bucket = sumItems(items);
  return {
    year,
    month,
    label: `${year}-${month}`,
    grossCredits: round2(bucket.grossQuantity),
    billableCredits: round2(bucket.netQuantity),
    grossAmount: round2(bucket.grossAmount),
    netAmount: round2(bucket.netAmount),
  };
}

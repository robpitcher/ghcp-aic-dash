/**
 * Types for the GitHub enterprise AI credit billing API and the normalized
 * shape the rest of the app consumes.
 */

/** Raw item as returned by the live per-user `ai_credit/usage` endpoint. */
export interface RawAiCreditUsageItem {
  product?: string;
  sku?: string;
  model?: string;
  unitType?: string;
  unitTypeString?: string;
  pricePerUnit?: number;
  grossQuantity?: number;
  grossAmount?: number;
  discountQuantity?: number;
  discountAmount?: number;
  netQuantity?: number;
  netAmount?: number;
  date?: string;
  organizationName?: string;
  user?: string;
  team?: string;
  costCenterName?: string;
  costCenter?: string;
}

/** Raw envelope of the live per-user usage endpoint. */
export interface RawAiCreditUsageResponse {
  usageItems?: RawAiCreditUsageItem[];
}

/**
 * Normalized line item. `userLogin` is lowercased for consistent, case-
 * insensitive scoping; `product` defaults to "Copilot" and `model` falls back
 * to the SKU when absent.
 */
export interface NormalizedAiCreditItem {
  usageDate: string | null;
  product: string;
  sku: string;
  model: string;
  costCenter: string | null;
  orgName: string | null;
  userLogin: string | null;
  teamName: string | null;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  discountQuantity: number;
  netQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

/** A year/month pair (month is 1-based). */
export interface MonthPoint {
  year: number;
  month: number;
}

/**
 * Error raised by the billing client. `retryable` distinguishes transient
 * failures (5xx/network) from permanent ones (401/403/404 — usually a missing
 * token scope or role) so callers can surface an actionable message.
 */
export class BillingApiError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = "BillingApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

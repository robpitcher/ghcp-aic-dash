import {
  BillingApiError,
  type MonthPoint,
  type NormalizedAiCreditItem,
  type RawAiCreditUsageItem,
  type RawAiCreditUsageResponse,
} from "./types";
import type {
  RawGitHubBudget,
  RawGitHubBudgetsResponse,
} from "@/lib/budget";

/**
 * GitHub enterprise AI credit billing client.
 *
 * MVP uses the LIVE per-user endpoint:
 *   GET /enterprises/{enterprise}/settings/billing/ai_credit/usage
 *       ?year={year}&month={month}&user={login}
 *
 * This endpoint was a diagnostic fallback in the reference implementation and
 * may be undocumented/less stable than the async report-export path, so it is
 * deliberately isolated here behind a small client and (one level up) behind the
 * UsageProvider interface — it can be swapped for an ingestion provider with no
 * UI changes.
 *
 * The privileged billing token requires the classic-PAT scope
 * `manage_billing:copilot` (read) plus `read:enterprise`. GitHub frequently
 * masks a missing scope/role as a 404 for billing resources, so 401/403/404 are
 * treated as permanent, actionable errors rather than retried.
 */

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const MAX_BUDGET_PAGES = 20;

export interface BillingClientOptions {
  /** Privileged enterprise billing token (server-side only). */
  token: string;
  /** Enterprise slug. */
  enterpriseSlug: string;
  /** Max retry attempts for transient (5xx/network) failures. Default 3. */
  maxRetries?: number;
  /** Base backoff delay in ms (exponential). Default 500. */
  baseDelayMs?: number;
  /** Injectable fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep (tests). Defaults to real setTimeout. */
  sleepImpl?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": API_VERSION,
  };
}

function toNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Normalize a raw usage item into the shared snapshot shape. */
export function normalizeItem(
  item: RawAiCreditUsageItem,
  fallbackUser: string,
): NormalizedAiCreditItem {
  return {
    usageDate: item.date ?? null,
    product: item.product ?? "Copilot",
    sku: item.sku ?? "",
    model: item.model ?? item.sku ?? "",
    costCenter: item.costCenterName ?? item.costCenter ?? null,
    orgName: item.organizationName ?? null,
    userLogin: item.user ? item.user.toLowerCase() : fallbackUser.toLowerCase(),
    teamName: item.team ?? null,
    unitType: item.unitTypeString ?? item.unitType ?? "ai-credits",
    pricePerUnit: toNumber(item.pricePerUnit),
    grossQuantity: toNumber(item.grossQuantity),
    discountQuantity: toNumber(item.discountQuantity),
    netQuantity: toNumber(item.netQuantity),
    grossAmount: toNumber(item.grossAmount),
    discountAmount: toNumber(item.discountAmount),
    netAmount: toNumber(item.netAmount),
  };
}

export class EnterpriseBillingClient {
  private readonly token: string;
  private readonly slug: string;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(opts: BillingClientOptions) {
    this.token = opts.token;
    this.slug = opts.enterpriseSlug;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleepImpl = opts.sleepImpl ?? defaultSleep;
  }

  private usageUrl(year: number, month: number, user: string): string {
    return (
      `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(this.slug)}` +
      `/settings/billing/ai_credit/usage` +
      `?year=${year}&month=${month}&user=${encodeURIComponent(user)}`
    );
  }

  private budgetsUrl(user: string, page: number): string {
    return (
      `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(this.slug)}` +
      `/settings/billing/budgets` +
      `?user=${encodeURIComponent(user)}&per_page=100&page=${page}`
    );
  }

  /**
   * Fetch and normalize a single user's AI credit usage for one month. Retries
   * transient 5xx/network errors with exponential backoff; 401/403/404 fail fast
   * with an actionable message about the required token scope.
   */
  async getUserMonthlyUsage(params: {
    user: string;
    year: number;
    month: number;
  }): Promise<NormalizedAiCreditItem[]> {
    const { user, year, month } = params;
    const url = this.usageUrl(year, month, user);

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers: headers(this.token) });
      } catch (err) {
        // Network-level failure — transient, retry with backoff.
        lastError = err;
        if (attempt < this.maxRetries) {
          await this.sleepImpl(this.backoff(attempt));
          continue;
        }

        throw new BillingApiError(
          `Network error calling AI credit usage endpoint: ${
            err instanceof Error ? err.message : String(err)
          }`,
          null,
          true,
        );
      }

      if (res.ok) {
        const data = (await res.json()) as RawAiCreditUsageResponse;
        return (data.usageItems ?? []).map((item) => normalizeItem(item, user));
      }

      // Permanent, actionable failures: missing scope/role is commonly masked
      // as a 404 by GitHub's billing endpoints.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        const body = await res.text().catch(() => "");
        throw new BillingApiError(
          `AI credit usage request failed (${res.status} ${res.statusText}). ` +
            `The billing token needs the classic PAT scopes 'manage_billing:copilot' (read) and ` +
            `'read:enterprise', and the caller must be an enterprise owner, billing manager, or hold ` +
            `the Copilot-usage-metrics role. GitHub often returns 404 when the scope or permission is ` +
            `missing. Details: ${body.slice(0, 500)}`,
          res.status,
          false,
        );
      }

      // 5xx (and anything else) — transient, retry with backoff.
      lastError = new BillingApiError(
        `AI credit usage request failed (${res.status} ${res.statusText}).`,
        res.status,
        true,
      );
      if (attempt < this.maxRetries) {
        await this.sleepImpl(this.backoff(attempt));
        continue;
      }
      throw lastError;
    }

    // Exhausted retries on transient errors.
    if (lastError instanceof BillingApiError) throw lastError;
    throw new BillingApiError(
      "AI credit usage request failed after retries.",
      null,
      true,
    );
  }

  /**
   * Fetch all budget pages applicable to one explicitly supplied login. The
   * caller owns authentication scope; the public route always supplies the
   * forced session login. Pagination is capped to bound upstream work.
   */
  async getUserBudgets(user: string): Promise<RawGitHubBudgetsResponse> {
    const budgets: RawGitHubBudget[] = [];
    let effectiveBudget: unknown;

    for (let page = 1; page <= MAX_BUDGET_PAGES; page++) {
      const url = this.budgetsUrl(user, page);
      let lastError: BillingApiError | undefined;
      let response: Response | undefined;

      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          response = await this.fetchImpl(url, {
            headers: headers(this.token),
          });
        } catch (err) {
          if (attempt < this.maxRetries) {
            await this.sleepImpl(this.backoff(attempt));
            continue;
          }
          throw new BillingApiError(
            `Network error calling budgets endpoint: ${
              err instanceof Error ? err.message : String(err)
            }`,
            null,
            true,
          );
        }

        if (response.ok) break;

        if (
          response.status === 401 ||
          response.status === 403 ||
          response.status === 404
        ) {
          const body = await response.text().catch(() => "");
          throw new BillingApiError(
            `Budget request failed (${response.status} ${response.statusText}). ` +
              `The billing token needs the classic PAT scopes 'manage_billing:copilot' (read) and ` +
              `'read:enterprise', and the caller must be an enterprise owner or billing manager. ` +
              `GitHub often returns 404 when the scope, permission, or feature is missing. ` +
              `Details: ${body.slice(0, 500)}`,
            response.status,
            false,
          );
        }

        lastError = new BillingApiError(
          `Budget request failed (${response.status} ${response.statusText}).`,
          response.status,
          true,
        );
        if (attempt < this.maxRetries) {
          await this.sleepImpl(this.backoff(attempt));
          continue;
        }
        throw lastError;
      }

      if (!response?.ok) {
        throw (
          lastError ??
          new BillingApiError(
            "Budget request failed after retries.",
            null,
            true,
          )
        );
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        // Preserve already collected pages but do not guess at malformed JSON.
        return { budgets };
      }
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return { budgets };
      }

      const data = raw as RawGitHubBudgetsResponse;
      if (Array.isArray(data.budgets)) {
        budgets.push(
          ...data.budgets.filter(
            (budget): budget is RawGitHubBudget =>
              typeof budget === "object" &&
              budget !== null &&
              !Array.isArray(budget),
          ),
        );
      }
      if (data.effective_budget !== undefined) {
        effectiveBudget = data.effective_budget;
      }

      const link = response.headers?.get("link");
      // Prefer RFC Link pagination; the response flag is a compatibility
      // fallback for endpoint variants that omit the header.
      const linkHasNext = link
        ?.split(",")
        .some((part) => /rel="next"/.test(part));
      const hasNext =
        linkHasNext === true || (link == null && data.has_next_page === true);
      if (!hasNext) {
        return { budgets, effective_budget: effectiveBudget };
      }
    }

    return { budgets, effective_budget: effectiveBudget };
  }

  /**
   * Fetch usage for several months (one request per month — no DB needed for the
   * trailing trend). Returns a map keyed by `${year}-${month}`.
   */
  async getUserUsageForMonths(params: {
    user: string;
    months: MonthPoint[];
  }): Promise<Map<string, NormalizedAiCreditItem[]>> {
    const { user, months } = params;
    const result = new Map<string, NormalizedAiCreditItem[]>();
    // Sequential to stay gentle on the billing API rate limits.
    for (const { year, month } of months) {
      const items = await this.getUserMonthlyUsage({ user, year, month });
      result.set(monthKey(year, month), items);
    }
    return result;
  }

  private backoff(attempt: number): number {
    // Exponential with a little jitter to avoid thundering-herd retries.
    const base = this.baseDelayMs * Math.pow(2, attempt);
    return base + Math.floor(Math.random() * this.baseDelayMs);
  }
}

/** Stable map key for a year/month pair. */
export function monthKey(year: number, month: number): string {
  return `${year}-${month}`;
}

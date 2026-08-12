import { z } from "zod";

/**
 * Centralized, validated runtime configuration.
 *
 * Two independent concerns are kept apart by design:
 *   - IDENTITY (who is signing in): a GitHub App web flow + the HMAC session
 *     secret.
 *   - DATA ACCESS (whose usage we can read): the privileged enterprise billing
 *     token. This token is server-only and never reaches the browser. It is
 *     also reused (read-only, via GraphQL) to verify enterprise membership.
 *
 * Identity mode and billing config are validated separately so the app can boot
 * and render a clear "not configured" state instead of crashing when only part
 * of the environment is wired up (useful in local dev and first deploys).
 */

const trimmed = z.string().trim().min(1);
const repositoryPart = /^[A-Za-z0-9._-]+$/;

/** Demo mode is intentionally opt-in and never activates in production. */
export function isDemoMode(): boolean {
  return (
    process.env.NODE_ENV !== "production" &&
    [process.env.DEMO_ENV, process.env.demo_env].some(
      (value) => value?.trim().toLowerCase() === "true",
    )
  );
}

/** Billing scope. `enterprise` is the MVP target; `org` is reserved. */
export const BillingScope = z.enum(["enterprise", "org"]);
export type BillingScope = z.infer<typeof BillingScope>;

/* ── Identity (GitHub App web flow + signed session) ── */

const identitySchema = z.object({
  GITHUB_APP_CLIENT_ID: trimmed,
  GITHUB_APP_CLIENT_SECRET: trimmed,
  SESSION_SECRET: trimmed,
});

export interface IdentityConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
}

/**
 * True only when every identity variable is present. When false, the app
 * renders an actionable "not configured" state rather than attempting the
 * GitHub App web flow.
 */
export function isIdentityConfigured(): boolean {
  return isDemoMode() || identitySchema.safeParse(process.env).success;
}

/** Load identity config, throwing a clear aggregated error when incomplete. */
export function getIdentityConfig(): IdentityConfig {
  const parsed = identitySchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError("identity (GitHub App)", parsed.error);
  }
  return {
    clientId: parsed.data.GITHUB_APP_CLIENT_ID,
    clientSecret: parsed.data.GITHUB_APP_CLIENT_SECRET,
    sessionSecret: parsed.data.SESSION_SECRET,
  };
}

/* ── Billing (privileged, server-side only) ── */

const billingSchema = z.object({
  GITHUB_BILLING_TOKEN: trimmed,
  GITHUB_ENTERPRISE_SLUG: trimmed,
  GITHUB_BILLING_SCOPE: BillingScope.default("enterprise"),
});

export interface BillingConfig {
  /** Privileged enterprise billing token. NEVER expose to the client. */
  token: string;
  /** Enterprise (or, reserved, org) slug used to build billing URLs. */
  slug: string;
  scope: BillingScope;
}

/** True only when the privileged billing token and slug are present. */
export function isBillingConfigured(): boolean {
  if (isDemoMode()) return true;
  const parsed = billingSchema.safeParse(process.env);
  return parsed.success && parsed.data.GITHUB_BILLING_SCOPE !== "org";
}

/** Load billing config, throwing a clear aggregated error when incomplete. */
export function getBillingConfig(): BillingConfig {
  const parsed = billingSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError("billing (enterprise token)", parsed.error);
  }
  // `org` scope is reserved for a later iteration; fail fast so a misconfigured
  // deployment surfaces the limitation instead of silently building org URLs.
  if (parsed.data.GITHUB_BILLING_SCOPE === "org") {
    throw new Error(
      "GITHUB_BILLING_SCOPE=org is reserved for a future release; the MVP only supports 'enterprise'.",
    );
  }
  return {
    token: parsed.data.GITHUB_BILLING_TOKEN,
    slug: parsed.data.GITHUB_ENTERPRISE_SLUG,
    scope: parsed.data.GITHUB_BILLING_SCOPE,
  };
}

/* ── Budget request IssueOps ── */

const budgetRequestSchema = z.object({
  BUDGET_REQUEST_REPOSITORY: trimmed.refine((value) => {
    const parts = value.split("/");
    return (
      parts.length === 2 &&
      parts.every(
        (part) =>
          part.length > 0 &&
          part.length <= 100 &&
          repositoryPart.test(part),
      )
    );
  }, "must use the OWNER/REPO format"),
});

export interface BudgetRequestConfig {
  repository: string;
}

/** True only when the optional IssueOps destination is a valid OWNER/REPO. */
export function isBudgetRequestConfigured(): boolean {
  return budgetRequestSchema.safeParse(process.env).success;
}

/** Load the validated IssueOps destination repository. */
export function getBudgetRequestConfig(): BudgetRequestConfig {
  const parsed = budgetRequestSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new ConfigError("budget request IssueOps", parsed.error);
  }
  return { repository: parsed.data.BUDGET_REQUEST_REPOSITORY };
}

/* ── App ── */

/**
 * Public origin used to build OAuth redirect URIs. Prefer the explicit
 * `APP_BASE_URL` (correct behind a proxy / on Container Apps) and fall back to
 * the request's own origin for local dev. Any trailing slash is trimmed.
 */
export function getAppBaseUrl(fallbackOrigin: string): string {
  const configured = process.env.APP_BASE_URL?.trim();
  const base = configured && configured.length > 0 ? configured : fallbackOrigin;
  return base.replace(/\/+$/, "");
}

/** Optional comma-separated allowlist of admin logins (future roles). */
export function getAdminLogins(): string[] {
  return (process.env.ADMIN_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Whether sign-in requires the developer to be a verified member of the
 * configured GitHub Enterprise. Defaults to `true` (secure by default). Set
 * `REQUIRE_ENTERPRISE_MEMBERSHIP=false` only for local dev/testing without an
 * enterprise-scoped billing token — never in production.
 */
export function isMembershipCheckEnabled(): boolean {
  const raw = process.env.REQUIRE_ENTERPRISE_MEMBERSHIP?.trim().toLowerCase();
  return raw !== "false" && raw !== "0";
}

/**
 * True when both identity and billing are configured — i.e. the dashboard can
 * actually serve scoped usage. Used by data routes to return a 400
 * "not configured" rather than a confusing 500.
 */
export function isFullyConfigured(): boolean {
  return isDemoMode() || (isIdentityConfigured() && isBillingConfigured());
}

/* ── Error helper ── */

/** Thrown when required environment variables are missing or malformed. */
export class ConfigError extends Error {
  constructor(area: string, zodError: z.ZodError) {
    const missing = zodError.issues
      .map((i) => i.path.join(".") || "(root)")
      .join(", ");
    super(
      `Missing or invalid ${area} configuration. Check these environment variables: ${missing}. ` +
        `See .env.example for the full list.`,
    );
    this.name = "ConfigError";
  }
}

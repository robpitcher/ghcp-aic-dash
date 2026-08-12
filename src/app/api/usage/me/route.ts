import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEnterpriseMember, resolveUserScope } from "@/lib/auth";
import { isBillingConfigured, isDemoMode } from "@/lib/config";
import { getUsageProvider, trailingMonths } from "@/lib/usage";
import { BillingApiError } from "@/lib/github";

export const dynamic = "force-dynamic";

/** Trailing window (in months) used for the net-spend trend line. */
const TREND_MONTHS = 6;

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

/**
 * Self-scoped AI credit usage for the signed-in developer.
 *
 * Security invariants:
 *   1. A valid identity session AND verified enterprise membership are
 *      required (else 401/403/503/404 — see `requireEnterpriseMember`).
 *   2. The billing scope is FORCED to the session login via `resolveUserScope`;
 *      a crafted `?user=` can never read another person's data.
 *   3. The privileged billing token lives only on the server (in the provider).
 */
export async function GET(request: NextRequest) {
  // The dashboard treats 400 as the "not configured" state. Checked before the
  // membership guard so an unconfigured deployment surfaces this rather than a
  // confusing 503 from a membership check that has nothing to check against.
  if (!isDemoMode() && !isBillingConfigured()) {
    return NextResponse.json(
      {
        error:
          "Billing is not configured. Set GITHUB_BILLING_TOKEN and GITHUB_ENTERPRISE_SLUG.",
      },
      { status: 400 },
    );
  }

  // 1. Require identity + enterprise membership.
  const guard = await requireEnterpriseMember(request);
  if (!guard.ok) return guard.response;
  const { session } = guard;

  // 2. Validate the requested period.
  const sp = request.nextUrl.searchParams;
  const parsedQuery = querySchema.safeParse({
    year: sp.get("year") ?? undefined,
    month: sp.get("month") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json(
      { error: "Invalid year or month." },
      { status: 422 },
    );
  }

  const now = new Date();
  const year = parsedQuery.data.year ?? now.getUTCFullYear();
  const month = parsedQuery.data.month ?? now.getUTCMonth() + 1;

  // 3. `/me` stays self-only for every role by passing no requested user
  // through the shared scope helper.
  const scope = resolveUserScope(session, null);
  const login = scope.user ?? session.login.toLowerCase();

  try {
    const provider = getUsageProvider();
    const months = trailingMonths(year, month, TREND_MONTHS);

    const [monthly, trend] = await Promise.all([
      provider.getMonthlyUsage({ login, year, month }),
      provider.getTrend({ login, months }),
    ]);

    return NextResponse.json({
      scopedLogin: login,
      forced: scope.forced,
      period: monthly.period,
      totals: monthly.totals,
      perModel: monthly.perModel,
      trend,
    });
  } catch (err) {
    if (err instanceof BillingApiError) {
      // 502: the upstream billing API rejected the request. The message is
      // self-authored and actionable (missing scope/role) — no secrets.
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("Usage API error:", err);
    return NextResponse.json(
      { error: "Failed to load usage." },
      { status: 500 },
    );
  }
}

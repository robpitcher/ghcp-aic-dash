import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireEnterpriseMember, resolveUserScope } from "@/lib/auth";
import { resolveEffectiveBudget } from "@/lib/budget";
import { getBillingConfig, isBillingConfigured, isDemoMode } from "@/lib/config";
import { BillingApiError, EnterpriseBillingClient } from "@/lib/github";
import { getDemoBudget } from "@/lib/demo";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  user: z.string().optional(),
});

/**
 * Return only the signed-in developer's sanitized effective AI credit budget.
 * Client-supplied usernames are deliberately discarded at the forced-scope
 * choke point before the privileged billing client is called.
 */
export async function GET(request: NextRequest) {
  if (isDemoMode()) {
    return NextResponse.json(getDemoBudget());
  }

  if (!isBillingConfigured()) {
    return NextResponse.json(
      {
        error:
          "Billing is not configured. Set GITHUB_BILLING_TOKEN and GITHUB_ENTERPRISE_SLUG.",
      },
      { status: 400 },
    );
  }

  const guard = await requireEnterpriseMember(request);
  if (!guard.ok) return guard.response;
  const { session } = guard;

  const parsedQuery = querySchema.safeParse({
    user: request.nextUrl.searchParams.get("user") ?? undefined,
  });
  if (!parsedQuery.success) {
    return NextResponse.json({ error: "Invalid query." }, { status: 422 });
  }

  // `/me` is self-only for every role. Passing no requested user through the
  // shared choke point prevents elevated sessions from widening this endpoint.
  const scope = resolveUserScope(session, null);
  const login = scope.user ?? session.login.toLowerCase();

  try {
    const { token, slug } = getBillingConfig();
    const client = new EnterpriseBillingClient({
      token,
      enterpriseSlug: slug,
    });
    const raw = await client.getUserBudgets(login);
    return NextResponse.json(resolveEffectiveBudget(raw, login));
  } catch (err) {
    if (err instanceof BillingApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("Budget API error:", err);
    return NextResponse.json(
      { error: "Failed to load budget." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { requireEnterpriseMember, resolveUserScope } from "@/lib/auth";
import {
  budgetRequestInputSchema,
  buildBudgetIssuePrefill,
  resolveEffectiveBudget,
} from "@/lib/budget";
import {
  getBillingConfig,
  getBudgetRequestConfig,
  isDemoMode,
  isBillingConfigured,
  isBudgetRequestConfigured,
} from "@/lib/config";
import { BillingApiError, EnterpriseBillingClient } from "@/lib/github";

export const dynamic = "force-dynamic";

/**
 * Validate the requested increase, re-fetch the signed-in user's effective
 * budget, and return a reviewable GitHub issue URL. This endpoint never writes
 * a budget directly and never accepts a client-supplied login or current limit.
 */
export async function POST(request: NextRequest) {
  if (isDemoMode()) {
    return NextResponse.json(
      { error: "Budget requests are disabled in demo mode." },
      { status: 400 },
    );
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

  if (!isBudgetRequestConfigured()) {
    return NextResponse.json(
      {
        error:
          "Budget requests are not configured. Set BUDGET_REQUEST_REPOSITORY to a valid OWNER/REPO.",
      },
      { status: 400 },
    );
  }

  const guard = await requireEnterpriseMember(request);
  if (!guard.ok) return guard.response;

  let rawInput: unknown;
  try {
    rawInput = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 422 },
    );
  }

  const parsedInput = budgetRequestInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    // Reject extra keys so callers cannot smuggle identity or budget values.
    const unrecognized = parsedInput.error.issues.some(
      (issue) => issue.code === "unrecognized_keys",
    );
    return NextResponse.json(
      {
        error: unrecognized
          ? "Only requestedIncreaseCredits and justification may be submitted."
          : (parsedInput.error.issues[0]?.message ?? "Invalid request."),
      },
      { status: 422 },
    );
  }

  const scope = resolveUserScope(guard.session, null);
  const login = scope.user ?? guard.session.login.toLowerCase();

  try {
    // Build the request from fresh server-side billing data, not browser state.
    const billing = getBillingConfig();
    const client = new EnterpriseBillingClient({
      token: billing.token,
      enterpriseSlug: billing.slug,
    });
    const rawBudget = await client.getUserBudgets(login);
    const budget = resolveEffectiveBudget(rawBudget, login);

    if (!budget.hasBudget) {
      return NextResponse.json(
        {
          error:
            "No effective budget is available for this account, so an increase request cannot be prepared.",
        },
        { status: 422 },
      );
    }

    const result = buildBudgetIssuePrefill({
      repository: getBudgetRequestConfig().repository,
      budget,
      requestedIncreaseCredits: parsedInput.data.requestedIncreaseCredits,
      justification: parsedInput.data.justification,
      generatedAt: new Date(),
    });

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof BillingApiError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("Budget request API error:", err);
    return NextResponse.json(
      { error: "Failed to prepare the budget request." },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import {
  getIdentitySessionFromRequest,
  isIdentityModeEnabled,
} from "@/lib/auth";
import { isBillingConfigured } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * Whoami endpoint. Exposes the current identity session to the client so the UI
 * can render the signed-in developer and gate navigation. Never returns secrets
 * — only the login and role. Server-side scoping is enforced independently in
 * the data routes via `resolveUserScope`.
 */
export async function GET(request: NextRequest) {
  const identityMode = isIdentityModeEnabled();
  const session = identityMode ? getIdentitySessionFromRequest(request) : null;

  return NextResponse.json({
    identityMode,
    billingConfigured: isBillingConfigured(),
    authenticated: !!session,
    login: session?.login ?? null,
    role: session?.role ?? null,
  });
}

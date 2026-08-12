import { NextResponse } from "next/server";
import {
  getIdentitySessionFromRequest,
  isIdentityModeEnabled,
  type IdentitySession,
} from "./session";
import {
  getBillingConfig,
  isBillingConfigured,
  isDemoMode,
  isMembershipCheckEnabled,
} from "@/lib/config";
import {
  checkEnterpriseMembership,
  MembershipCheckError,
} from "@/lib/github";

/**
 * Result of an identity guard: either a valid session, or a ready-to-return
 * response (401/404) the caller should return immediately.
 */
export type GuardResult =
  | { ok: true; session: IdentitySession }
  | { ok: false; response: NextResponse };

/**
 * Require a valid identity session. Returns the session on success, or a 401
 * (identity on but no/invalid session) / 404 (identity mode disabled) response
 * to return immediately. Data routes call this before touching billing data so
 * that scoping can never be bypassed by an unauthenticated request.
 */
export function requireIdentitySession(request: Request): GuardResult {
  if (!isIdentityModeEnabled()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Identity mode is not configured." },
        { status: 404 },
      ),
    };
  }

  const session = getIdentitySessionFromRequest(request);
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authentication required." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, session };
}

/**
 * Require a valid identity session AND verified GitHub Enterprise membership.
 * Composes `requireIdentitySession` with a cached membership lookup (using the
 * privileged billing token). Fails CLOSED: if the membership lookup itself
 * errors (rate limit, expired token, GitHub outage), access is denied with a
 * 503 rather than silently let the request through — the caller can never
 * mistake a lookup failure for "not a member" or vice versa, since they return
 * distinct statuses.
 *
 * `REQUIRE_ENTERPRISE_MEMBERSHIP=false` (dev/test only) skips the membership
 * check unconditionally — access is granted to any authenticated user regardless
 * of whether billing is configured or what enterprise they belong to.
 */
export async function requireEnterpriseMember(
  request: Request,
): Promise<GuardResult> {
  const identity = requireIdentitySession(request);
  if (!identity.ok) return identity;

  if (isDemoMode()) return identity;

  if (!isMembershipCheckEnabled()) {
    return identity;
  }

  if (!isBillingConfigured()) {
    // Nothing to check membership against; let the caller's own
    // isBillingConfigured() check produce the actionable "not configured" 400.
    return identity;
  }

  const { token, slug } = getBillingConfig();

  try {
    const isMember = await checkEnterpriseMembership(identity.session.login, {
      token,
      enterpriseSlug: slug,
    });
    if (!isMember) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Not a member of this GitHub Enterprise." },
          { status: 403 },
        ),
      };
    }
    return identity;
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      console.error("Enterprise membership check failed:", err.message);
    } else {
      console.error("Enterprise membership check failed:", err);
    }
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Couldn't verify enterprise membership. Try again shortly." },
        { status: 503 },
      ),
    };
  }
}

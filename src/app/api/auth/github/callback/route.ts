import { NextRequest, NextResponse } from "next/server";
import {
  getAppBaseUrl,
  getBillingConfig,
  getIdentityConfig,
  isBillingConfigured,
  isMembershipCheckEnabled,
} from "@/lib/config";
import {
  COOKIE_NAMES,
  createIdentitySession,
  exchangeCodeForToken,
  fetchGitHubUser,
  isIdentityModeEnabled,
  resolveRole,
  safeCompare,
  sessionCookieOptions,
} from "@/lib/auth";
import { checkEnterpriseMembership, MembershipCheckError } from "@/lib/github";

export const dynamic = "force-dynamic";

const COOKIE_OAUTH_STATE = "oauth_state";

/** Clear the transient OAuth state cookie on the given response. */
function clearStateCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_OAUTH_STATE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Redirect back to /login with an explanatory `error` query param. */
function redirectToLogin(request: NextRequest, error: string): NextResponse {
  const url = new URL("/login", getAppBaseUrl(request.nextUrl.origin));
  url.searchParams.set("error", error);
  const response = NextResponse.redirect(url);
  clearStateCookie(response);
  return response;
}

/**
 * GitHub App callback. Validates the CSRF `state`, exchanges the `code` for a
 * user access token, reads the user's GitHub login + id, verifies the user is
 * a member of the configured GitHub Enterprise, resolves their role and mints
 * a signed identity session cookie. The user access token is used only to read
 * identity and is then discarded — it is never stored or returned.
 */
export async function GET(request: NextRequest) {
  if (!isIdentityModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const sp = request.nextUrl.searchParams;
    const code = sp.get("code");
    const state = sp.get("state");
    const oauthError = sp.get("error");
    const expectedState = request.cookies.get(COOKIE_OAUTH_STATE)?.value;

    // Validate the CSRF state on every callback, including error returns.
    if (!state || !expectedState || !safeCompare(state, expectedState)) {
      const response = NextResponse.json(
        { error: "Invalid OAuth state" },
        { status: 400 },
      );
      clearStateCookie(response);
      return response;
    }

    // GitHub returned an error (e.g. the user denied consent) instead of a code.
    if (oauthError) {
      const response = NextResponse.json(
        { error: "GitHub authorization was denied or cancelled" },
        { status: 401 },
      );
      clearStateCookie(response);
      return response;
    }

    if (!code) {
      const response = NextResponse.json(
        { error: "Missing authorization code" },
        { status: 400 },
      );
      clearStateCookie(response);
      return response;
    }

    const { clientId, clientSecret } = getIdentityConfig();
    const redirectUri = `${getAppBaseUrl(request.nextUrl.origin)}/api/auth/github/callback`;

    const accessToken = await exchangeCodeForToken({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });

    if (!accessToken) {
      const response = NextResponse.json(
        { error: "OAuth authorization failed" },
        { status: 401 },
      );
      clearStateCookie(response);
      return response;
    }

    // Read identity, then let the token fall out of scope (never persisted).
    const user = await fetchGitHubUser(accessToken);

    // Verify enterprise membership (fail closed on lookup errors) before
    // minting any session. Reuses the privileged billing token — no new
    // credential. Skipped only when explicitly disabled (dev/test) or when
    // there's no billing config to check membership against.
    if (isMembershipCheckEnabled() && isBillingConfigured()) {
      const { token: billingToken, slug } = getBillingConfig();
      try {
        const isMember = await checkEnterpriseMembership(user.login, {
          token: billingToken,
          enterpriseSlug: slug,
        });
        if (!isMember) {
          return redirectToLogin(request, "not_member");
        }
      } catch (err) {
        if (err instanceof MembershipCheckError) {
          console.error("Enterprise membership check failed:", err.message);
        } else {
          console.error("Enterprise membership check failed:", err);
        }
        return redirectToLogin(request, "verification_failed");
      }
    }

    const role = resolveRole(user.login);
    const token = createIdentitySession({
      login: user.login,
      id: user.id,
      role,
    });

    const response = NextResponse.redirect(
      new URL("/", getAppBaseUrl(request.nextUrl.origin)),
    );
    response.cookies.set(COOKIE_NAMES.identity, token, sessionCookieOptions());
    clearStateCookie(response);
    return response;
  } catch (err) {
    console.error("GitHub OAuth callback error:", err);
    const response = NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 },
    );
    clearStateCookie(response);
    return response;
  }
}

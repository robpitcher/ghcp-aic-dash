import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getAppBaseUrl, getIdentityConfig } from "@/lib/config";
import { buildAuthorizeUrl, isIdentityModeEnabled } from "@/lib/auth";

export const dynamic = "force-dynamic";

const COOKIE_OAUTH_STATE = "oauth_state";
const STATE_MAX_AGE_S = 600; // 10 minutes

/**
 * Begin the GitHub OAuth web flow. Redirects to GitHub's authorization screen
 * with a CSRF `state` stored in a short-lived cookie. Only available in identity
 * mode (GitHub OAuth env vars configured).
 */
export async function GET(request: NextRequest) {
  if (!isIdentityModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { clientId } = getIdentityConfig();
    const redirectUri = `${getAppBaseUrl(request.nextUrl.origin)}/api/auth/github/callback`;
    const state = randomBytes(16).toString("hex");

    const response = NextResponse.redirect(
      buildAuthorizeUrl(clientId, redirectUri, state),
    );
    response.cookies.set(COOKIE_OAUTH_STATE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: STATE_MAX_AGE_S,
    });
    return response;
  } catch (error) {
    console.error("GitHub OAuth login error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

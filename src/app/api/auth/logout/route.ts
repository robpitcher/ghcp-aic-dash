import { NextResponse } from "next/server";
import { COOKIE_NAMES, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Sign the user out by expiring the identity session cookie. Reachable without a
 * valid session; clearing a cookie that was never set is a harmless no-op.
 */
export async function POST() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(COOKIE_NAMES.identity, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

import { createHmac, timingSafeEqual } from "crypto";
import { isDemoMode, isIdentityConfigured } from "@/lib/config";
import type { Role } from "./scope";

/**
 * Stateless, HMAC-signed identity session. Ported from the proven reference
 * implementation (do NOT reinvent the crypto): a base64url JSON payload joined
 * to an HMAC-SHA256 signature, keyed by SESSION_SECRET. The session only ever
 * carries the developer's GitHub login, id and resolved role — never the OAuth
 * access token, which is discarded immediately after sign-in.
 */

const COOKIE_IDENTITY = "identity_session";
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const SIGNING_SALT = "ghcp-aic-session-v1";

export const COOKIE_NAMES = {
  identity: COOKIE_IDENTITY,
} as const;

export const DEMO_IDENTITY_SESSION: IdentitySession = {
  login: "demo-user",
  id: 0,
  role: "developer",
};

export interface IdentitySession {
  /** GitHub login (handle). */
  login: string;
  /** GitHub numeric user id. */
  id: number;
  /** Resolved role for this session. */
  role: Role;
}

/** Constant-time string comparison to prevent timing attacks. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // Compare equal-length buffers so length differences don't leak via timing.
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen, 0);
  const paddedB = Buffer.alloc(maxLen, 0);
  bufA.copy(paddedA);
  bufB.copy(paddedB);

  const equal = timingSafeEqual(paddedA, paddedB);
  return equal && bufA.length === bufB.length;
}

function getSigningKey(secret: string): Buffer {
  return createHmac("sha256", SIGNING_SALT).update(secret).digest();
}

/**
 * Identity mode is active only when all GitHub OAuth + session-signing env vars
 * are present. The OAuth and session routes 404 when it is off.
 */
export function isIdentityModeEnabled(): boolean {
  return isDemoMode() || isIdentityConfigured();
}

/**
 * Mint a signed identity session token carrying the user's login, id and role.
 * Returns "" when no signing secret is configured.
 */
export function createIdentitySession(session: IdentitySession): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return "";

  const payload = JSON.stringify({
    login: session.login,
    id: session.id,
    role: session.role,
    iat: Date.now(),
  });
  const key = getSigningKey(secret);
  const signature = createHmac("sha256", key).update(payload).digest("hex");

  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

/**
 * Verify an identity session token. Returns the decoded session when the
 * signature is valid and the token is not expired, otherwise null.
 */
export function verifyIdentitySession(token: string): IdentitySession | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token) return null;

  const dotIdx = token.indexOf(".");
  if (dotIdx < 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  if (!payloadB64 || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString();
  } catch {
    return null;
  }

  const key = getSigningKey(secret);
  const expectedSignature = createHmac("sha256", key)
    .update(payload)
    .digest("hex");

  if (!safeCompare(signature, expectedSignature)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { login, id, role, iat } = parsed as Record<string, unknown>;

  if (
    typeof login !== "string" ||
    typeof id !== "number" ||
    (role !== "admin" && role !== "manager" && role !== "developer") ||
    typeof iat !== "number"
  ) {
    return null;
  }

  if (Date.now() - iat > TOKEN_EXPIRY_MS) return null;

  return { login, id, role };
}

/** Cookie attributes for the identity session (httpOnly, lax, 24h). */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(TOKEN_EXPIRY_MS / 1000),
  };
}

function getCookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

/**
 * Extract and verify the identity session from a request's `identity_session`
 * cookie. Returns null when identity mode is disabled, no cookie is present, or
 * the token is invalid/expired. Use this in route handlers to enforce
 * server-side scoping.
 */
export function getIdentitySessionFromRequest(
  request: Request,
): IdentitySession | null {
  if (isDemoMode()) return DEMO_IDENTITY_SESSION;
  if (!isIdentityModeEnabled()) return null;
  const token = getCookieValue(request, COOKIE_IDENTITY);
  if (!token) return null;
  return verifyIdentitySession(token);
}

import { getAdminLogins } from "@/lib/config";
import type { IdentitySession } from "./session";

/**
 * Roles, in increasing privilege. Only `developer` and `admin` are produced
 * today; `manager` (view a set of subordinates) is reserved so the type and the
 * scope choke-point already account for it when that role ships.
 */
export type Role = "admin" | "manager" | "developer";

/**
 * Resolve a signed-in user's role from the `ADMIN_LOGINS` allowlist.
 * Case-insensitive; anyone not listed is a `developer`. Manager assignment is
 * not wired up yet (reserved for the future ingestion-backed provider).
 */
export function resolveRole(login: string): Role {
  const allow = getAdminLogins();
  return allow.includes(login.trim().toLowerCase()) ? "admin" : "developer";
}

/**
 * THE forced-scope security function.
 *
 * Resolve the effective per-user scope for a request. A `developer` is ALWAYS
 * forced to their own login regardless of any client-supplied `user` value, so
 * a crafted `?user=<other-login>` can never read another person's data. This is
 * the single server-side choke point that guarantees a developer only ever sees
 * their own AI credit consumption.
 *
 * Admins/managers (reserved) keep the requested value; when there is no identity
 * session the requested value passes through unchanged. The returned `user` is
 * lowercased for case-insensitive matching against GitHub logins.
 */
export function resolveUserScope(
  session: IdentitySession | null,
  requestedUser: string | null | undefined,
): { user: string | null; forced: boolean } {
  if (session && session.role === "developer") {
    return { user: session.login.toLowerCase(), forced: true };
  }
  return {
    user: requestedUser == null ? null : requestedUser.toLowerCase(),
    forced: false,
  };
}

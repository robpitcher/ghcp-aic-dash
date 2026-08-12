import { cookies } from "next/headers";
import {
  DEMO_IDENTITY_SESSION,
  COOKIE_NAMES,
  isIdentityModeEnabled,
  verifyIdentitySession,
  type IdentitySession,
} from "./session";
import { isDemoMode } from "@/lib/config";

/**
 * Read and verify the identity session from the request cookies in a Server
 * Component or Server Action. Returns null when identity mode is off or the
 * cookie is missing/invalid. Kept separate from the request-based helper so the
 * `next/headers` dependency never leaks into the shared auth barrel.
 */
export async function getServerIdentitySession(): Promise<IdentitySession | null> {
  if (isDemoMode()) return DEMO_IDENTITY_SESSION;
  if (!isIdentityModeEnabled()) return null;
  const store = await cookies();
  const token = store.get(COOKIE_NAMES.identity)?.value;
  if (!token) return null;
  return verifyIdentitySession(token);
}

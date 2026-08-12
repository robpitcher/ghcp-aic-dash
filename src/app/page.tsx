import { redirect } from "next/navigation";
import { isDemoMode, isIdentityConfigured } from "@/lib/config";
import { NotConfiguredState } from "@/components/states";

export const dynamic = "force-dynamic";

/**
 * Dashboard entry. Unauthenticated developers are redirected to /login. When
 * identity mode isn't configured at all, render an actionable not-configured
 * state instead of bouncing to a login that can't work.
 */
export default async function Home() {
  if (!isDemoMode() && !isIdentityConfigured()) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <NotConfiguredState />
      </main>
    );
  }

  redirect("/analytics");
}

import { redirect } from "next/navigation";
import {
  getBudgetRequestConfig,
  isDemoMode,
  isBudgetRequestConfigured,
  isIdentityConfigured,
} from "@/lib/config";
import { getServerIdentitySession } from "@/lib/auth/server";
import { Dashboard } from "@/components/dashboard";
import { NotConfiguredState } from "@/components/states";
import type { DashboardPage } from "@/components/dashboard-nav";

/**
 * Shared server-rendered gate for dashboard sections. Configuration and
 * identity checks happen before the client dashboard can fetch scoped data.
 */
export async function renderDashboardPage(page: DashboardPage) {
  if (!isDemoMode() && !isIdentityConfigured()) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <NotConfiguredState />
      </main>
    );
  }

  const session = await getServerIdentitySession();
  if (!session) redirect("/login");

  // Expose only the IssueOps repository name needed by the request UI.
  const budgetRequestRepository = !isDemoMode() && isBudgetRequestConfigured()
    ? getBudgetRequestConfig().repository
    : null;

  return (
    <Dashboard
      page={page}
      budgetRequestRepository={budgetRequestRepository}
      login={session.login}
      demoMode={isDemoMode()}
    />
  );
}

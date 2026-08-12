import { renderDashboardPage } from "@/app/dashboard-page";

export const dynamic = "force-dynamic";

export default async function BudgetsPage() {
  return renderDashboardPage("budgets");
}

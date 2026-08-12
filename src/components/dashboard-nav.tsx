import Link from "next/link";
import { cn } from "@/lib/cn";

export type DashboardPage = "analytics" | "budgets";

export function DashboardNav({ active }: { active: DashboardPage }) {
  return (
    <nav
      aria-label="Dashboard sections"
      className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 shadow-xs dark:border-gray-700 dark:bg-gray-800"
    >
      {(["analytics", "budgets"] as const).map((page) => (
        <Link
          key={page}
          href={`/${page}`}
          aria-current={active === page ? "page" : undefined}
          className={cn(
            "rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors",
            active === page
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700",
          )}
        >
          {page === "analytics" ? "Analytics" : "Budgets"}
        </Link>
      ))}
    </nav>
  );
}

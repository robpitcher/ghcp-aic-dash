"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isCurrentUtcPeriod,
  type EffectiveBudget,
} from "@/lib/budget";
import {
  buildModelInsights,
  type UsageResponse,
} from "@/lib/usage";
import { BudgetForecast } from "./budget-forecast";
import { BudgetCard, type BudgetCardState } from "./budget-card";
import { PageHeader } from "./page-header";
import { MonthNav } from "./month-nav";
import { ModelBarChart, TrendLineChart } from "./charts";
import { ModelTable } from "./model-table";
import { ModelInsights } from "./model-insights";
import { UsageExportButton } from "./usage-export";
import { BudgetRequest } from "./budget-request";
import { DashboardNav, type DashboardPage } from "./dashboard-nav";
import { Card, Kpi } from "./ui";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  NotConfiguredState,
} from "./states";

interface DashboardProps {
  page: DashboardPage;
  login: string;
  budgetRequestRepository: string | null;
  demoMode?: boolean;
}

/**
 * Client dashboard. Identity is implicit — no `user` param is ever sent; the
 * server forces the scope to the signed-in developer (see /api/usage/me), so
 * this view can only ever show the current user's own AI credit consumption.
 */
export function Dashboard({
  page,
  login,
  budgetRequestRepository,
  demoMode = false,
}: DashboardProps) {
  const [now, setNow] = useState(() => new Date());
  const [year, setYear] = useState(now.getUTCFullYear());
  const [month, setMonth] = useState(now.getUTCMonth() + 1);
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [budgetState, setBudgetState] = useState<BudgetCardState>({
    status: "loading",
  });
  const currentUtcYear = now.getUTCFullYear();
  const currentUtcMonth = now.getUTCMonth() + 1;

  // Advance UTC-sensitive budget and forecast state if the tab crosses midnight.
  useEffect(() => {
    const nextUtcDay = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    const timer = window.setTimeout(
      () => setNow(new Date()),
      Math.max(1, nextUtcDay - now.getTime()),
    );
    return () => window.clearTimeout(timer);
  }, [now]);

  // The applied budget is independent of the historical analytics month.
  useEffect(() => {
    let cancelled = false;

    fetch("/api/budget/me")
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (!res.ok) {
          if (!cancelled) setBudgetState({ status: "unavailable" });
          return null;
        }
        return (await res.json()) as EffectiveBudget;
      })
      .then((budget) => {
        if (cancelled || !budget) return;
        setBudgetState(
          budget.hasBudget
            ? { status: "ready", budget }
            : { status: "no-budget" },
        );
      })
      .catch(() => {
        if (!cancelled) {
          setBudgetState({ status: "unavailable" });
        }
      });

    return () => {
      cancelled = true;
    };
    // The budget follows the UTC billing cycle, not MonthNav; refresh at rollover.
  }, [currentUtcYear, currentUtcMonth]);

  // Usage is fetched only for analytics; unmount/navigation guards suppress
  // stale responses from overwriting state after the selected month changes.
  useEffect(() => {
    if (page === "budgets") {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotConfigured(false);

    const params = new URLSearchParams({
      year: String(year),
      month: String(month),
    });

    fetch(`/api/usage/me?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = "/login";
          return null;
        }
        if (res.status === 400) {
          if (!cancelled) setNotConfigured(true);
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }
        return (await res.json()) as UsageResponse;
      })
      .then((payload) => {
        if (!cancelled && payload) setData(payload);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, year, month]);

  // Memoized formatters keep chart and table callbacks stable across renders.
  const currencyFmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    [],
  );
  const numberFmt = useMemo(
    () => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }),
    [],
  );
  const fmt$ = useCallback((v: number) => currencyFmt.format(v), [currencyFmt]);
  const fmtNum = useCallback((v: number) => numberFmt.format(v), [numberFmt]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, 1))),
    [year, month],
  );

  const hasUsage =
    !!data && (data.perModel.length > 0 || data.totals.grossCredits > 0);
  const modelInsights = useMemo(
    () => (data ? buildModelInsights(data.perModel, data.totals) : null),
    [data],
  );
  const isCurrentMonth = isCurrentUtcPeriod(year, month, now);

  const onMonthChange = useCallback((y: number, m: number) => {
    setYear(y);
    setMonth(m);
  }, []);

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <PageHeader
        title="My AI Credit Usage"
        subtitle="Your personal GitHub Copilot AI credit consumption for the month."
        login={login}
      />

      <DashboardNav active={page} />

      {page === "analytics" && (
        <MonthNav
          year={year}
          month={month}
          label={monthLabel}
          onChange={onMonthChange}
        />
      )}

      {page === "budgets" ? (
        <>
          <BudgetCard state={budgetState} />
          <BudgetRequest
            budgetState={budgetState}
            repository={budgetRequestRepository}
            demoMode={demoMode}
          />
        </>
      ) : (
        <>
          {/* Current budget consumption cannot produce a valid forecast for a historical view. */}
          {isCurrentMonth && budgetState.status === "ready" && (
            <BudgetForecast budget={budgetState.budget} now={now} />
          )}
        </>
      )}

      {page === "analytics" && loading && (
        <LoadingState message="Loading your usage…" />
      )}

      {page === "analytics" && !loading && notConfigured && (
        <NotConfiguredState />
      )}

      {page === "analytics" && !loading && !notConfigured && error && (
        <ErrorState message={error} />
      )}

      {page === "analytics" && !loading && !notConfigured && !error && data && (
        <>
          {/* Keep empty periods distinct from loading and upstream error states. */}
          {hasUsage ? (
            <>
              <section aria-labelledby="actual-consumption-heading">
                <h2
                  id="actual-consumption-heading"
                  className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100"
                >
                  Actual AI credit consumption
                </h2>
                <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <Kpi
                    label="Gross credits"
                    value={fmtNum(data.totals.grossCredits)}
                  />
                  <Kpi
                    label="Included credits"
                    value={fmtNum(data.totals.includedCredits)}
                    subtitle={`${data.totals.discountCoveragePct}% covered`}
                    tone="growth"
                  />
                  <Kpi
                    label="Billable credits"
                    value={fmtNum(data.totals.billableCredits)}
                    tone={
                      data.totals.billableCredits > 0 ? "brand" : "default"
                    }
                  />
                  <Kpi
                    label="Net spend"
                    value={fmt$(data.totals.netAmount)}
                    tone={data.totals.netAmount > 0 ? "brand" : "default"}
                  />
                </section>
              </section>

              <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <Card
                  title="Credits by model"
                  subtitle="Gross AI credits consumed per model this month."
                >
                  {data.perModel.length > 0 ? (
                    <ModelBarChart
                      data={data.perModel}
                      numberFormatter={fmtNum}
                    />
                  ) : (
                    <p className="py-8 text-center text-sm text-gray-400">
                      No model data.
                    </p>
                  )}
                </Card>
                <Card
                  title="AI credit consumption trend"
                  subtitle="Trailing 6 months of actual AI credits consumed."
                >
                  {data.trend.length > 0 ? (
                    <TrendLineChart
                      data={data.trend}
                      numberFormatter={fmtNum}
                    />
                  ) : (
                    <p className="py-8 text-center text-sm text-gray-400">
                      No trend data.
                    </p>
                  )}
                </Card>
              </section>

              <Card
                title="Per-model breakdown"
                subtitle="Sortable detail of credits, effective cost, and spend share by model."
                headerAction={<UsageExportButton usage={data} />}
              >
                {modelInsights && (
                  <ModelTable
                    data={modelInsights.models}
                    numberFormatter={fmtNum}
                    currencyFormatter={fmt$}
                  />
                )}
              </Card>
              {modelInsights && (
                <ModelInsights
                  insights={modelInsights}
                  numberFormatter={fmtNum}
                  currencyFormatter={fmt$}
                />
              )}
            </>
          ) : (
            <EmptyState />
          )}
        </>
      )}
    </main>
  );
}

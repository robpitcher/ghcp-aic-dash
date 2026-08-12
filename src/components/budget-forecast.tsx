"use client";

import type { AvailableEffectiveBudget } from "@/lib/budget";
import { calculateBudgetForecast } from "@/lib/budget";
import { Kpi } from "./ui";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function BudgetForecast({
  budget,
  now,
}: {
  budget: AvailableEffectiveBudget;
  now: Date;
}) {
  const forecast = calculateBudgetForecast(budget, now);
  // Insufficient or non-current billing data intentionally produces no forecast.
  if (!forecast) return null;

  const numberFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  });
  const currencyFormatter = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const exhaustionLabel = forecast.estimatedExhaustionDate
    ? forecast.alreadyExhausted
      ? "Already exhausted"
      // Parse the date at UTC midnight so locale formatting cannot shift the day.
      : dateFormatter.format(
          new Date(`${forecast.estimatedExhaustionDate}T00:00:00Z`),
        )
    : "Not this month";
  const projectedUseExceedsBudget =
    forecast.projectedCreditsAtMonthEnd > budget.amountCredits;

  return (
    <section aria-labelledby="budget-forecast-heading" className="space-y-4">
      <details className="rounded-lg border border-blue-100 bg-blue-50/50 p-4 dark:border-blue-900/40 dark:bg-blue-950/20">
        <summary className="cursor-pointer text-sm font-semibold text-gray-900 dark:text-gray-100">
          <span
            id="budget-forecast-heading"
            className="ml-2 inline-block"
            role="heading"
            aria-level={2}
          >
            Forecast budget pace
          </span>
          <span className="mt-1 ml-6 block text-xs font-normal text-gray-500 dark:text-gray-400">
            Current UTC billing month; forecasts use average consumption over{" "}
            {forecast.elapsedDays} elapsed{" "}
            {forecast.elapsedDays === 1 ? "day" : "days"}.
          </span>
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Forecast daily pace"
            value={numberFormatter.format(forecast.averageCreditsPerDay)}
            subtitle={`${currencyFormatter.format(forecast.averageUsdPerDay)} per day`}
          />
          <Kpi
            label="Forecast month-end use"
            value={numberFormatter.format(forecast.projectedCreditsAtMonthEnd)}
            subtitle={currencyFormatter.format(forecast.projectedUsdAtMonthEnd)}
            tone={projectedUseExceedsBudget ? "attention" : "brand"}
          />
          <Kpi
            label="Forecast month-end remaining"
            value={numberFormatter.format(
              forecast.projectedRemainingCreditsAtMonthEnd,
            )}
            subtitle="AI credits"
          />
          <Kpi
            label="Forecast exhaustion"
            value={exhaustionLabel}
            subtitle={
              forecast.estimatedExhaustionDate
                ? "At the current average pace"
                : "Current pace stays within budget"
            }
            tone={forecast.estimatedExhaustionDate ? "attention" : "growth"}
          />
        </div>
      </details>
    </section>
  );
}

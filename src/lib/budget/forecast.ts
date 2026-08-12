import type { EffectiveBudget } from "./types";

export interface BudgetForecast {
  elapsedDays: number;
  totalDays: number;
  averageCreditsPerDay: number;
  averageUsdPerDay: number;
  projectedCreditsAtMonthEnd: number;
  projectedUsdAtMonthEnd: number;
  projectedRemainingCreditsAtMonthEnd: number;
  estimatedExhaustionDate: string | null;
  alreadyExhausted: boolean;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function safeNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function isCurrentUtcPeriod(
  year: number,
  month: number,
  now: Date,
): boolean {
  return year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
}

/**
 * Projects the current UTC billing month from the budget API's authoritative
 * consumption values. The caller supplies `now` to keep the calculation pure.
 */
export function calculateBudgetForecast(
  budget: EffectiveBudget,
  now: Date,
): BudgetForecast | null {
  if (!budget.hasBudget || Number.isNaN(now.getTime())) return null;

  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  const elapsedDays = Math.max(1, now.getUTCDate());
  const totalDays = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const consumedCredits = safeNonNegative(budget.consumedCredits);
  const consumedUsd = safeNonNegative(budget.consumedUsd);
  const amountCredits = safeNonNegative(budget.amountCredits);
  const averageCreditsPerDay = consumedCredits / elapsedDays;
  const averageUsdPerDay = consumedUsd / elapsedDays;
  const projectedCreditsAtMonthEnd = averageCreditsPerDay * totalDays;
  const projectedUsdAtMonthEnd = averageUsdPerDay * totalDays;
  const alreadyExhausted = budget.remainingCredits <= 0;

  let estimatedExhaustionDate: string | null = null;
  if (alreadyExhausted) {
    estimatedExhaustionDate = now.toISOString().slice(0, 10);
  } else if (averageCreditsPerDay > 0 && amountCredits > 0) {
    const exhaustionDay = Math.ceil(amountCredits / averageCreditsPerDay);
    if (exhaustionDay <= totalDays) {
      estimatedExhaustionDate = new Date(
        Date.UTC(year, monthIndex, Math.max(1, exhaustionDay)),
      )
        .toISOString()
        .slice(0, 10);
    }
  }

  return {
    elapsedDays,
    totalDays,
    averageCreditsPerDay: round2(averageCreditsPerDay),
    averageUsdPerDay: round2(averageUsdPerDay),
    projectedCreditsAtMonthEnd: round2(projectedCreditsAtMonthEnd),
    projectedUsdAtMonthEnd: round2(projectedUsdAtMonthEnd),
    projectedRemainingCreditsAtMonthEnd: round2(
      Math.max(0, amountCredits - projectedCreditsAtMonthEnd),
    ),
    estimatedExhaustionDate,
    alreadyExhausted,
  };
}

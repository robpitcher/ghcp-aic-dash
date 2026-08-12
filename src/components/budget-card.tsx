"use client";

import type {
  AvailableEffectiveBudget,
  EffectiveBudgetSource,
} from "@/lib/budget";
import {
  getBudgetProgressLabel,
  getBudgetStatus,
  type BudgetStatusId,
} from "@/lib/budget/display";
import { cn } from "@/lib/cn";
import { Card } from "./ui";

export type BudgetCardState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "no-budget" }
  | { status: "error"; message: string }
  | { status: "ready"; budget: AvailableEffectiveBudget };

const statusStyles: Record<
  BudgetStatusId,
  { badge: string; bar: string; symbol: string }
> = {
  on_track: {
    badge:
      "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",
    bar: "bg-green-600 dark:bg-green-400",
    symbol: "✓",
  },
  approaching: {
    badge:
      "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    bar: "bg-amber-500 dark:bg-amber-400",
    symbol: "!",
  },
  nearly_exhausted: {
    badge:
      "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    bar: "bg-orange-600 dark:bg-orange-400",
    symbol: "!!",
  },
  limit_reached: {
    badge: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
    bar: "bg-red-600 dark:bg-red-400",
    symbol: "×",
  },
};

const sourceLabels: Record<EffectiveBudgetSource, string> = {
  individual: "Individual override",
  cost_center: "Cost-center user-level budget",
  universal: "Universal user-level budget",
};

// GitHub applies the first matching user-level budget in this order.
const precedence: EffectiveBudgetSource[] = [
  "individual",
  "cost_center",
  "universal",
];

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const creditFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function BudgetPlaceholder({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      title="Current applied budget"
      subtitle="Always reflects today's billing cycle, even when viewing a historical month."
    >
      <div className="py-5">
        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {title}
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {children}
        </p>
      </div>
    </Card>
  );
}

/** Explain which overlapping user-level budget won without implying broader limits. */
export function WhyThisLimit({
  source,
}: {
  source: EffectiveBudgetSource;
}) {
  return (
    <details className="group rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
      <summary
        tabIndex={0}
        className="cursor-pointer rounded-lg px-4 py-3 text-sm font-semibold text-blue-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-blue-300 dark:focus-visible:ring-offset-gray-800"
      >
        Why this limit?
      </summary>
      <div className="border-t border-gray-200 px-4 py-4 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-300">
        <p>GitHub applies the first matching user-level budget in this order:</p>
        <ol className="mt-3 space-y-2">
          {precedence.map((candidate, index) => {
            const isWinner = candidate === source;
            return (
              <li
                key={candidate}
                className={cn(
                  "rounded-md border px-3 py-2",
                  isWinner
                    ? "border-amber-300 bg-amber-50 font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
                    : "border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400",
                )}
                aria-current={isWinner ? "true" : undefined}
              >
                {index + 1}. {sourceLabels[candidate]}
                {isWinner && (
                  <span className="ml-2 text-xs uppercase tracking-wide">
                    Applied
                  </span>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-4">
          User-level budgets are hard stops. A broader cost-center, organization,
          or enterprise spending limit may block usage earlier.
        </p>
      </div>
    </details>
  );
}

export function BudgetCard({ state }: { state: BudgetCardState }) {
  // Normalize non-ready states into the same stable card footprint.
  if (state.status === "loading") {
    return (
      <BudgetPlaceholder title="Loading applied budget…">
        Checking the user-level limit that currently applies to you.
      </BudgetPlaceholder>
    );
  }

  if (state.status === "unavailable") {
    return (
      <BudgetPlaceholder title="Budget temporarily unavailable">
        GitHub billing could not provide your applied budget right now. Your usage
        details remain available below.
      </BudgetPlaceholder>
    );
  }

  if (state.status === "no-budget") {
    return (
      <BudgetPlaceholder title="No applied user budget">
        No individual, cost-center user-level, or universal user-level budget
        currently applies to you.
      </BudgetPlaceholder>
    );
  }

  if (state.status === "error") {
    return (
      <BudgetPlaceholder title="Couldn't load your applied budget">
        {state.message}
      </BudgetPlaceholder>
    );
  }

  const { budget } = state;
  const status = getBudgetStatus(budget.percentUsed);
  const styles = statusStyles[status.id];
  // Preserve the real percentage in text while keeping the visual bar bounded.
  const progressValue = Math.min(100, Math.max(0, budget.percentUsed));

  return (
    <Card
      title="Current applied budget"
      subtitle="Always reflects today's billing cycle, even when viewing a historical month."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              AI credits consumed
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
              {creditFormatter.format(budget.consumedCredits)}
              <span className="text-base font-medium text-gray-500 dark:text-gray-400">
                {" "}
                of {creditFormatter.format(budget.amountCredits)}
              </span>
            </p>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {currencyFormatter.format(budget.consumedUsd)} of{" "}
              {currencyFormatter.format(budget.amountUsd)}
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
              styles.badge,
            )}
          >
            <span aria-hidden>{styles.symbol}</span>
            {status.label}
          </span>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700 dark:text-gray-300">
              {budget.percentUsed}% used
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              {creditFormatter.format(budget.remainingCredits)} credits remaining
            </span>
          </div>
          {/* Native progress semantics make the color-only meter screen-reader legible. */}
          <div
            role="progressbar"
            aria-label={getBudgetProgressLabel(budget.percentUsed, status)}
            aria-valuenow={progressValue}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
          >
            <div
              className={cn("h-full rounded-full", styles.bar)}
              style={{ width: `${progressValue}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {currencyFormatter.format(budget.remainingUsd)} remaining
          </p>
        </div>

        <WhyThisLimit source={budget.source} />
      </div>
    </Card>
  );
}

import type { ModelBreakdown, UsageTotals } from "./types";

export interface ModelCostInsight extends ModelBreakdown {
  percentageOfTotalCredits: number;
  effectiveGrossUsdPerCredit: number;
  percentageOfGrossSpend: number;
  percentageOfNetSpend: number;
}

export interface ModelInsightRankings {
  models: ModelCostInsight[];
  largestCreditConsumer: ModelCostInsight | null;
  largestSpendDriver: ModelCostInsight | null;
  highestEffectiveCostPerCredit: ModelCostInsight | null;
}

function percentage(value: number, total: number): number {
  if (total <= 0 || !Number.isFinite(value) || !Number.isFinite(total)) return 0;
  return Math.round((value / total) * 10_000) / 100;
}

function ratio(value: number, quantity: number): number {
  if (
    quantity <= 0 ||
    !Number.isFinite(value) ||
    !Number.isFinite(quantity)
  ) {
    return 0;
  }
  return Math.round((value / quantity) * 10_000) / 10_000;
}

function rank(
  models: ModelCostInsight[],
  value: (model: ModelCostInsight) => number,
): ModelCostInsight | null {
  return (
    [...models].sort(
      (a, b) => value(b) - value(a) || compareModelNames(a, b),
    )[0] ?? null
  );
}

function compareModelNames(
  a: Pick<ModelCostInsight, "model">,
  b: Pick<ModelCostInsight, "model">,
): number {
  return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
}

/** Adds cost shares and stable rankings without changing the usage API payload. */
export function buildModelInsights(
  perModel: ModelBreakdown[],
  totals: UsageTotals,
): ModelInsightRankings {
  // Derive presentation-only ratios from normalized aggregates, with stable
  // name tie-breakers so equal-cost models do not reorder between renders.
  const models = perModel
    .map((model) => ({
      ...model,
      percentageOfTotalCredits: percentage(
        model.grossQuantity,
        totals.grossCredits,
      ),
      effectiveGrossUsdPerCredit: ratio(
        model.grossAmount,
        model.grossQuantity,
      ),
      percentageOfGrossSpend: percentage(
        model.grossAmount,
        totals.grossAmount,
      ),
      percentageOfNetSpend: percentage(model.netAmount, totals.netAmount),
    }))
    .sort(
      (a, b) =>
        b.grossQuantity - a.grossQuantity ||
        compareModelNames(a, b),
    );

  return {
    models,
    largestCreditConsumer: rank(models, (model) => model.grossQuantity),
    largestSpendDriver: rank(models, (model) => model.grossAmount),
    highestEffectiveCostPerCredit: rank(
      models,
      (model) => model.effectiveGrossUsdPerCredit,
    ),
  };
}

"use client";

import type { ModelInsightRankings } from "@/lib/usage";
import { Banner, Card, Kpi } from "./ui";

export function ModelInsights({
  insights,
  numberFormatter,
  currencyFormatter,
}: {
  insights: ModelInsightRankings;
  numberFormatter: (value: number) => string;
  currencyFormatter: (value: number) => string;
}) {
  const {
    largestCreditConsumer,
    largestSpendDriver,
    highestEffectiveCostPerCredit,
  } = insights;

  // Avoid presenting partial rankings when the usage set has no comparable model.
  if (
    !largestCreditConsumer ||
    !largestSpendDriver ||
    !highestEffectiveCostPerCredit
  ) {
    return null;
  }

  return (
    <Card
      title="Model cost insights"
      subtitle="Deterministic observations from this month's returned usage."
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Kpi
            label="Largest credit consumer"
            value={largestCreditConsumer.model}
            subtitle={`${numberFormatter(largestCreditConsumer.grossQuantity)} credits (${numberFormatter(largestCreditConsumer.percentageOfTotalCredits)}%)`}
          />
          <Kpi
            label="Largest gross spend driver"
            value={largestSpendDriver.model}
            subtitle={`${currencyFormatter(largestSpendDriver.grossAmount)} (${numberFormatter(largestSpendDriver.percentageOfGrossSpend)}%)`}
            tone="brand"
          />
          <Kpi
            label="Highest effective cost / credit"
            value={highestEffectiveCostPerCredit.model}
            subtitle={`${currencyFormatter(highestEffectiveCostPerCredit.effectiveGrossUsdPerCredit)} per gross credit`}
          />
        </div>
        <Banner title="Use these values as a review signal">
          Compare model fit, quality, and cost for your workload; a lower observed
          cost does not mean a model is always a valid substitute. See GitHub&apos;s{" "}
          <a
            href="https://docs.github.com/en/copilot/tutorials/optimize-ai-usage"
            className="font-semibold underline underline-offset-2"
            target="_blank"
            rel="noopener noreferrer"
          >
            AI usage optimization guidance
          </a>
          .
        </Banner>
      </div>
    </Card>
  );
}

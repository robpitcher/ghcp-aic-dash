// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BudgetForecast } from "../budget-forecast";

const budget = {
  scopedLogin: "octocat",
  hasBudget: true as const,
  source: "individual" as const,
  amountUsd: 20,
  amountCredits: 2000,
  consumedUsd: 10,
  consumedCredits: 1000,
  remainingUsd: 10,
  remainingCredits: 1000,
  percentUsed: 50,
};

describe("BudgetForecast", () => {
  it("starts closed and reveals forecast details when expanded", async () => {
    render(
      <BudgetForecast budget={budget} now={new Date("2026-08-10T00:00:00Z")} />,
    );

    const summary = screen
      .getByText("Forecast budget pace")
      .closest("summary");
    const details = summary.closest("details");

    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("Forecast daily pace")).toBeInTheDocument();
    expect(
      screen.queryByText("Forecast, not a guarantee"),
    ).not.toBeInTheDocument();

    await userEvent.click(summary);

    expect(details).toHaveAttribute("open");
    expect(screen.getByText("Forecast daily pace")).toBeInTheDocument();
    expect(screen.getByText("Forecast month-end use")).toBeInTheDocument();
    expect(screen.getByText("Forecast month-end remaining")).toBeInTheDocument();
    expect(screen.getByText("Forecast exhaustion")).toBeInTheDocument();
    expect(screen.getByText("3,100")).toHaveClass("text-amber-600");
    expect(screen.getByText("Aug 20")).toHaveClass("text-amber-600");
  });

  it("uses blue when the forecast stays within budget for the month", async () => {
    render(
      <BudgetForecast
        budget={{
          ...budget,
          amountCredits: 5000,
          amountUsd: 50,
          consumedCredits: 100,
          consumedUsd: 1,
        }}
        now={new Date("2026-08-10T00:00:00Z")}
      />,
    );

    const summary = screen.getByText("Forecast budget pace").closest("summary");
    await userEvent.click(summary);

    expect(screen.getByText("310")).toHaveClass("text-blue-600");
    expect(screen.getByText("Not this month")).toHaveClass("text-green-600");
  });
});

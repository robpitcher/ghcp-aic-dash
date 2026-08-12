// @vitest-environment jsdom

import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BudgetCard } from "../budget-card";

const budget = {
  scopedLogin: "octocat",
  hasBudget: true as const,
  source: "cost_center" as const,
  amountUsd: 20,
  amountCredits: 2000,
  consumedUsd: 16,
  consumedCredits: 1600,
  remainingUsd: 4,
  remainingCredits: 400,
  percentUsed: 80,
};

describe("BudgetCard", () => {
  it("renders normalized values and an accessible status indicator", () => {
    render(<BudgetCard state={{ status: "ready", budget }} />);

    expect(screen.getByText("1,600")).toBeInTheDocument();
    expect(screen.getByText(/of 2,000/)).toBeInTheDocument();
    expect(screen.getByText("$16.00 of $20.00")).toBeInTheDocument();
    expect(screen.getByText("400 credits remaining")).toBeInTheDocument();
    expect(screen.getByText("$4.00 remaining")).toBeInTheDocument();
    expect(screen.getByText("80% used")).toBeInTheDocument();
    expect(screen.getByText("Approaching limit")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAccessibleName(
      "Applied budget used: 80%. Approaching limit.",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "80");
  });

  it("opens the accessible explainer and highlights only its source", async () => {
    const user = userEvent.setup();
    render(<BudgetCard state={{ status: "ready", budget }} />);

    const summary = screen.getByText("Why this limit?");
    await user.click(summary);

    expect(summary).toHaveFocus();
    expect(summary.closest("details")).toHaveAttribute("open");
    expect(
      screen.getByText(/Cost-center user-level budget/).closest("li"),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getAllByText("Applied")).toHaveLength(1);
    expect(screen.queryByText("octocat")).not.toBeInTheDocument();
  });

  it.each([
    ["loading", "Loading applied budget…"],
    ["unavailable", "Budget temporarily unavailable"],
    ["no-budget", "No applied user budget"],
  ] as const)("renders the %s state", (status, heading) => {
    render(<BudgetCard state={{ status }} />);
    expect(screen.getByText(heading)).toBeInTheDocument();
  });

  it("renders a distinct error state", () => {
    render(
      <BudgetCard
        state={{ status: "error", message: "Request failed (403)" }}
      />,
    );
    expect(
      screen.getByText("Couldn't load your applied budget"),
    ).toBeInTheDocument();
    expect(screen.getByText("Request failed (403)")).toBeInTheDocument();
  });
});

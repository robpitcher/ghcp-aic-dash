// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetRequest } from "../budget-request";

const readyBudget = {
  status: "ready" as const,
  budget: {
    scopedLogin: "alice",
    hasBudget: true as const,
    source: "individual" as const,
    amountUsd: 30,
    amountCredits: 3_000,
    consumedUsd: 4.25,
    consumedCredits: 425,
    remainingUsd: 25.75,
    remainingCredits: 2_575,
    percentUsed: 14.2,
  },
};

describe("BudgetRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows actionable setup guidance when IssueOps is not configured", () => {
    render(<BudgetRequest budgetState={readyBudget} repository={null} />);
    expect(
      screen.getByText("Budget requests are not configured"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("BUDGET_REQUEST_REPOSITORY=OWNER/REPO"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /review request/i }),
    ).not.toBeInTheDocument();
  });

  it("disables requests explicitly in demo mode", () => {
    render(
      <BudgetRequest
        budgetState={readyBudget}
        repository={null}
        demoMode
      />,
    );
    expect(
      screen.getByText("Budget requests are disabled in demo mode"),
    ).toBeInTheDocument();
    expect(screen.getByText(/never contacts GitHub/i)).toBeInTheDocument();
  });

  it("shows the resulting total and opens the server-generated URL in a new tab", async () => {
    const reviewWindow = {
      opener: window,
      location: { href: "about:blank" },
      close: vi.fn(),
    };
    const open = vi
      .spyOn(window, "open")
      .mockImplementation(() => reviewWindow as unknown as Window);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          url: "https://github.com/acme/requests/issues/new?title=test",
          title: "[AI Credit Budget Request] alice: +1500 credits",
          justificationTruncated: false,
        }),
      })),
    );

    render(
      <BudgetRequest budgetState={readyBudget} repository="acme/requests" />,
    );
    fireEvent.change(
      screen.getByLabelText("Requested increase in AI credits"),
      { target: { value: "1500" } },
    );
    expect(screen.getByText("4,500")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Business justification"), {
      target: {
        value: "Needed to complete the customer migration readiness work.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Review request on GitHub" }),
    );

    await waitFor(() =>
      expect(reviewWindow.location.href).toBe(
        "https://github.com/acme/requests/issues/new?title=test",
      ),
    );
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(reviewWindow.opener).toBeNull();
    const link = screen.getByRole("link", {
      name: "Open the prepared GitHub issue",
    });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it.each(["150", "1000001"])(
    "disables submission for invalid increase %s while still showing the computed total",
    (increase) => {
      render(
        <BudgetRequest budgetState={readyBudget} repository="acme/requests" />,
      );
      fireEvent.change(
        screen.getByLabelText("Requested increase in AI credits"),
        { target: { value: increase } },
      );

      const expectedTotal = 3_000 + Number(increase);
      expect(
        screen.getByText(expectedTotal.toLocaleString()),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/must be a positive multiple of 100/i),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Review request on GitHub" }),
      ).toBeDisabled();
    },
  );

  it("shows 'Enter a valid increase' when the field is empty or non-numeric", () => {
    render(
      <BudgetRequest budgetState={readyBudget} repository="acme/requests" />,
    );
    fireEvent.change(
      screen.getByLabelText("Requested increase in AI credits"),
      { target: { value: "" } },
    );

    expect(screen.getByText("Enter a valid increase")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review request on GitHub" }),
    ).toBeDisabled();
  });
});

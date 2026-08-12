// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DashboardNav } from "../dashboard-nav";

describe("DashboardNav", () => {
  it("links to both dashboard pages and marks the active page", () => {
    render(<DashboardNav active="budgets" />);

    expect(screen.getByRole("link", { name: "Analytics" })).toHaveAttribute(
      "href",
      "/analytics",
    );
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute(
      "href",
      "/budgets",
    );
    expect(screen.getByRole("link", { name: "Budgets" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Analytics" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

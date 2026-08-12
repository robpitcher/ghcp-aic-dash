import { describe, expect, it } from "vitest";
import {
  getBudgetProgressLabel,
  getBudgetStatus,
} from "@/lib/budget/display";

describe("budget display", () => {
  it.each([
    [0, "on_track", "On track"],
    [74.9, "on_track", "On track"],
    [75, "approaching", "Approaching limit"],
    [89.9, "approaching", "Approaching limit"],
    [90, "nearly_exhausted", "Nearly exhausted"],
    [99.9, "nearly_exhausted", "Nearly exhausted"],
    [100, "limit_reached", "Limit reached"],
    [120, "limit_reached", "Limit reached"],
  ] as const)("maps %s percent to the expected status", (percent, id, label) => {
    expect(getBudgetStatus(percent)).toEqual({ id, label });
  });

  it("builds a non-color-only progress label", () => {
    expect(
      getBudgetProgressLabel(81, getBudgetStatus(81)),
    ).toBe("Applied budget used: 81%. Approaching limit.");
  });
});

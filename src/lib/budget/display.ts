export type BudgetStatusId =
  | "on_track"
  | "approaching"
  | "nearly_exhausted"
  | "limit_reached";

export interface BudgetStatus {
  id: BudgetStatusId;
  label: string;
}

export function getBudgetStatus(percentUsed: number): BudgetStatus {
  if (percentUsed >= 100) {
    return { id: "limit_reached", label: "Limit reached" };
  }
  if (percentUsed >= 90) {
    return { id: "nearly_exhausted", label: "Nearly exhausted" };
  }
  if (percentUsed >= 75) {
    return { id: "approaching", label: "Approaching limit" };
  }
  return { id: "on_track", label: "On track" };
}

export function getBudgetProgressLabel(
  percentUsed: number,
  status: BudgetStatus,
): string {
  return `Applied budget used: ${percentUsed}%. ${status.label}.`;
}

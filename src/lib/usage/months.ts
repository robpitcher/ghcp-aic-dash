import type { MonthPoint } from "@/lib/github/types";

/** Shift a (year, month) pair by `delta` months (month is 1-based). */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): MonthPoint {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * The trailing `count` months ending at (and including) the given month, oldest
 * first. With count=6 this yields the selected month plus the previous five.
 */
export function trailingMonths(
  year: number,
  month: number,
  count: number,
): MonthPoint[] {
  return Array.from({ length: count }, (_, idx) =>
    shiftMonth(year, month, idx - (count - 1)),
  );
}

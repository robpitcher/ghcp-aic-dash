"use client";

/** Lower bound supported by the API (query schema enforces year >= 2020). */
export const MIN_YEAR = 2020;

/**
 * Previous / next month navigator. Clamps the lower bound to MIN_YEAR and
 * disables "next" at the current month (no future data).
 */
export function MonthNav({
  year,
  month,
  label,
  onChange,
}: {
  year: number;
  month: number;
  label: string;
  onChange: (year: number, month: number) => void;
}) {
  const now = new Date();
  const isCurrent =
    year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
  const atLowerBound = year === MIN_YEAR && month === 1;

  const go = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y--;
    }
    if (m > 12) {
      m = 1;
      y++;
    }
    if (y < MIN_YEAR) {
      y = MIN_YEAR;
      m = 1;
    }
    onChange(y, m);
  };

  const btn =
    "rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700";

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button onClick={() => go(-1)} disabled={atLowerBound} className={btn}>
        ← Prev
      </button>
      <span className="min-w-[9rem] text-center text-sm font-medium text-gray-900 dark:text-gray-100">
        {label}
      </span>
      <button onClick={() => go(1)} disabled={isCurrent} className={btn}>
        Next →
      </button>
    </div>
  );
}

"use client";

import { useState, useMemo } from "react";
import type { ModelCostInsight } from "@/lib/usage";
import { cn } from "@/lib/cn";

type SortKey = keyof Pick<
  ModelCostInsight,
  | "model"
  | "grossQuantity"
  | "percentageOfTotalCredits"
  | "effectiveGrossUsdPerCredit"
  | "grossAmount"
  | "percentageOfGrossSpend"
  | "netAmount"
  | "percentageOfNetSpend"
>;
type SortDir = "asc" | "desc";

const COLUMNS: {
  key: SortKey;
  header: string;
  align: "left" | "right";
  kind: "text" | "number" | "currency" | "percentage";
}[] = [
  { key: "model", header: "Model", align: "left", kind: "text" },
  { key: "grossQuantity", header: "Gross credits", align: "right", kind: "number" },
  { key: "percentageOfTotalCredits", header: "Credit share", align: "right", kind: "percentage" },
  { key: "effectiveGrossUsdPerCredit", header: "Gross $ / credit", align: "right", kind: "currency" },
  { key: "grossAmount", header: "Gross $", align: "right", kind: "currency" },
  { key: "percentageOfGrossSpend", header: "Gross $ share", align: "right", kind: "percentage" },
  { key: "netAmount", header: "Net $", align: "right", kind: "currency" },
  { key: "percentageOfNetSpend", header: "Net $ share", align: "right", kind: "percentage" },
];

/** Sortable per-model breakdown table. */
export function ModelTable({
  data,
  numberFormatter,
  currencyFormatter,
}: {
  data: ModelCostInsight[];
  numberFormatter: (v: number) => string;
  currencyFormatter: (v: number) => string;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("grossQuantity");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = useMemo(() => {
    // Sort a copy so presentation choices never mutate the usage response.
    const rows = [...data];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      let cmp: number;
      if (typeof av === "string" || typeof bv === "string") {
        cmp = String(av).localeCompare(String(bv));
      } else {
        cmp = (av as number) - (bv as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [data, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "model" ? "asc" : "desc");
    }
  };

  const fmt = (kind: string, value: string | number) => {
    if (kind === "currency") return currencyFormatter(Number(value));
    if (kind === "number") return numberFormatter(Number(value));
    if (kind === "percentage") return `${numberFormatter(Number(value))}%`;
    return String(value);
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left dark:border-gray-700">
            {/* aria-sort announces the active direction to assistive technology. */}
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={
                  sortKey === col.key
                    ? sortDir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none"
                }
                className={cn(
                  "px-3 py-2 text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400",
                  col.align === "right" ? "text-right" : "text-left",
                )}
              >
                <button
                  type="button"
                  onClick={() => toggleSort(col.key)}
                  className={cn(
                    "inline-flex w-full select-none items-center gap-1 hover:text-gray-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-500 dark:hover:text-gray-200 dark:focus-visible:outline-gray-300",
                    col.align === "right" ? "justify-end" : "justify-start",
                  )}
                >
                  <span>{col.header}</span>
                  {sortKey === col.key && (
                    <span aria-hidden>{sortDir === "asc" ? "▲" : "▼"}</span>
                  )}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, idx) => (
            <tr
              key={row.model}
              className={cn(
                "border-b border-gray-100 dark:border-gray-800",
                idx % 2 === 1 && "bg-gray-50/60 dark:bg-gray-800/40",
              )}
            >
              {COLUMNS.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    "px-3 py-2",
                    col.align === "right" ? "text-right" : "text-left",
                    col.kind === "text"
                      ? "font-mono text-gray-900 dark:text-gray-100"
                      : "tabular-nums text-gray-700 dark:text-gray-300",
                  )}
                >
                  {fmt(col.kind, row[col.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

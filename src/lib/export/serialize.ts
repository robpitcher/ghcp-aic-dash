import type { UsageResponse } from "@/lib/usage/types";

export interface UsageExportRow {
  period: string;
  login: string;
  model: string;
  grossCredits: number;
  includedCredits: number;
  billableCredits: number;
  grossUsd: number;
  discountUsd: number;
  netUsd: number;
  percentageOfTotalUsage: number;
}

type UsageExportSource = Pick<
  UsageResponse,
  "scopedLogin" | "period" | "totals" | "perModel"
>;

const CSV_HEADERS: ReadonlyArray<keyof UsageExportRow> = [
  "period",
  "login",
  "model",
  "grossCredits",
  "includedCredits",
  "billableCredits",
  "grossUsd",
  "discountUsd",
  "netUsd",
  "percentageOfTotalUsage",
];

function formatPeriod(period: UsageResponse["period"]): string {
  return `${period.year}-${String(period.month).padStart(2, "0")}`;
}

function protectCsvFormula(value: string): string {
  // Spreadsheet applications interpret these prefixes as formulas, even in CSV.
  return /^[=+\-@]/.test(value.trimStart()) || /^[\t\r\n]/.test(value)
    ? `'${value}`
    : value;
}

export function escapeCsvField(value: string | number): string {
  const text = typeof value === "string" ? protectCsvFormula(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function buildUsageExportRows(
  usage: UsageExportSource,
): UsageExportRow[] {
  // Export only the already scoped and normalized response shape, never raw
  // enterprise billing fields.
  const period = formatPeriod(usage.period);
  return usage.perModel.map((model) => ({
    period,
    login: usage.scopedLogin,
    model: model.model,
    grossCredits: model.grossQuantity,
    includedCredits: model.discountQuantity,
    billableCredits: model.netQuantity,
    grossUsd: model.grossAmount,
    discountUsd: model.discountAmount,
    netUsd: model.netAmount,
    percentageOfTotalUsage:
      usage.totals.grossCredits > 0
        ? (model.grossQuantity / usage.totals.grossCredits) * 100
        : 0,
  }));
}

export function serializeUsageCsv(rows: UsageExportRow[]): string {
  const lines = [
    CSV_HEADERS.join(","),
    ...rows.map((row) =>
      CSV_HEADERS.map((header) => escapeCsvField(row[header])).join(","),
    ),
  ];

  // The BOM makes UTF-8 model names open reliably in desktop spreadsheet apps.
  return `\uFEFF${lines.join("\r\n")}`;
}

export function sanitizeExportLogin(login: string): string {
  const safe = login
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return safe || "user";
}

export function buildUsageExportFilename(
  login: string,
  period: UsageResponse["period"],
  format: "csv",
): string {
  return `github-copilot-ai-usage-${sanitizeExportLogin(login)}-${formatPeriod(period)}.${format}`;
}

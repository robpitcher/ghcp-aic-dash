import { describe, expect, it } from "vitest";
import {
  buildUsageExportFilename,
  buildUsageExportRows,
  escapeCsvField,
  serializeUsageCsv,
} from "../serialize";
import type { UsageResponse } from "@/lib/usage";

const usage: UsageResponse = {
  scopedLogin: "octo/cat",
  forced: true,
  period: { year: 2026, month: 4 },
  totals: {
    grossCredits: 100,
    includedCredits: 30,
    billableCredits: 70,
    grossAmount: 20,
    discountAmount: 6,
    netAmount: 14,
    discountCoveragePct: 30,
    effectivePricePerCredit: 0.2,
  },
  perModel: [
    {
      model: 'Model, "Plus"',
      grossQuantity: 25,
      discountQuantity: 10,
      netQuantity: 15,
      grossAmount: 5,
      discountAmount: 2,
      netAmount: 3,
    },
  ],
  trend: [],
};

describe("usage export serialization", () => {
  it("builds rows from only the displayed scoped month and model data", () => {
    expect(buildUsageExportRows(usage)).toEqual([
      {
        period: "2026-04",
        login: "octo/cat",
        model: 'Model, "Plus"',
        grossCredits: 25,
        includedCredits: 10,
        billableCredits: 15,
        grossUsd: 5,
        discountUsd: 2,
        netUsd: 3,
        percentageOfTotalUsage: 25,
      },
    ]);
  });

  it("quotes commas and embedded quotes correctly", () => {
    expect(escapeCsvField("Model, Plus")).toBe('"Model, Plus"');
    expect(escapeCsvField('Model "Plus"')).toBe('"Model ""Plus"""');
    expect(escapeCsvField("1,234.56")).toBe('"1,234.56"');
    expect(serializeUsageCsv(buildUsageExportRows(usage))).toContain(
      '"Model, ""Plus"""',
    );
  });

  it("quotes line breaks and guards formula-like text", () => {
    expect(escapeCsvField("line\r\nbreak")).toBe('"line\r\nbreak"');
    expect(escapeCsvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(escapeCsvField("+SUM(1,2)")).toBe("\"'+SUM(1,2)\"");
    expect(escapeCsvField("\t=HYPERLINK(1)")).toBe("'\t=HYPERLINK(1)");
    expect(escapeCsvField(" =HYPERLINK(1)")).toBe("' =HYPERLINK(1)");
  });

  it("adds a UTF-8 BOM and uses CRLF records", () => {
    const csv = serializeUsageCsv(buildUsageExportRows(usage));
    expect(csv.startsWith("\uFEFFperiod,login,model")).toBe(true);
    expect(csv).toContain("\r\n2026-04,octo/cat,");
  });

  it("creates deterministic, filesystem-safe filenames", () => {
    expect(
      buildUsageExportFilename(" octo/cat:*? ", usage.period, "csv"),
    ).toBe("github-copilot-ai-usage-octo-cat-2026-04.csv");
  });
});

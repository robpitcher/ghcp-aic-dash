"use client";

import { useMemo } from "react";
import {
  buildUsageExportFilename,
  buildUsageExportRows,
  serializeUsageCsv,
} from "@/lib/export";
import type { UsageResponse } from "@/lib/usage";
import { Button } from "./ui";

export function UsageExportButton({ usage }: { usage: UsageResponse }) {
  const rows = useMemo(() => buildUsageExportRows(usage), [usage]);

  function download() {
    // Use a short-lived object URL so CSV contents stay entirely in the browser.
    const url = URL.createObjectURL(
      new Blob([serializeUsageCsv(rows)], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");

    try {
      anchor.href = url;
      anchor.download = buildUsageExportFilename(
        usage.scopedLogin,
        usage.period,
        "csv",
      );
      document.body.appendChild(anchor);
      anchor.click();
    } finally {
      // Always release the synthetic link and Blob URL after the download starts.
      anchor.remove();
      URL.revokeObjectURL(url);
    }
  }

  return (
    <Button type="button" onClick={download}>
      Download CSV
    </Button>
  );
}

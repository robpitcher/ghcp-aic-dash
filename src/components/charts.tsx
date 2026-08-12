"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ModelBreakdown, TrendPoint } from "@/lib/usage/types";

// Brand-leaning palette for per-model bars (DESIGN.md blue/indigo family).
const MODEL_COLORS = [
  "#2563eb",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#22c55e",
  "#ec4899",
  "#ef4444",
  "#3b82f6",
  "#7c3aed",
];

const AXIS_COLOR = "#9ca3af"; // gray-400 — legible in both light and dark.
const GRID_COLOR = "rgba(148,163,184,0.2)";

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid rgba(148,163,184,0.4)",
    fontSize: 12,
    background: "rgba(255,255,255,0.96)",
    color: "#111827",
  },
} as const;

/** Horizontal-friendly bar chart of gross credits per model. */
export function ModelBarChart({
  data,
  numberFormatter,
}: {
  data: ModelBreakdown[];
  numberFormatter: (v: number) => string;
}) {
  // Limit chart density; the adjacent table retains the complete model list.
  const top = data.slice(0, 12);
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={top}
          margin={{ top: 8, right: 8, left: 0, bottom: 8 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="model"
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={60}
          />
          <YAxis
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            tickFormatter={numberFormatter}
            width={56}
          />
          <Tooltip
            {...tooltipStyle}
            formatter={(value) =>
              [numberFormatter(Number(value)), "Gross credits"] as [
                string,
                string,
              ]
            }
          />
          <Bar dataKey="grossQuantity" radius={[6, 6, 0, 0]}>
            {top.map((_, i) => (
              <Cell key={i} fill={MODEL_COLORS[i % MODEL_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Trailing-month actual AI credit consumption trend line. */
export function TrendLineChart({
  data,
  numberFormatter,
}: {
  data: TrendPoint[];
  numberFormatter: (v: number) => string;
}) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: AXIS_COLOR, fontSize: 11 }}
            tickFormatter={numberFormatter}
            width={56}
          />
          <Tooltip
            {...tooltipStyle}
            formatter={(value) =>
              [numberFormatter(Number(value)), "AI credits consumed"] as [
                string,
                string,
              ]
            }
          />
          <Line
            type="monotone"
            dataKey="grossCredits"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3, fill: "#6366f1" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

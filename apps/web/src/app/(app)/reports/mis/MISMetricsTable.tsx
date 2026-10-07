"use client";

import { DataTable } from "../../../_components/ds";
import { parseChange, trendColor, trendCue, type TrendDirection } from "@/lib/trend";

export type MetricRow = {
  module: string;
  label: string;
  value: string;
  unit: string;
  change: string;
} & Record<string, unknown>;

/**
 * GAP-REPORTS-MIS-03: the MIS backend sends each metric's `value` as a bare
 * number string plus a free-text `unit` label (report-service mis/queries +
 * reports.kpis.unit). There is no documented minor-unit (paise) convention on
 * this endpoint — a KPI's currentValue is a plain `numeric`, not paise — so we
 * must NOT run it through formatMoney (which would divide by 100 and show a
 * 100x-too-small figure). Instead we format for READABILITY by unit:
 *   - a money-like unit (₹ / INR / rupee(s)) → Indian digit grouping, "₹" prefix
 *   - a percent unit (% / percent / pct)      → the number with a trailing "%"
 *   - anything else (counts, days, etc.)      → Indian digit grouping only
 * A non-numeric value is shown verbatim. The DECISION and the paise question
 * are recorded for HUMAN REVIEW: if money MIS metrics are ever sent in paise,
 * the backend must declare that unit explicitly and this mapping updated.
 */
const MONEY_UNIT = /(^|\b)(₹|inr|rs\.?|rupees?|lakh|crore)(\b|$)/i;
const PERCENT_UNIT = /(%|percent|pct|percentage)/i;

function groupIndian(intPart: string, negative: boolean): string {
  let grouped: string;
  if (intPart.length <= 3) {
    grouped = intPart;
  } else {
    const head = intPart.slice(0, intPart.length - 3);
    const tail = intPart.slice(intPart.length - 3);
    grouped = head.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + tail;
  }
  return negative ? `-${grouped}` : grouped;
}

export function formatMetricValue(value: string, unit: string): string {
  const trimmed = value.trim();
  const n = Number(trimmed.replace(/,/g, ""));
  if (!Number.isFinite(n) || trimmed === "") return value;

  const negative = n < 0;
  const abs = Math.abs(n);
  const [intPart, fracPart] = String(abs).split(".");
  const groupedInt = groupIndian(intPart, negative);
  const grouped = fracPart ? `${groupedInt}.${fracPart}` : groupedInt;

  if (MONEY_UNIT.test(unit)) return `₹${grouped}`;
  if (PERCENT_UNIT.test(unit)) return `${negative ? "-" : ""}${abs}%`;
  return grouped;
}

export function MISMetricsTable({ rows }: { rows: MetricRow[] }) {
  return (
    <DataTable<MetricRow>
      columns={[
        { key: "module", label: "Module" },
        { key: "label", label: "Metric" },
        {
          key: "value",
          label: "Value",
          align: "right",
          render: (row) => <span>{formatMetricValue(row.value, row.unit)}</span>,
        },
        { key: "unit", label: "Unit" },
        {
          key: "change",
          label: "Change",
          align: "right",
          render: (row) => {
            const direction: TrendDirection = parseChange(row.change);
            return (
              <span style={{ color: trendColor(direction), fontWeight: 500 }}>
                {/* GAP-REPORTS-MIS-02: a non-colour cue so the trend is legible
                    without relying on colour alone (WCAG 1.4.1). */}
                <span aria-hidden="true" style={{ marginRight: 4 }}>{trendCue(direction)}</span>
                {row.change}
              </span>
            );
          },
        },
      ]}
      rows={rows}
      sortable
      filterable
      pageSize={15}
    />
  );
}

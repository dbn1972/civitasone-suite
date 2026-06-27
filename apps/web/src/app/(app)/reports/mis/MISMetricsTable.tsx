"use client";

import { DataTable } from "../../../_components/ds";

export type MetricRow = {
  module: string;
  label: string;
  value: string;
  unit: string;
  change: string;
} & Record<string, unknown>;

export function MISMetricsTable({ rows }: { rows: MetricRow[] }) {
  return (
    <DataTable<MetricRow>
      columns={[
        { key: "module", label: "Module" },
        { key: "label", label: "Metric" },
        { key: "value", label: "Value", align: "right" },
        { key: "unit", label: "Unit" },
        {
          key: "change",
          label: "Change",
          align: "right",
          render: (row) => (
            <span style={{
              color: row.change.startsWith("+") ? "var(--good)" : row.change.startsWith("-") ? "var(--bad)" : undefined,
              fontWeight: 500,
            }}>
              {row.change}
            </span>
          ),
        },
      ]}
      rows={rows}
      sortable
      filterable
      pageSize={15}
    />
  );
}

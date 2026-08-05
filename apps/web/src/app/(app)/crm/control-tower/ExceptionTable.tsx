"use client";
import { DataTable, StatusPill } from "../../../_components/ds";

type ExRow = { id: string; label: string; severity: string; count: number; href: string };

export function ExceptionTable({ rows }: { rows: ExRow[] }) {
  return (
    <DataTable<ExRow>
      columns={[
        { key: "label", label: "Exception" },
        {
          key: "severity",
          label: "Severity",
          render: (row) => <StatusPill status={row.severity} label={row.severity} />,
        },
        { key: "count", label: "Count", align: "right" },
        {
          key: "href",
          label: "Drill down",
          render: (row) => (
            <a className="btn" href={row.href}>
              Open
            </a>
          ),
        },
      ]}
      rows={rows}
      emptyIcon="🚨"
      emptyTitle="No exceptions"
      emptyMessage="Follow-ups, ageing leads and dormant accounts will surface here."
    />
  );
}

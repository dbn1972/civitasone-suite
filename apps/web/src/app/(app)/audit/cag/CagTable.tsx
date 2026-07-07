"use client";

import { DataTable, StatusPill } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CagParaSummary } from "@/app/_data/loaders";

const STATUS_LABELS: Record<CagParaSummary["status"], string> = {
  under_review: "Under Review",
  partially_settled: "Partially Settled",
  nearly_settled: "Nearly Settled",
  settled: "Settled",
};

export function CagTable({ rows, source }: { rows: CagParaSummary[]; source: "api" | "error" }) {
  const { data } = useSeededResource("audit.cag.paras", rows, source, (d) => d.length === 0);

  return (
    <DataTable<CagParaSummary & Record<string, unknown>>
      columns={[
        { key: "reportYear", label: "Report Year", sortable: true },
        { key: "paraNo", label: "Para No." },
        { key: "department", label: "Department", sortable: true },
        { key: "totalParas", label: "Total Paras", align: "center" },
        { key: "settled", label: "Settled", align: "center" },
        { key: "pending", label: "Pending", align: "center" },
        { key: "status", label: "Status", render: (row) => <StatusPill status={STATUS_LABELS[row.status as CagParaSummary["status"]] ?? String(row.status)} /> },
      ]}
      rows={data as (CagParaSummary & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search CAG paras..."
      pageSize={15}
      exportable
      exportFilename="cag-paras"
    />
  );
}

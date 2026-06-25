"use client";

import { DataTable } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";

export type DashboardProjectRow = {
  id: string;
  projectCode: string;
  name: string;
  scheme: string;
  department: string;
  totalBudget: number;
  completionPct: number;
  status: string;
} & Record<string, unknown>;

const COLUMNS: {
  key: keyof DashboardProjectRow & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  render?: (row: DashboardProjectRow) => React.ReactNode;
}[] = [
  { key: "projectCode", label: "Project ID" },
  { key: "name", label: "Name" },
  { key: "scheme", label: "Scheme" },
  { key: "department", label: "Dept" },
  {
    key: "totalBudget",
    label: "Budget",
    align: "right",
    render: (r) => formatMoney(r.totalBudget),
  },
  {
    key: "completionPct",
    label: "Completion %",
    align: "right",
    render: (r) => `${r.completionPct.toFixed(1)}%`,
  },
  { key: "status", label: "RAG Status", cellType: "status" },
];

export function DashboardProjectsTable({ rows }: { rows: DashboardProjectRow[] }) {
  return (
    <DataTable<DashboardProjectRow>
      columns={COLUMNS}
      rows={rows}
      rowLinkPrefix="/projects/"
      rowLinkKey="id"
      sortable
      filterable
      filterPlaceholder="Filter projects…"
      pageSize={10}
    />
  );
}

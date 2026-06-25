"use client";

import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { MilestoneSummary } from "@civitasone/types";

export type MilestoneRow = MilestoneSummary & Record<string, unknown>;

const COLUMNS: {
  key: keyof MilestoneRow & string;
  label: string;
  cellType?: "status" | "amount";
  render?: (row: MilestoneRow) => React.ReactNode;
}[] = [
  { key: "projectName", label: "Project" },
  { key: "title", label: "Milestone Title" },
  { key: "dueDate", label: "Due Date", render: (r) => formatIndianDate(r.dueDate as string) },
  {
    key: "completedDate",
    label: "Completed Date",
    render: (r) => formatIndianDate(r.completedDate as string | undefined),
  },
  { key: "status", label: "Status", cellType: "status" },
];

export function MilestonesTable({ rows }: { rows: MilestoneRow[] }) {
  return (
    <DataTable<MilestoneRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter milestones…"
      pageSize={15}
    />
  );
}

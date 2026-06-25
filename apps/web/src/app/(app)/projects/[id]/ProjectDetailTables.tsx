"use client";

import { DataTable } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { ProjectDetail } from "@civitasone/types";

type MilestoneRow = ProjectDetail["milestones"][number] & Record<string, unknown>;
type FundReleaseRow = ProjectDetail["fundReleases"][number] & Record<string, unknown>;

const MILESTONE_COLUMNS: {
  key: keyof MilestoneRow & string;
  label: string;
  cellType?: "status" | "amount";
  render?: (row: MilestoneRow) => React.ReactNode;
}[] = [
  { key: "title", label: "Milestone" },
  { key: "dueDate", label: "Due Date", render: (r) => formatIndianDate(r.dueDate as string) },
  {
    key: "completedDate",
    label: "Completed",
    render: (r) => formatIndianDate(r.completedDate as string | undefined),
  },
  { key: "status", label: "Status", cellType: "status" },
];

const FUND_RELEASE_COLUMNS: {
  key: keyof FundReleaseRow & string;
  label: string;
  align?: "left" | "right";
  render?: (row: FundReleaseRow) => React.ReactNode;
}[] = [
  { key: "releaseDate", label: "Release Date", render: (r) => formatIndianDate(r.releaseDate as string) },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    render: (r) => formatMoney(r.amount as number),
  },
  {
    key: "remarks",
    label: "Remarks",
    render: (r) => (r.remarks as string | undefined) ?? "—",
  },
];

export function MilestonesDetailTable({ rows }: { rows: MilestoneRow[] }) {
  return <DataTable<MilestoneRow> columns={MILESTONE_COLUMNS} rows={rows} sortable />;
}

export function FundReleasesDetailTable({ rows }: { rows: FundReleaseRow[] }) {
  return <DataTable<FundReleaseRow> columns={FUND_RELEASE_COLUMNS} rows={rows} sortable />;
}

"use client";

import { DataTable } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { FundReleaseSummary } from "@civitasone/types";

export type FundReleaseRow = FundReleaseSummary & Record<string, unknown>;

const COLUMNS: {
  key: keyof FundReleaseRow & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  render?: (row: FundReleaseRow) => React.ReactNode;
}[] = [
  { key: "releaseNo", label: "Release No" },
  { key: "projectName", label: "Project" },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    render: (r) => formatMoney(r.amount as number),
  },
  { key: "releaseDate", label: "Release Date", render: (r) => formatIndianDate(r.releaseDate as string) },
  {
    key: "installmentNo",
    label: "Installment #",
    align: "right",
    render: (r) => ((r.installmentNo as number | undefined) != null ? String(r.installmentNo) : "—"),
  },
  { key: "status", label: "Status", cellType: "status" },
];

export function FundReleasesTable({ rows }: { rows: FundReleaseRow[] }) {
  return (
    <DataTable<FundReleaseRow>
      columns={COLUMNS}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter releases…"
      pageSize={15}
    />
  );
}

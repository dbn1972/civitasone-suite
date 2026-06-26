"use client";

import type React from "react";
import { DataTable } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { FundReleaseSummary } from "@civitasone/types";
import { DisburseButton } from "./FundReleasesActions";

export type FundReleaseRow = FundReleaseSummary & Record<string, unknown>;

/** Statuses eligible for disbursement. "sanctioned" is the pre-disbursement state
 *  (backend maps DB status → "sanctioned" before "released"). */
const DISBURSE_ELIGIBLE = new Set(["sanctioned"]);

const COLUMNS: {
  key: keyof FundReleaseRow & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  sortable?: boolean;
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
  {
    key: "id",
    label: "Actions",
    sortable: false,
    render: (r) => {
      if (!DISBURSE_ELIGIBLE.has(r.status as string)) return null;
      return (
        <DisburseButton
          schemeId={r.projectId as string}
          releaseId={r.id as string}
          releaseNo={r.releaseNo as string}
        />
      );
    },
  },
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

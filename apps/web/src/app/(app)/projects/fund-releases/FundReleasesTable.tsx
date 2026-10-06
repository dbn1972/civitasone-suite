"use client";

import type React from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { FundReleaseSummary } from "@civitasone/types";
import { DisburseButton } from "./FundReleasesActions";

export type FundReleaseRow = FundReleaseSummary & Record<string, unknown>;

/** Statuses eligible for disbursement. "sanctioned" is the pre-disbursement state
 *  (backend maps DB status → "sanctioned" before "released"). */
const DISBURSE_ELIGIBLE = new Set(["sanctioned"]);

// GAP-PROJECTS-FUND-RELEASES-04: 'sanctioned'/'utilized' have no key in the
// global STATUS_MAP (so both render the neutral "info" blue, indistinguishable
// from 'released'). Rather than recolour these words app-wide, scope the tones
// to this register: sanctioned = pre-disbursement (warn), released/utilized =
// money out favourably (good). 'released' IS keyed globally as 'mut' (its
// guarantee-return meaning elsewhere), so an explicit override is needed here.
const FUND_STATUS_VARIANT: Record<string, "good" | "warn" | "bad" | "mut" | "info"> = {
  sanctioned: "warn",
  released: "good",
  utilized: "good",
  utilised: "good",
};

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
  {
    key: "status",
    label: "Status",
    render: (r) => <StatusPill status={r.status as string} variant={FUND_STATUS_VARIANT[(r.status as string).toLowerCase()]} />,
  },
];

export function FundReleasesTable({ rows, canDisburse = false }: { rows: FundReleaseRow[]; canDisburse?: boolean }) {
  // GAP-PROJECTS-FUND-RELEASES-01: the Actions column (and the Disburse control)
  // only exists for a user whose role the server would accept. Non-authorised
  // users see no Disburse button at all (defence-in-depth; server still 403s).
  const columns = canDisburse
    ? [
        ...COLUMNS,
        {
          key: "id" as keyof FundReleaseRow & string,
          label: "Actions",
          sortable: false,
          render: (r: FundReleaseRow) => {
            if (!DISBURSE_ELIGIBLE.has(r.status as string)) return null;
            return (
              <DisburseButton
                // GAP-PROJECTS-FUND-RELEASES-03: the disburse URL path segment is
                // the schemeId; on FundReleaseSummary that value is carried in
                // projectId (backend stores schemeId there). Passed explicitly.
                schemeId={r.projectId as string}
                releaseId={r.id as string}
                releaseNo={r.releaseNo as string}
                amount={r.amount as number}
                projectName={r.projectName as string}
              />
            );
          },
        },
      ]
    : COLUMNS;

  return (
    <DataTable<FundReleaseRow>
      columns={columns}
      rows={rows}
      rowLinkPrefix="/projects/"
      rowLinkKey="projectId"
      identifyingColumnKey="projectName"
      sortable
      filterable
      filterPlaceholder="Filter releases…"
      pageSize={15}
    />
  );
}

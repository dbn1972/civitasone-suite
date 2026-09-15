"use client";

import type { ReactNode } from "react";
import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import type { GrantSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantSummary & string;
  label: string;
  align?: "left" | "right";
  cellType?: "status" | "amount";
  render?: (row: GrantSummary) => ReactNode;
};

const columns: Col[] = [
  { key: "grantNo", label: "Grant No" },
  { key: "title", label: "Title" },
  { key: "granteeName", label: "Grantee" },
  { key: "sanctionDate", label: "Sanction Date", render: (row) => formatIndianDate(row.sanctionDate) },
  { key: "totalAmount", label: "Total (₹)", align: "right", cellType: "amount" },
  { key: "disbursedAmount", label: "Disbursed", align: "right", cellType: "amount" },
  { key: "pendingAmount", label: "Pending", align: "right", cellType: "amount" },
  { key: "status", label: "Status", cellType: "status" },
];

export function GrantsTable({ grants, source = "api" }: { grants: GrantSummary[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantSummary[]>(
    "grants.list",
    grants,
    source,
    (d) => d.length === 0,
  );

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<GrantSummary>
        columns={columns}
        rows={rows}
        rowLinkPrefix="/grants/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter grants…"
        pageSize={15}
      />
    </>
  );
}

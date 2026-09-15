"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { GrantSchemeSummary } from "../_data";

type Col = {
  key: keyof GrantSchemeSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantSchemeSummary) => ReactNode;
};

const columns: Col[] = [
  { key: "code", label: "Code" },
  { key: "name", label: "Scheme Name" },
  {
    key: "budgetMinor",
    label: "Total Budget (₹)",
    align: "right",
    render: (row) => formatMoney(row.budgetMinor),
  },
  {
    key: "disbursedMinor",
    label: "Disbursed (₹)",
    align: "right",
    render: (row) => formatMoney(row.disbursedMinor),
  },
  { key: "applicationCount", label: "Applications", align: "right" },
  {
    key: "openAt",
    label: "Opens",
    render: (row) => (row.openAt ? formatIndianDate(row.openAt) : "—"),
  },
  {
    key: "status",
    label: "Status",
    render: (row) => <StatusPill status={row.status} />,
  },
];

export function SchemesTable({
  schemes,
  source = "api",
}: {
  schemes: GrantSchemeSummary[];
  source?: "api" | "error";
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantSchemeSummary[]>(
    "grants.schemes",
    schemes,
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
      <DataTable<GrantSchemeSummary>
        columns={columns}
        rows={rows}
        rowLinkPrefix="/grants/schemes/"
        rowLinkKey="id"
        identifyingColumnKey="name"
        sortable
        filterable
        filterPlaceholder="Filter schemes…"
        pageSize={15}
      />
    </>
  );
}

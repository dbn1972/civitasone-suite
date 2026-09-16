"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { GrantApplicationSummary } from "../_data";

type Col = {
  key: keyof GrantApplicationSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantApplicationSummary) => ReactNode;
};

const columns: Col[] = [
  { key: "grantNo", label: "Grant No" },
  { key: "title", label: "Purpose / Title" },
  {
    key: "granteeName",
    label: "Grantee",
    render: (row) => row.granteeName ?? "—",
  },
  {
    key: "totalAmount",
    label: "Amount (₹)",
    align: "right",
    render: (row) => formatMoney(row.totalAmount),
  },
  {
    key: "disbursedAmount",
    label: "Disbursed (₹)",
    align: "right",
    render: (row) => formatMoney(row.disbursedAmount),
  },
  {
    key: "sanctionDate",
    label: "Sanction Date",
    render: (row) => formatIndianDate(row.sanctionDate),
  },
  {
    key: "status",
    label: "Status",
    render: (row) => <StatusPill status={row.status} />,
  },
];

export function ApplicationsTable({
  applications,
  source = "api",
}: {
  applications: GrantApplicationSummary[];
  source?: "api" | "error";
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantApplicationSummary[]>(
    "grants.applications",
    applications,
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
      {rows.length === 0 ? (
        <EmptyState
          icon="📄"
          title="No grant applications yet"
          message="Applications will appear here once a grantee applies against one of your schemes."
        />
      ) : (
        <DataTable<GrantApplicationSummary>
          columns={columns}
          rows={rows}
          rowLinkPrefix="/grants/applications/"
          rowLinkKey="id"
          sortable
          filterable
          filterPlaceholder="Filter applications…"
          pageSize={15}
          emptyTitle="No applications match your filter"
          emptyMessage="Try a different grant number, grantee, or status."
        />
      )}
    </>
  );
}

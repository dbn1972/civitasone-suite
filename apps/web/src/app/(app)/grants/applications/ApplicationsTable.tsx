"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
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
  // GAP-GRANTS-APPLICATIONS-05: the cell shows the title only, so the heading
  // is "Title", not "Purpose / Title".
  { key: "title", label: "Title" },
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

  // GAP-GRANTS-APPLICATIONS-03: a failed fetch with no cached rows must show a
  // retry state, NOT the first-run "No applications yet" empty state (which
  // falsely implies the list is genuinely empty). Only show the first-run
  // message for a healthy, truly-empty list.
  if (source === "error" && rows.length === 0) {
    return (
      <>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        <RefreshErrorState error={toHumanError("load", { area: "grant applications" })} />
      </>
    );
  }

  return (
    <>
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

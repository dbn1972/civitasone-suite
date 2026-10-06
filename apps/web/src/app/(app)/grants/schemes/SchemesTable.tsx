"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { DataTable, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
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
  {
    // GAP-GRANTS-SCHEMES-04: "—" when the count is unknown, 0 only when the API
    // actually sent 0.
    key: "applicationCount",
    label: "Applications",
    align: "right",
    render: (row) => (row.applicationCount == null ? "—" : row.applicationCount),
  },
  {
    key: "openAt",
    label: "Opens",
    render: (row) => (row.openAt ? formatIndianDate(row.openAt) : "—"),
  },
  {
    // GAP-GRANTS-SCHEMES-06: the window's close date was mapped but never shown.
    key: "closeAt",
    label: "Closes",
    render: (row) => (row.closeAt ? formatIndianDate(row.closeAt) : "—"),
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
  canMaintain = false,
}: {
  schemes: GrantSchemeSummary[];
  source?: "api" | "error";
  /** GAP-GRANTS-SCHEMES-01: only grant makers get the empty-state create CTA. */
  canMaintain?: boolean;
}) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GrantSchemeSummary[]>(
    "grants.schemes",
    schemes,
    source,
    (d) => d.length === 0,
  );

  // GAP-GRANTS-SCHEMES-02: a failed fetch with no cached data must NOT render
  // the first-run "No grant schemes yet" empty state (which nudges a clerk to
  // create a duplicate during an outage). Show a real retry state instead; the
  // first-run empty state is reserved for a genuine live-but-empty list.
  if (provenance === "error-no-data" && rows.length === 0) {
    return (
      <RefreshErrorState
        error={toHumanError("load", { area: "grant schemes" })}
        backHref="/grants"
        source={{ area: "grant schemes" }}
      />
    );
  }

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {rows.length === 0 ? (
        <EmptyState
          icon="🎁"
          title="No grant schemes yet"
          message="Create your first scheme to start tracking grant funding and applications."
          action={
            canMaintain ? (
              <Link href="/grants/schemes/new" className="btn primary">
                + New Scheme
              </Link>
            ) : undefined
          }
        />
      ) : (
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
          emptyTitle="No schemes match your filter"
          emptyMessage="Try a different code, name, or status."
        />
      )}
    </>
  );
}

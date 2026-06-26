"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantSchemeSummary[]>(
    "grants.schemes",
    schemes,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${
          cachedAt ? ` from ${formatIndianDate(new Date(cachedAt).toISOString())}` : ""
        }${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p
          role="status"
          aria-live="polite"
          style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}
        >
          {cacheNote}
        </p>
      ) : null}
      <DataTable<GrantSchemeSummary>
        columns={columns}
        rows={rows}
        rowLinkPrefix="/grants/schemes/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter schemes…"
        pageSize={15}
      />
    </>
  );
}

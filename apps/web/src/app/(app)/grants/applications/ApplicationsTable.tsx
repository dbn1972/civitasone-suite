"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantApplicationSummary[]>(
    "grants.applications",
    applications,
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
      <DataTable<GrantApplicationSummary>
        columns={columns}
        rows={rows}
        rowLinkPrefix="/grants/applications/"
        rowLinkKey="id"
        sortable
        filterable
        filterPlaceholder="Filter applications…"
        pageSize={15}
      />
    </>
  );
}

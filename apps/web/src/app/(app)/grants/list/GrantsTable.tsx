"use client";

import type { ReactNode } from "react";
import { DataTable } from "@/app/_components/ds";
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
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantSummary[]>(
    "grants.list",
    grants,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${formatIndianDate(new Date(cachedAt).toISOString())}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
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

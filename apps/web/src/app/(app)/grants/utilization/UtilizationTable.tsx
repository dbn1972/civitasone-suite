"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { GrantUtilization } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GrantUtilization & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GrantUtilization) => ReactNode;
};

const columns: Col[] = [
  { key: "ucNo", label: "UC No" },
  { key: "grantNo", label: "Grant No" },
  { key: "granteeName", label: "Grantee" },
  { key: "amount", label: "Amount", align: "right", render: (row) => `₹${(row.amount / 100).toLocaleString("en-IN")}` },
  { key: "periodFrom", label: "Period From" },
  { key: "periodTo", label: "Period To" },
  { key: "submittedDate", label: "Submitted Date", render: (row) => row.submittedDate ?? "—" },
  { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
];

export function UtilizationTable({ ucs, source = "api" }: { ucs: GrantUtilization[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GrantUtilization[]>(
    "grants.utilization",
    ucs,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<GrantUtilization> columns={columns} rows={rows} />
    </>
  );
}

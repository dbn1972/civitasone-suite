"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { GranteeSummary } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

type Col = {
  key: keyof GranteeSummary & string;
  label: string;
  align?: "left" | "right" | "center";
  render?: (row: GranteeSummary) => ReactNode;
};

const columns: Col[] = [
  { key: "granteeCode", label: "Code" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type", render: (row) => <StatusPill status={row.type} label={row.type.toUpperCase()} /> },
  { key: "registrationNo", label: "Registration No", render: (row) => row.registrationNo ?? "—" },
  { key: "activeGrants", label: "Active Grants", align: "right" },
  { key: "totalGrantsReceived", label: "Total Received", align: "right", render: (row) => `₹${(row.totalGrantsReceived / 100).toLocaleString("en-IN")}` },
  { key: "ucCompliancePct", label: "UC Compliance %", align: "right", render: (row) => `${row.ucCompliancePct.toFixed(1)}%` },
];

export function GranteesTable({ grantees, source = "api" }: { grantees: GranteeSummary[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<GranteeSummary[]>(
    "grants.grantees",
    grantees,
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
      <DataTable<GranteeSummary> columns={columns} rows={rows} />
    </>
  );
}

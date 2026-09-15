"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
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
  { key: "totalGrantsReceived", label: "Total Received", align: "right", render: (row) => formatMoney(row.totalGrantsReceived) },
  { key: "ucCompliancePct", label: "UC Compliance %", align: "right", render: (row) => `${row.ucCompliancePct.toFixed(1)}%` },
];

export function GranteesTable({ grantees, source = "api" }: { grantees: GranteeSummary[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<GranteeSummary[]>(
    "grants.grantees",
    grantees,
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
      <DataTable<GranteeSummary> columns={columns} rows={rows} sortable filterable filterPlaceholder="Filter grantees…" pageSize={15} />
    </>
  );
}

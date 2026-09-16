"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { SiemAlert } from "@/app/_data/loaders";

function severityColor(severity: string): string {
  if (severity === "critical") return "bad";
  if (severity === "high") return "bad";
  if (severity === "medium") return "warn";
  return "info";
}

export function SiemTable({ alerts, source }: { alerts: SiemAlert[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.siem.alerts", alerts, source, (d) => d.length === 0);

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `data`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<SiemAlert & Record<string, unknown>>
      columns={[
        { key: "timestamp", label: "Time", render: (row) => new Date(row.timestamp as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
        { key: "title", label: "Alert" },
        { key: "severity", label: "Severity", render: (row) => <span className={`pill ${severityColor(row.severity as string)}`}>{row.severity as string}</span> },
        { key: "source", label: "Source" },
        { key: "status", label: "Status", render: (row) => <span className={`pill ${row.status === "resolved" || row.status === "mitigated" || row.status === "blocked" ? "good" : row.status === "active" ? "bad" : "warn"}`}>{row.status as string}</span> },
      ]}
      rows={data as (SiemAlert & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search alerts..."
      pageSize={15}
      exportable
      exportFilename="siem-alerts"
      />
    </>
  );
}

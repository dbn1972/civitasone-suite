"use client";

import { DataTable } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { SecurityEvent } from "@/app/_data/loaders";

export function SecurityTable({ events, source }: { events: SecurityEvent[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("admin.security.events", events, source, (d) => d.length === 0);

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `data`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<SecurityEvent & Record<string, unknown>>
      columns={[
        { key: "timestamp", label: "Time", render: (row) => new Date(row.timestamp as string).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) },
        { key: "type", label: "Event" },
        { key: "actor", label: "Actor" },
        { key: "ipAddress", label: "IP Address" },
        { key: "outcome", label: "Outcome", render: (row) => <span className={`pill ${row.outcome === "success" ? "good" : row.outcome === "flagged" ? "warn" : "bad"}`}>{row.outcome as string}</span> },
      ]}
      rows={data as (SecurityEvent & Record<string, unknown>)[]}
      sortable
      filterable
      filterPlaceholder="Search events..."
      pageSize={15}
      exportable
      exportFilename="security-events"
      />
    </>
  );
}

"use client";

import { useMemo } from "react";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { useSeededResource } from "@/lib/sync/resource";
import type { CitizenAlert } from "../../../_data/loaders";

type AlertRow = {
  id: string;
  title: string;
  category: string;
  publishedDate: string;
  targetAudience: string;
  status: string;
} & Record<string, unknown>;

export function AlertsTable({ alerts, source = "api" }: { alerts: CitizenAlert[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<CitizenAlert[]>(
    "citizen.alerts",
    alerts,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<AlertRow[]>(
    () =>
      rows.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        publishedDate: a.publishedDate,
        targetAudience: a.targetAudience,
        status: a.status,
      })),
    [rows],
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <Card title="Alerts & Notifications">
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="🔔" title="No alerts published" message="Public alerts and notifications will appear here once published." />
      ) : (
        <DataTable<AlertRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder="Search title, category, audience…"
          pageSize={15}
          exportable
          exportFilename="citizen-alerts"
          columns={[
            { key: "title", label: "Title" },
            { key: "category", label: "Category" },
            { key: "publishedDate", label: "Published" },
            { key: "targetAudience", label: "Target Audience" },
            { key: "status", label: "Status", cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}

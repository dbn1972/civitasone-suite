"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("citizenAlerts");
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
    <Card title={t("tableTitle")}>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      {tableRows.length === 0 ? (
        <EmptyState icon="🔔" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable<AlertRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          exportable
          exportFilename="citizen-alerts"
          columns={[
            { key: "title", label: t("colTitle") },
            { key: "category", label: t("colCategory") },
            { key: "publishedDate", label: t("colPublished") },
            { key: "targetAudience", label: t("colAudience") },
            { key: "status", label: t("colStatus"), cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}

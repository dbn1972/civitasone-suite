"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
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
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CitizenAlert[]>(
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

  return (
    <Card title={t("tableTitle")}>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
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

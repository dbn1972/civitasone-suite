"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";
import type { CitizenAlert } from "../../../_data/loaders";
import { NewAlertButton, PublishWithdrawActions } from "../_components/EngagementActions";

type AlertRow = {
  id: string;
  title: string;
  category: string;
  publishedDate: string;
  targetAudience: string;
  status: string;
} & Record<string, unknown>;

export function AlertsTable({ alerts, source = "api", canAuthor = false }: { alerts: CitizenAlert[]; source?: "api" | "error"; canAuthor?: boolean }) {
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
        // GAP-CITIZEN-ALERTS-04: format via formatIndianDate (dd Mon yyyy; "—"
        // for empty) so the column and the CSV export (which reads the row
        // value) match the sibling RTI/requests pages instead of a raw ISO.
        publishedDate: formatIndianDate(a.publishedDate),
        targetAudience: a.targetAudience,
        status: a.status,
      })),
    [rows],
  );

  return (
    <Card title={t("tableTitle")}>
      {/* GAP-CITIZEN-ALERTS-05: officer-tier users author alerts here; the service enforces maker-checker. */}
      {canAuthor ? <div style={{ padding: "8px 0" }}><NewAlertButton /></div> : null}
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      {tableRows.length === 0 ? (
        // GAP-CITIZEN-ALERTS-01: a fetch failure (error-no-data) must not read
        // as the cheerful "No alerts published" prompt — that is reserved for
        // a genuine 200-empty. The badge above already states the failure.
        provenance === "error-no-data" ? null : (
          <EmptyState icon="🔔" title={t("emptyTitle")} message={t("emptyMessage")} />
        )
      ) : (
        <DataTable<AlertRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          exportable exportAudit="citizen/alerts"
          exportFilename="citizen-alerts"
          columns={[
            { key: "title", label: t("colTitle") },
            { key: "category", label: t("colCategory") },
            { key: "publishedDate", label: t("colPublished") },
            { key: "targetAudience", label: t("colAudience") },
            { key: "status", label: t("colStatus"), cellType: "status" },
            ...(canAuthor
              ? [{ key: "actions", label: t("colActions"), render: (r: AlertRow) => <PublishWithdrawActions kind="alerts" id={r.id} status={r.status} /> }]
              : []),
          ]}
        />
      )}
    </Card>
  );
}

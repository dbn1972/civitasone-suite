"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import type { CitizenNotice } from "../../../_data/loaders";

type NoticeRow = {
  id: string;
  noticeNo: string;
  subject: string;
  department: string;
  published: string;
  expiry: string;
  type: string;
} & Record<string, unknown>;

export function NoticesTable({ notices, source = "api" }: { notices: CitizenNotice[]; source?: "api" | "error" }) {
  const t = useTranslations("citizenNotices");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CitizenNotice[]>(
    "citizen.notices",
    notices,
    source,
    (d) => d.length === 0,
  );

  const tableRows = useMemo<NoticeRow[]>(
    () =>
      rows.map((n) => ({
        id: n.id,
        noticeNo: n.noticeNo,
        subject: n.subject,
        department: n.department,
        published: n.published,
        expiry: n.expiry,
        type: n.type,
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
        <EmptyState icon="📰" title={t("emptyTitle")} message={t("emptyMessage")} />
      ) : (
        <DataTable<NoticeRow>
          rows={tableRows}
          sortable
          filterable
          filterPlaceholder={t("filterPlaceholder")}
          pageSize={15}
          exportable
          exportFilename="citizen-notices"
          columns={[
            { key: "noticeNo", label: t("colNoticeNo") },
            { key: "subject", label: t("colSubject") },
            { key: "department", label: t("colDepartment") },
            { key: "published", label: t("colPublished") },
            { key: "expiry", label: t("colExpiry") },
            { key: "type", label: t("colType"), cellType: "status" },
          ]}
        />
      )}
    </Card>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, DataTable, EmptyState, StatGrid, StatCard, Segmented, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { todayIST, istDatePart } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import type { CitizenNotice } from "../../../_data/loaders";

type NoticeRow = {
  id: string;
  noticeNo: string;
  subject: string;
  department: string;
  published: string;
  expiry: string;
  type: string;
  noticeStatus: "active" | "expired";
} & Record<string, unknown>;

type Filter = "active" | "expired" | "all";

/**
 * GAP-CITIZEN-NOTICES-02: a notice is EXPIRED when it has an expiry date that
 * is strictly before today (IST). A notice with no expiry never expires.
 */
function isExpired(expiry: string | null | undefined): boolean {
  const day = istDatePart(expiry ?? undefined);
  return day !== null && day < todayIST();
}

export function NoticesTable({ notices, source = "api" }: { notices: CitizenNotice[]; source?: "api" | "error" }) {
  const t = useTranslations("citizenNotices");
  const [filter, setFilter] = useState<Filter>("active");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<CitizenNotice[]>(
    "citizen.notices",
    notices,
    source,
    (d) => d.length === 0,
  );

  const allRows = useMemo<NoticeRow[]>(
    () =>
      rows.map((n) => ({
        id: n.id,
        noticeNo: n.noticeNo,
        subject: n.subject,
        department: n.department,
        published: n.published,
        expiry: n.expiry,
        type: n.type,
        noticeStatus: isExpired(n.expiry) ? "expired" : "active",
      })),
    [rows],
  );

  // GAP-CITIZEN-NOTICES-01: stats are derived from the SAME seeded rows the
  // table shows (one data source), and only ACTIVE notices are counted
  // (GAP-CITIZEN-NOTICES-02) so the headline figures match the default view.
  const active = useMemo(() => allRows.filter((r) => r.noticeStatus === "active"), [allRows]);
  const statutory = active.filter((r) => r.type === "Statutory").length;
  const publicHearings = active.filter((r) => r.type === "Public Hearing").length;
  const tenders = active.filter((r) => r.type === "Tender").length;
  const errored = (provenance ?? "live") === "error-no-data";

  const tableRows = useMemo<NoticeRow[]>(() => {
    if (filter === "all") return allRows;
    return allRows.filter((r) => r.noticeStatus === filter);
  }, [allRows, filter]);

  // GAP-CITIZEN-NOTICES-01: when the fetch failed and there is no cached data,
  // show a retry state instead of the misleading "No notices published" empty
  // state under an error badge.
  if (errored) {
    return (
      <>
        <StatGrid>
          <StatCard icon="📰" iconBg="#eef2ff" label={t("statTotal")} value="—" />
          <StatCard icon="⚖️" iconBg="#ecfdf3" label={t("statStatutory")} value="—" />
          <StatCard icon="🏛️" iconBg="#fffaeb" label={t("statHearings")} value="—" />
          <StatCard icon="📋" iconBg="#fce7ee" label={t("statTenders")} value="—" />
        </StatGrid>
        <RefreshErrorState error={toHumanError("load", { area: "public notices" })} backHref="/citizen" />
      </>
    );
  }

  return (
    <>
      <StatGrid>
        <StatCard icon="📰" iconBg="#eef2ff" label={t("statTotal")} value={active.length} />
        <StatCard icon="⚖️" iconBg="#ecfdf3" label={t("statStatutory")} value={statutory} />
        <StatCard icon="🏛️" iconBg="#fffaeb" label={t("statHearings")} value={publicHearings} />
        <StatCard icon="📋" iconBg="#fce7ee" label={t("statTenders")} value={tenders} />
      </StatGrid>

      <Card title={t("tableTitle")}>
        <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
        <div style={{ padding: "8px 0" }} role="group" aria-label={t("filterStatusAria")}>
          <Segmented
            value={filter}
            onChange={(v) => setFilter(v as Filter)}
            options={[
              { value: "active", label: t("filterActive") },
              { value: "expired", label: t("filterExpired") },
              { value: "all", label: t("filterAll") },
            ]}
          />
        </div>
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
              // GAP-CITIZEN-NOTICES-04: format dates (null -> "—").
              { key: "published", label: t("colPublished"), cellType: "date" },
              { key: "expiry", label: t("colExpiry"), cellType: "date" },
              // GAP-CITIZEN-NOTICES-02: explicit Active/Expired status pill.
              {
                key: "noticeStatus",
                label: t("colStatus"),
                cellType: "status",
                statusLabels: { active: t("statusActive"), expired: t("statusExpired") },
              },
              // GAP-CITIZEN-NOTICES-03: type is NOT a workflow status — render
              // the plain humanised value, no StatusPill colour semantics.
              { key: "type", label: t("colType") },
            ]}
          />
        )}
      </Card>
    </>
  );
}

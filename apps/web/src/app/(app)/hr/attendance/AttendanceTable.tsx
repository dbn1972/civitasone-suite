"use client";

import Link from "next/link";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import type { AttendanceSummaryItem } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";

export function AttendanceTable({ attendance, source = "api", canConfigure = false }: { attendance: AttendanceSummaryItem[]; source?: "api" | "error"; canConfigure?: boolean }) {
  const t = useTranslations("attendance");
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<AttendanceSummaryItem[]>(
    "hr.attendance",
    attendance,
    source,
    (d) => d.length === 0,
  );

  const columns: { key: keyof AttendanceSummaryItem & string; label: string; align?: "left" | "right"; render?: (row: AttendanceSummaryItem) => ReactNode }[] = [
    { key: "employeeName", label: t("colEmployee") },
    { key: "department", label: t("colDepartment") },
    { key: "date", label: t("colDate"), render: (r) => formatIndianDate(r.date) },
    { key: "checkIn", label: t("colCheckIn"), render: (r) => r.checkIn ?? "—" },
    { key: "checkOut", label: t("colCheckOut"), render: (r) => r.checkOut ?? "—" },
    // GAP-HR-ATTENDANCE-06: passing an explicit `label` bypassed StatusPill's
    // own humanizeStatus fallback, so "on_leave"/"half_day" rendered as raw
    // lowercase "on leave"/"half day" instead of "On Leave"/"Half Day". (The
    // STATUS_MAP tone/color entries this item's catalog text also asked for
    // already exist in ds/StatusPill.tsx -- GAP-SF-04 added them separately;
    // only the label was still wrong.)
    { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} /> },
    { key: "hoursWorked", label: t("colHours"), align: "right", render: (r) => (r.hoursWorked != null ? r.hoursWorked.toFixed(1) : "—") },
  ];

  // UX-012: preserve UX-017's existing translation of the cached-state note
  // (this table already had a translated i18n string here) by feeding it to
  // DataSourceBadge's `message` override rather than falling back to the
  // badge's own hardcoded English default. The error-no-data path had no
  // translated copy before this fix either (the old page-level badge had no
  // `message` prop, so it always rendered the default English text) -- that
  // is unchanged, not a new regression.
  const cachedMessage =
    provenance === "cached"
      ? `${t("cacheNoteShowingSaved")}${cachedAt ? t("cacheNoteFrom", { date: new Date(cachedAt).toLocaleString("en-IN") }) : ""}${offline ? t("cacheNoteOffline") : ""}.`
      : undefined;

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} message={cachedMessage} />
      <DataTable<AttendanceSummaryItem>
        columns={columns}
        rows={rows}
        caption="Attendance summary with employee, check-in/out times, and status"
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={20}
        emptyIcon="🕐"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
        // GAP-HR-ATTENDANCE-04: this used to link to /hr/attendance/config
        // unconditionally, including for roles (hr_officer, manager) that
        // pass this page's own view gate but can't open that admin-only
        // page -- and the label "Configure check-in" implied an action that
        // page can't actually perform (it's a read-only rules reference,
        // GAP-HR-ATTENDANCE-CONFIG-01/03). Relabeled honestly and shown only
        // to the roles that can actually open the target.
        emptyAction={
          canConfigure ? (
            <Link href="/hr/attendance/config" className="btn primary" style={{ marginTop: 10 }}>
              {t("configureCheckIn")}
            </Link>
          ) : undefined
        }
      />
    </>
  );
}

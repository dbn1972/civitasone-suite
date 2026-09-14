"use client";

import Link from "next/link";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import type { AttendanceSummaryItem } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";
import { formatIndianDate } from "@/lib/formatters";

export function AttendanceTable({ attendance, source = "api" }: { attendance: AttendanceSummaryItem[]; source?: "api" | "error" }) {
  const t = useTranslations("attendance");
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AttendanceSummaryItem[]>(
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
    { key: "status", label: t("colStatus"), render: (r) => <StatusPill status={r.status} label={r.status.replace("_", " ")} /> },
    { key: "hoursWorked", label: t("colHours"), align: "right", render: (r) => (r.hoursWorked != null ? r.hoursWorked.toFixed(1) : "—") },
  ];

  const cacheNote =
    offline || fromCache
      ? `${t("cacheNoteShowingSaved")}${cachedAt ? t("cacheNoteFrom", { date: new Date(cachedAt).toLocaleString("en-IN") }) : ""}${offline ? t("cacheNoteOffline") : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--warn)", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<AttendanceSummaryItem>
        columns={columns}
        rows={rows}
        sortable
        filterable
        filterPlaceholder={t("filterPlaceholder")}
        pageSize={20}
        emptyIcon="🕐"
        emptyTitle={t("emptyTitle")}
        emptyMessage={t("emptyMessage")}
        emptyAction={
          <Link href="/hr/attendance/config" className="btn primary" style={{ marginTop: 10 }}>
            {t("configureCheckIn")}
          </Link>
        }
      />
    </>
  );
}

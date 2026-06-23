"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "../../../_components/ds";
import type { AttendanceSummaryItem } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

const columns: { key: keyof AttendanceSummaryItem & string; label: string; align?: "left" | "right"; render?: (row: AttendanceSummaryItem) => ReactNode }[] = [
  { key: "employeeName", label: "Employee" },
  { key: "department", label: "Department" },
  { key: "date", label: "Date" },
  { key: "checkIn", label: "Check-In", render: (r) => r.checkIn ?? "—" },
  { key: "checkOut", label: "Check-Out", render: (r) => r.checkOut ?? "—" },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} label={r.status.replace("_", " ")} /> },
  { key: "hoursWorked", label: "Hours", align: "right", render: (r) => (r.hoursWorked != null ? r.hoursWorked.toFixed(1) : "—") },
];

export function AttendanceTable({ attendance, source = "api" }: { attendance: AttendanceSummaryItem[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AttendanceSummaryItem[]>(
    "hr.attendance",
    attendance,
    source,
    (d) => d.length === 0,
  );

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<AttendanceSummaryItem> columns={columns} rows={rows} />
    </>
  );
}

"use client";

import type { ReactNode } from "react";
import { DataTable, StatusPill } from "../../../../_components/ds";
import type { AttendanceRegularisation } from "@civitasone/types";
import { useSeededResource } from "@/lib/sync/resource";

const columns: { key: keyof AttendanceRegularisation & string; label: string; render?: (row: AttendanceRegularisation) => ReactNode }[] = [
  { key: "employeeName", label: "Employee" },
  { key: "date", label: "Date" },
  { key: "reason", label: "Reason" },
  { key: "requestedStatus", label: "Requested Status" },
  { key: "requestedAt", label: "Applied At" },
  { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
];

export function RegularisationTable({ regs, source = "api" }: { regs: AttendanceRegularisation[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<AttendanceRegularisation[]>(
    "hr.attendanceRegularisation",
    regs,
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
      <DataTable<AttendanceRegularisation> columns={columns} rows={rows} />
    </>
  );
}

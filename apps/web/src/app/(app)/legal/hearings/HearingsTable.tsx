"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DataTable, Segmented } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import { useSeededResource } from "@/lib/sync/resource";

type Hearing = {
  id: string;
  caseId: string;
  caseNo: string;
  court: string;
  date: string;
  time?: string | null;
  purpose?: string | null;
  status: string;
} & Record<string, unknown>;

const FILTERS = ["This week", "Today"] as const;

function hearingStatusPill(status: string): ReactNode {
  switch (status) {
    case "completed":
      return <span className="pill good">Listed</span>;
    case "adjourned":
      return <span className="pill warn">Adjourned</span>;
    case "cancelled":
      return <span className="pill bad">Cancelled</span>;
    default:
      return <span className="pill info">Listed</span>;
  }
}

export function HearingsTable({ items, source = "api" }: { items: Hearing[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Hearing[]>(
    "legal.hearings",
    items,
    source,
    (d) => d.length === 0,
  );

  const [filter, setFilter] = useState<string>("This week");

  const visible = useMemo(() => {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const today = new Date().toISOString().slice(0, 10);
    const weekEnd = new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10);
    if (filter === "Today") return sorted.filter((r) => r.date === today);
    if (filter === "This week") return sorted.filter((r) => r.date >= today && r.date <= weekEnd);
    return sorted;
  }, [rows, filter]);

  const cacheNote =
    offline || fromCache
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <div className="card">
      <div className="card-h">
        <h3>Hearing schedule</h3>
        <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
      </div>
      {cacheNote ? (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0", padding: "8px 16px 0" }}>
          {cacheNote}
        </p>
      ) : null}
      <DataTable<Hearing>
        columns={[
          {
            key: "date",
            label: "Date & time",
            render: (r) => <>{formatIndianDate(r.date)}{r.time ? ` · ${r.time}` : ""}</>,
          },
          { key: "caseNo", label: "Case No.", render: (r) => <span className="mono">{r.caseNo}</span> },
          { key: "court", label: "Court" },
          { key: "purpose", label: "Purpose", render: (r) => <>{r.purpose ?? "—"}</> },
          { key: "status", label: "Status", render: (r) => hearingStatusPill(r.status) },
        ]}
        rows={visible}
        rowHref={(r) => `/legal/cases/${r.caseId}`}
        sortable
        filterable
        filterPlaceholder="Filter hearings…"
        pageSize={15}
      />
    </div>
  );
}

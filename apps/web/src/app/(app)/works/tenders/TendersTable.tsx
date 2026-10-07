"use client";

import { useMemo, useState } from "react";
import { DataTable, StatGrid, StatCard, Segmented } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";

const columns = [
  { key: "work", label: "Work", sortable: true },
  { key: "tenderType", label: "Tender Type", sortable: true },
  { key: "amount", label: "Amount", align: "right" as const, cellType: "amount" as const, sortable: true },
  { key: "openingDate", label: "Opening Date", sortable: true },
  { key: "authority", label: "Authority", sortable: true },
  { key: "status", label: "Status", cellType: "status" as const, sortable: true },
];

type Row = Record<string, unknown> & { statusKey?: string; openingDateIso?: string | null };

const STATUS_FILTERS = ["All", "Upcoming", "Opening date passed", "Awarded"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_KEY_BY_LABEL: Record<Exclude<StatusFilter, "All">, string> = {
  Upcoming: "upcoming",
  "Opening date passed": "opening_passed",
  Awarded: "awarded",
};

/** Opening date within the next 7 days (inclusive), IST-agnostic epoch compare. */
function isOpeningThisWeek(iso: string | null | undefined, now = Date.now()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  return t >= now && t <= now + weekMs;
}

export function TendersTable({ tenders, source }: { tenders: Record<string, unknown>[]; source: "api" | "error" }) {
  const { data, provenance, offline, cachedAt } = useSeededResource("works-tenders", tenders, source, (rows) => rows.length === 0);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [openingThisWeek, setOpeningThisWeek] = useState(false);

  const rows = data as Row[];

  // GAP-WORKS-TENDERS-04: filter `data` client-side before the table.
  const filtered = useMemo(() => {
    let out = rows;
    if (statusFilter !== "All") {
      const key = STATUS_KEY_BY_LABEL[statusFilter];
      out = out.filter((r) => r.statusKey === key);
    }
    if (openingThisWeek) {
      out = out.filter((r) => isOpeningThisWeek(r.openingDateIso));
    }
    return out;
  }, [rows, statusFilter, openingThisWeek]);

  // GAP-WORKS-TENDERS-03: stat cards computed from the SAME rows the table
  // shows (not a separate server read), so offline/cached counts always match.
  // When the fetch errored with no cached rows to fall back on, show "—"
  // instead of a false 0.
  const errored = provenance === "error-no-data";
  const total = rows.length;
  const upcoming = rows.filter((r) => r.statusKey === "upcoming").length;
  const passed = rows.filter((r) => r.statusKey === "opening_passed").length;
  const dash = (n: number) => (errored ? "—" : String(n));

  return (
    <>
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <StatGrid>
        <StatCard icon="📢" iconBg="#eff6ff" label="Total Tenders" value={dash(total)} />
        <StatCard icon="📝" iconBg="#fffaeb" label="Upcoming" value={dash(upcoming)} />
        <StatCard icon="⏰" iconBg="#f0fdf4" label="Opening date passed" value={dash(passed)} />
      </StatGrid>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", margin: "8px 0" }}>
        <Segmented
          options={[...STATUS_FILTERS]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as StatusFilter)}
        />
        <label style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={openingThisWeek}
            onChange={(e) => setOpeningThisWeek(e.target.checked)}
          />
          Opening this week
        </label>
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Search tenders..."
        pageSize={15}
        exportable
        exportFilename="works-tenders"
        emptyIcon="📢"
        emptyTitle="No tenders found"
        emptyMessage="Tender records will appear here once created."
        rowHref={(row) => "/works/tenders/" + String(row.id ?? "")}
      />
    </>
  );
}

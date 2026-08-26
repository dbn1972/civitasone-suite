"use client";
import { DataTable } from "@/app/_components/ds";
import { useSeededResource } from "@/lib/sync/resource";

type Row = Record<string, unknown>;

function pct(val: unknown): string {
  const n = Number(val ?? 0);
  return isNaN(n) ? "0%" : `${(n / 100).toFixed(1)}%`;
}

function rupees(val: unknown): string {
  const n = Number(BigInt(String(val ?? "0"))) / 100;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return `₹${n.toFixed(0)}`;
}

function exceptionBadge(kind: unknown): string {
  switch (kind) {
    case "over_committed":      return "Over-committed";
    case "projected_overspend": return "Proj. Overspend";
    case "under_utilised":      return "Under-utilised";
    default:                    return "On Track";
  }
}

function progressBar(utilisationBps: unknown): React.ReactNode {
  const bps = Number(utilisationBps ?? 0);
  // TRUE utilisation — a head can exceed 100% (overspend). Never cap the number
  // we SHOW the officer; only the bar's fill width is clamped to the track.
  const actualPct = bps / 100;
  const barWidth = Math.min(100, Math.max(0, actualPct));
  const overBudget = actualPct > 100;
  const color = actualPct > 90 ? "var(--bad)" : actualPct > 60 ? "var(--warn)" : "var(--good)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 100, height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden",
      }}>
        <div style={{ width: `${barWidth}%`, height: "100%", background: color, borderRadius: 4, transition: "width .3s" }} />

      </div>
      <span
        style={{ fontSize: 12, color: overBudget ? "var(--bad)" : "var(--ink2)", fontWeight: overBudget ? 700 : 400 }}
        title={overBudget ? "Expenditure has exceeded the allocation for this head" : undefined}
      >
        {actualPct.toFixed(1)}%{overBudget ? " ⚠ over budget" : ""}
      </span>

    </div>
  );
}

import React from "react";

export function MonitoringTable({ lines, source = "api" }: { lines: Row[]; source?: "api" | "error" }) {
  const { data: rows, fromCache, offline, cachedAt } = useSeededResource<Row[]>(
    "finance.budget-monitoring-lines", lines, source, (d) => d.length === 0
  );
  const cacheNote = offline || fromCache
    ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
    : null;

  const enriched = rows.map((r) => ({
    ...r,
    _allocated: rupees(r.allocatedMinor),
    _committed: rupees(r.committedMinor),
    _actual:    rupees(r.actualMinor),
    _available: rupees(r.availableMinor),
    _exception: exceptionBadge(r.exception),
  }));


  return (
    <>
      {cacheNote && (
        <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px" }}>
          {cacheNote}
        </p>
      )}
      <DataTable<Row>
        columns={[
          { key: "headId", label: "Head ID" },
          { key: "fy",     label: "FY" },
          { key: "_allocated", label: "Allocated",  align: "right" },
          { key: "_committed", label: "Committed",  align: "right" },
          { key: "_actual",    label: "Expended",   align: "right" },
          { key: "_available", label: "Available",  align: "right" },
          // Render the bar via the column API — DataTable String()-ifies a bare
          // ReactNode cell value (would show "[object Object]"); key stays a real
          // numeric field so the column still sorts by true utilisation.
          { key: "utilisationBps", label: "Utilisation", render: (r) => progressBar(r.utilisationBps) },

          { key: "_exception", label: "Status" },
        ]}
        rows={enriched}
        sortable
        filterable
        filterPlaceholder="Search heads…"
        pageSize={20}
        exportable
        exportFilename="budget-monitoring"
        emptyIcon="📊"
        emptyTitle="No allocation data"
        emptyMessage="No budget allocation lines found for this FY."
      />
    </>
  );
}

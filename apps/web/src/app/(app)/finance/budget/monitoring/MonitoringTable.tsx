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
  const pctVal = Math.min(100, bps / 100);
  const color = pctVal > 90 ? "var(--bad)" : pctVal > 60 ? "var(--warn)" : "var(--good)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: 100, height: 8, background: "var(--line)", borderRadius: 4, overflow: "hidden",
      }}>
        <div style={{ width: `${pctVal}%`, height: "100%", background: color, borderRadius: 4, transition: "width .3s" }} />
      </div>
      <span style={{ fontSize: 12, color: "var(--ink2)" }}>{pctVal.toFixed(1)}%</span>
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
    _utilBar:   progressBar(r.utilisationBps),
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
          { key: "_utilBar",   label: "Utilisation" },
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

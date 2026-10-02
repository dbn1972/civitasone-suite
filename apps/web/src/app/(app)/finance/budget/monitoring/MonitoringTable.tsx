"use client";
import React from "react";
import { DataTable } from "@/app/_components/ds";
import { StatusPill, type PillVariant } from "@/app/_components/ds/StatusPill";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { useSeededResource } from "@/lib/sync/resource";
import { budgetHeadLabel } from "../_lib/headLabel";

type Row = Record<string, unknown>;

/** The server's exception classification -> the label and pill tone shown for it. */
const EXCEPTION: Record<string, { label: string; variant: PillVariant }> = {
  over_committed: { label: "Over-committed", variant: "bad" },
  projected_overspend: { label: "Proj. Overspend", variant: "warn" },
  under_utilised: { label: "Under-utilised", variant: "info" },
};
const ON_TRACK = { label: "On Track", variant: "good" as PillVariant };

export function exceptionInfo(kind: unknown): { label: string; variant: PillVariant } {
  return EXCEPTION[String(kind)] ?? ON_TRACK;
}

/**
 * Bar colour from utilisation, never less severe than the row's own exception:
 * a head the server flags over-committed / projected-overspend must not carry a
 * green bar next to a red/amber status (GAP-FINANCE-BUDGET-MONITORING-05).
 * (Utilisation is (committed + expended) / allocation -- the same basis the
 * exception is derived from.)
 */
export function barColor(actualPct: number, exception: unknown): string {
  const byPct = actualPct > 90 ? 2 : actualPct > 60 ? 1 : 0;
  const byException = exception === "over_committed" ? 2 : exception === "projected_overspend" ? 1 : 0;
  return ["var(--good)", "var(--warn)", "var(--bad)"][Math.max(byPct, byException)];
}

function progressBar(utilisationBps: unknown, exception: unknown): React.ReactNode {
  const bps = Number(utilisationBps ?? 0);
  // TRUE utilisation — a head can exceed 100% (overspend). Never cap the number
  // we SHOW the officer; only the bar's fill width is clamped to the track.
  const actualPct = bps / 100;
  const barWidth = Math.min(100, Math.max(0, actualPct));
  const overBudget = actualPct > 100;
  const color = barColor(actualPct, exception);
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

export function MonitoringTable({ lines, source = "api" }: { lines: Row[]; source?: "api" | "error" }) {
  const { data: rows, provenance, offline, cachedAt } = useSeededResource<Row[]>(
    "finance.budget-monitoring-lines", lines, source, (d) => d.length === 0
  );

  const enriched = rows.map((r) => ({
    ...r,
    // GAP-FINANCE-BUDGET-MONITORING-02: "2202 · General Education", not a uuid.
    _head: budgetHeadLabel({
      headCode: typeof r.headCode === "string" ? r.headCode : null,
      headName: typeof r.headName === "string" ? r.headName : null,
    }),
  }));

  return (
    <>
      {/* UX-012: this badge is the ONLY place that reports data provenance for
          the rows shown below — it reads the same useSeededResource call as
          `rows`, so it can never disagree with what the table shows
          (UX-002's pattern; the page used to render a second, independent
          badge from the raw `source` prop — removed). */}
      <DataSourceBadge provenance={provenance ?? "live"} cachedAt={cachedAt} offline={offline} />
      <DataTable<Row>
        columns={[
          { key: "_head", label: "Budget Head", render: (r) => <span title={String(r.headId ?? "")}>{String(r._head)}</span> },
          { key: "fy",     label: "FY" },
          // GAP-FINANCE-BUDGET-MONITORING-03: exact paise via formatMoney, plain decimals in the CSV.
          { key: "allocatedMinor", label: "Allocated", align: "right", cellType: "amount" },
          { key: "committedMinor", label: "Committed", align: "right", cellType: "amount" },
          { key: "actualMinor",    label: "Expended",  align: "right", cellType: "amount" },
          { key: "availableMinor", label: "Available", align: "right", cellType: "amount" },
          // Render the bar via the column API — DataTable String()-ifies a bare
          // ReactNode cell value (would show "[object Object]"); key stays a real
          // numeric field so the column still sorts by true utilisation.
          { key: "utilisationBps", label: "Utilisation (committed + expended)", render: (r) => progressBar(r.utilisationBps, r.exception) },
          { key: "exception", label: "Status", render: (r) => { const e = exceptionInfo(r.exception); return <StatusPill status={String(r.exception ?? "on_track")} label={e.label} variant={e.variant} />; }, csv: (r) => exceptionInfo(r.exception).label },
        ]}
        rows={enriched}
        sortable
        filterable
        filterPlaceholder="Search heads…"
        pageSize={20}
        exportable
        csvPlainAmounts
        exportFilename="budget-monitoring"
        emptyIcon="📊"
        emptyTitle="No allocation data"
        emptyMessage="No budget allocation lines found for this FY."
      />
    </>
  );
}

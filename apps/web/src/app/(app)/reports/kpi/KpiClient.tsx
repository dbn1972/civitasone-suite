"use client";

import { useState } from "react";
import { DataTable, EmptyState, Segmented, StatusPill } from "../../../_components/ds";

export type KpiRow = {
  id: string;
  kpiName: string;
  module: string;
  currentValue: number;
  targetValue: number;
  achievementPct: number;
  unit: string;
  period: string;
  statusLabel: string;
  statusPill: string;
  rawStatus: string;
} & Record<string, unknown>;

const SEG_OPTIONS = ["All", "Below target"];

// GAP-REPORTS-KPI-01: KPISummary carries targetValue, currentValue and
// achievementPct, but the table only showed name/module/unit/period/status —
// so a "monitor with targets" showed no actual or target. Render them, with the
// unit appended, so the subtitle's "indicators with targets" is actually true.
function withUnit(value: number, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const n = value.toLocaleString("en-IN");
  if (!unit) return n;
  return unit === "%" || unit === "pct" ? `${n}%` : `${n} ${unit}`;
}

export function KpiClient({ rows }: { rows: KpiRow[] }) {
  const [seg, setSeg] = useState("All");

  const belowTarget = seg === "Below target";
  const filtered = belowTarget
    ? rows.filter((r) => r.rawStatus === "off_track" || r.rawStatus === "at_risk")
    : rows;

  return (
    <>
      <div className="card-h" style={{ paddingTop: 0 }}>
        <Segmented
          options={SEG_OPTIONS}
          value={seg}
          onChange={setSeg}
        />
      </div>
      {filtered.length === 0 ? (
        // GAP-REPORTS-KPI-04: an empty "Below target" filter is good news, not
        // missing data — don't reuse the "No KPI data available" copy.
        belowTarget ? (
          <EmptyState icon="✅" title="No KPIs below target" message="All tracked KPIs are on track." />
        ) : (
          <EmptyState icon="🎯" title="No KPI data available" message="KPIs will appear once the service has processed data." />
        )
      ) : (
        <DataTable<KpiRow>
          columns={[
            { key: "kpiName", label: "KPI" },
            { key: "module", label: "Owner Module" },
            { key: "currentValue", label: "Actual", render: (row) => withUnit(row.currentValue, row.unit) },
            { key: "targetValue", label: "Target", render: (row) => withUnit(row.targetValue, row.unit) },
            {
              key: "achievementPct",
              label: "Achievement",
              render: (row) => (Number.isFinite(row.achievementPct) ? `${row.achievementPct}%` : "—"),
            },
            { key: "period", label: "Period" },
            {
              key: "statusLabel",
              label: "Status",
              render: (row) => <StatusPill status={row.statusPill} label={row.statusLabel} />,
            },
          ]}
          rows={filtered}
          sortable
          filterable
          pageSize={15}
        />
      )}
    </>
  );
}

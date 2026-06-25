"use client";

import { useState } from "react";
import { DataTable, EmptyState, Segmented, StatusPill } from "../../../_components/ds";

type KpiRow = {
  id: string;
  kpiName: string;
  module: string;
  unit: string;
  period: string;
  statusLabel: string;
  statusPill: string;
  rawStatus: string;
};

const SEG_OPTIONS = ["All", "Below target"];

export function KpiClient({ rows }: { rows: KpiRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = seg === "Below target"
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
        <EmptyState icon="🎯" title="No KPI data available" message="KPIs will appear once the service has processed data." />
      ) : (
        <DataTable<KpiRow>
          columns={[
            { key: "kpiName", label: "KPI" },
            { key: "module", label: "Owner Module" },
            { key: "unit", label: "Unit" },
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

"use client";

import { useState } from "react";
import { DataTable, EmptyState, Segmented, StatusPill } from "../../../_components/ds";

type RecordRow = {
  id: string;
  recordNo: string;
  title: string;
  type: string;
  department: string;
  retentionPeriod: string;
  statusLabel: string;
  statusPill: string;
  rawStatus: string;
};

const SEG_OPTIONS = ["All", "Due"];

export function RecordsClient({ rows }: { rows: RecordRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = seg === "Due"
    ? rows.filter((r) => r.rawStatus === "disposed" || r.rawStatus === "transferred")
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
        <EmptyState icon="🗃️" title="No records found" message="No retention schedules match this filter." />
      ) : (
        <DataTable<RecordRow>
          columns={[
            { key: "recordNo", label: "Record No" },
            { key: "title", label: "Title" },
            { key: "type", label: "Type" },
            { key: "department", label: "Department" },
            { key: "retentionPeriod", label: "Retention Period" },
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

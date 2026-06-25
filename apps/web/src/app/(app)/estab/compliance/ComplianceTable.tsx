"use client";

import { useState } from "react";
import { DataTable, Segmented } from "@/app/_components/ds";

export type ComplianceRow = {
  id: string;
  title: string;
  category: string;
  assignedTo: string;
  due: string;
  status: string;
  statusRaw: string;
};

const SEGMENTS = ["All", "Overdue"];

export function ComplianceTable({ rows }: { rows: ComplianceRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = seg === "Overdue" ? rows.filter((r) => r.statusRaw === "overdue") : rows;

  return (
    <>
      <div className="card-h">
        <h3>Action items across meetings</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<ComplianceRow>
        columns={[
          { key: "title", label: "Action" },
          { key: "category", label: "Category" },
          { key: "assignedTo", label: "Assigned to" },
          { key: "due", label: "Due" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Filter actions…"
        pageSize={10}
      />
    </>
  );
}

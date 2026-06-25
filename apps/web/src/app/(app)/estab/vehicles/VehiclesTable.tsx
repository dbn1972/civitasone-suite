"use client";

import { useState } from "react";
import { DataTable, Segmented } from "@/app/_components/ds";

export type VehicleRow = {
  id: string;
  vehicleNo: string;
  model: string;
  allocatedTo: string;
  odometer: string;
  status: string;
  pool: boolean;
};

const SEGMENTS = ["All", "Pool", "Assigned"];

export function VehiclesTable({ rows }: { rows: VehicleRow[] }) {
  const [seg, setSeg] = useState("All");

  const filtered = rows.filter((r) => {
    switch (seg) {
      case "Pool":
        return r.pool;
      case "Assigned":
        return !r.pool;
      default:
        return true;
    }
  });

  return (
    <>
      <div className="card-h">
        <h3>Vehicle fleet</h3>
        <Segmented options={SEGMENTS} value={seg} onChange={setSeg} />
      </div>
      <DataTable<VehicleRow>
        columns={[
          { key: "vehicleNo", label: "Reg no." },
          { key: "model", label: "Model" },
          { key: "allocatedTo", label: "Allocated to" },
          { key: "odometer", label: "Odometer", align: "right" },
          { key: "status", label: "Status", cellType: "status" },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Filter vehicles…"
        pageSize={10}
      />
    </>
  );
}

"use client";

import { type ReactNode } from "react";
import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { AuditPlanItem } from "@civitasone/types";

function riskLevel(type: string): string {
  if (type === "special" || type === "compliance") return "High";
  if (type === "performance") return "Medium";
  return "Low";
}

function statusPill(status: string): ReactNode {
  if (status === "in_progress") return <span className="pill warn">In progress</span>;
  if (status === "completed") return <span className="pill good">Completed</span>;
  if (status === "deferred") return <span className="pill mut">Deferred</span>;
  return <span className="pill info">Planned</span>;
}

export function PlanTable({ items }: { items: AuditPlanItem[] }) {
  return (
    <div className="card">
      <div className="card-h"><h3>Audit plan</h3></div>
      <div className="pad">
        <DataTable<AuditPlanItem>
          columns={[
            { key: "auditUnit", label: "Audit area", render: (r) => `${r.auditUnit}${r.department ? ` · ${r.department}` : ""}` },
            { key: "plannedFrom", label: "Period", render: (r) => `${formatIndianDate(r.plannedFrom)} – ${formatIndianDate(r.plannedTo)}` },
            { key: "type", label: "Risk", render: (r) => riskLevel(r.type) },
            { key: "auditorTeam", label: "Team", render: (r) => r.auditorTeam ?? "—" },
            { key: "status", label: "Status", render: (r) => statusPill(r.status) },
          ]}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by area, team, status…"
          pageSize={12}
        />
      </div>
    </div>
  );
}

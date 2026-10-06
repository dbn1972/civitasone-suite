"use client";

import { type ReactNode } from "react";
import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { AuditPlanItem } from "@civitasone/types";
import { PlanAuditButton } from "./PlanAuditButton";

// GAP-AUDIT-PLAN-01: show the planner-chosen risk level (low/medium/high) that
// is now carried on each plan item (projected from the parent audit_plans row),
// NOT a value derived from the audit type. Rows without a parent-plan risk
// level render "—" rather than a type-based guess.
function riskPill(level: AuditPlanItem["riskLevel"]): ReactNode {
  if (level === "high") return <span className="pill bad">High</span>;
  if (level === "medium") return <span className="pill warn">Medium</span>;
  if (level === "low") return <span className="pill mut">Low</span>;
  return <span className="pill mut">—</span>;
}

// GAP-AUDIT-PLAN-04: inclusive duration in whole days between two ISO dates.
// Returns null when either date is missing or unparseable so the cell can
// fall back to the plain range rather than printing "NaN days".
export function durationDays(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
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
            { key: "planNo", label: "Plan no.", render: (r) => r.planNo
              ? <span style={{ fontFamily: "var(--mono, ui-monospace, monospace)" }}>{r.planNo}</span>
              : "—" },
            { key: "title", label: "Title", render: (r) => (
              <div>
                <div>{r.title ?? "—"}</div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>{`${r.auditUnit}${r.department ? ` · ${r.department}` : ""}`}</div>
              </div>
            ) },
            { key: "plannedFrom", label: "Period", render: (r) => {
              const days = durationDays(r.plannedFrom, r.plannedTo);
              const range = `${formatIndianDate(r.plannedFrom)} – ${formatIndianDate(r.plannedTo)}`;
              return days === null ? range : `${range} (${days} ${days === 1 ? "day" : "days"})`;
            } },
            { key: "riskLevel", label: "Risk", render: (r) => riskPill(r.riskLevel) },
            { key: "auditorTeam", label: "Team", render: (r) => r.auditorTeam ?? "—" },
            { key: "status", label: "Status", render: (r) => statusPill(r.status) },
          ]}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by plan no., title, area…"
          pageSize={12}
          emptyIcon="🗓️"
          emptyTitle="No audits planned yet"
          emptyMessage="Plan your first audit engagement to build the annual risk-based plan."
          emptyAction={<PlanAuditButton />}
        />
      </div>
    </div>
  );
}

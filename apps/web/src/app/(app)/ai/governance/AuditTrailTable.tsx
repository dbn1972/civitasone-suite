"use client";

import { DataTable, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";
import type { AuditEntry } from "./governance";

type AuditRow = {
  id: string;
  when: string;
  action: string;
  agent: string;
  outcome: string;
  reason: string;
};

export function AuditTrailTable({
  entries,
  blockedOnly,
}: {
  entries: AuditEntry[];
  blockedOnly: boolean;
}) {
  const rows: AuditRow[] = entries.map((e) => ({
    id: e.id,
    when: formatIndianDate(e.createdAt),
    action: e.action,
    agent: e.agentId ?? "—",
    outcome: e.blocked ? "Blocked" : "Allowed",
    reason: e.reason ?? "—",
  }));

  return (
    <div className="card">
      <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3>AI Action Audit Trail</h3>
        <a
          className="btn ghost"
          href={blockedOnly ? "/ai/governance" : "/ai/governance?blocked=true"}
          style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}
        >
          {blockedOnly ? "Show all actions" : "Show blocked only"}
        </a>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon="📋"
          title={blockedOnly ? "No blocked actions" : "No AI actions recorded"}
          message={
            blockedOnly
              ? "No guardrail has refused an AI action in this window."
              : "Audit entries appear here once an agent, copilot or chat action runs."
          }
        />
      ) : (
        <DataTable<AuditRow>
          columns={[
            { key: "when", label: "When" },
            { key: "action", label: "Action" },
            { key: "agent", label: "Agent" },
            { key: "outcome", label: "Outcome", cellType: "status" },
            { key: "reason", label: "Reason" },
          ]}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Filter audit trail…"
          pageSize={25}
        />
      )}
    </div>
  );
}

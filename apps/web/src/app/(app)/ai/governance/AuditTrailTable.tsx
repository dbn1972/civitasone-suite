"use client";

import { DataTable, EmptyState, RefreshErrorState } from "../../../_components/ds";
import { maskIdentifiers } from "@/lib/pii";
import { toHumanError } from "@/lib/messages";
import type { AgentStatus, AuditEntry } from "./governance";

type AuditRow = {
  id: string;
  /** GAP-AI-GOVERNANCE-06: raw ISO; rendered as date+time and sorted chronologically. */
  when: string;
  action: string;
  /** GAP-AI-GOVERNANCE-04: human agent name (falls back to id). */
  agent: string;
  outcome: string;
  /** GAP-AI-GOVERNANCE-06: reason with detected identifiers masked. */
  reason: string;
};

export function AuditTrailTable({
  entries,
  blockedOnly,
  agents,
  errored,
}: {
  entries: AuditEntry[];
  blockedOnly: boolean;
  /** GAP-AI-GOVERNANCE-04: agent definitions passed from the page so we can
      show the human name instead of a raw agentId. */
  agents?: AgentStatus[];
  /** GAP-AI-GOVERNANCE-01: when true, show a retry state instead of empty. */
  errored?: boolean;
}) {
  // GAP-AI-GOVERNANCE-04: build an id -> name map for agent lookups.
  const agentNameMap = new Map<string, string>();
  if (agents) {
    for (const a of agents) agentNameMap.set(a.id, a.name);
  }

  const rows: AuditRow[] = entries.map((e) => ({
    id: e.id,
    // GAP-AI-GOVERNANCE-06: raw ISO -> rendered as date+time and sorted chronologically.
    when: e.createdAt,
    action: e.action,
    // GAP-AI-GOVERNANCE-04: resolve agent name, title shows the raw id.
    agent: e.agentId
      ? (agentNameMap.get(e.agentId) ?? e.agentId.slice(0, 8))
      : "—",
    outcome: e.blocked ? "Blocked" : "Allowed",
    // GAP-AI-GOVERNANCE-06: mask any identity numbers in the reason.
    reason: e.reason ? maskIdentifiers(e.reason) : "—",
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
      {errored ? (
        <RefreshErrorState
          error={toHumanError("load", { area: "audit trail" })}
          source={{ area: "audit trail" }}
        />
      ) : rows.length === 0 ? (
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
            { key: "when", label: "When", cellType: "datetime" },
            { key: "action", label: "Action" },
            {
              key: "agent",
              label: "Agent",
              render: (row) => {
                // If we resolved a name, show it with the id as a tooltip
                const entry = entries.find((e) => e.id === row.id);
                const agentId = entry?.agentId ?? null;
                if (agentId && agentNameMap.has(agentId)) {
                  return <span title={agentId}>{row.agent}</span>;
                }
                return <span>{row.agent}</span>;
              },
            },
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

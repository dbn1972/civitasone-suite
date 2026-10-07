"use client";

import { DataTable } from "../../../_components/ds";
import { ruleTypeLabel, type GuardrailRule } from "./guardrails";

type RuleRow = {
  id: string;
  name: string;
  type: string;
  severity: string;
  status: string;
  pattern: string;
};

/**
 * GAP-AI-GUARDRAILS-02/03: a domain-specific guardrails table with stable,
 * typed columns (name / type / severity / status / pattern) and the full rule
 * id available on hover and via a copy button — replacing the generic
 * ModuleListTable that guessed Detail/Meta per row and truncated the id to 8
 * chars with no way to copy it.
 */
export function GuardrailRulesTable({ rules }: { rules: GuardrailRule[] }) {
  const rows: RuleRow[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    type: ruleTypeLabel(r.ruleType),
    severity: r.severity,
    status: r.status,
    pattern: r.pattern ?? "—",
  }));

  return (
    <DataTable<RuleRow>
      columns={[
        {
          key: "id",
          label: "Rule ID",
          render: (row) => (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span className="mono" title={row.id}>{row.id.slice(0, 8)}</span>
              <button
                type="button"
                className="btn ghost"
                style={{ padding: "0 6px", fontSize: 11, minHeight: 28 }}
                aria-label={`Copy full rule id ${row.id}`}
                onClick={() => { void navigator.clipboard?.writeText(row.id); }}
              >
                Copy
              </button>
            </span>
          ),
          csv: (row) => row.id,
        },
        { key: "name", label: "Name" },
        { key: "type", label: "Type" },
        { key: "severity", label: "Severity", cellType: "status" },
        { key: "status", label: "Status", cellType: "status" },
        { key: "pattern", label: "Pattern" },
      ]}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter guardrail rules…"
      pageSize={25}
      emptyIcon="🛡️"
      emptyTitle="No guardrail rules are configured"
      emptyMessage="When your organisation configures safety policies, they will be listed here."
    />
  );
}

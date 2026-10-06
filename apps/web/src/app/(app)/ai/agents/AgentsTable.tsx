"use client";
import { useState } from "react";
import { DataTable, StatusPill } from "../../../_components/ds";
import { formatIndianDateTime } from "@/lib/formatters";
import type { AiAgentRow } from "../_data";

/**
 * GAP-AI-AGENTS-02 / -03: a dedicated, fixed-column table for /ai/agents. Unlike
 * the generic ModuleListTable (whose Detail/Meta columns were guessed per row
 * and whose Meta printed a raw ISO timestamp), every column here maps to the
 * same agent field for every row: name, status, a copyable full id, and a
 * formatted "Updated" date. The id is shown in full via the copy control's
 * title and copied to the clipboard on click, so the operator can retrieve the
 * whole id rather than an 8-char prefix.
 */
type Row = {
  id: string;
  name: string;
  status: string;
  updated: string;
};

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost"
      title={id}
      aria-label={`Copy agent id ${id}`}
      style={{ fontFamily: "monospace", fontSize: 12, padding: "2px 8px", minHeight: 28 }}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — the full id is still in the title */
        }
      }}
    >
      {copied ? "Copied" : `${id.slice(0, 8)}…`}
    </button>
  );
}

export function AgentsTable({ agents }: { agents: AiAgentRow[] }) {
  const rows: Row[] = agents.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status,
    updated: formatIndianDateTime(a.updatedAt),
  }));

  return (
    <DataTable<Row>
      columns={[
        { key: "name", label: "Agent" },
        { key: "status", label: "Status", render: (row) => <StatusPill status={row.status} /> },
        { key: "updated", label: "Updated" },
        { key: "id", label: "ID", render: (row) => <CopyId id={row.id} /> },
      ]}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter agents…"
      pageSize={20}
      emptyIcon="🤖"
      emptyTitle="No agents defined"
      emptyMessage="Agents published for this office appear here with their current status."
    />
  );
}

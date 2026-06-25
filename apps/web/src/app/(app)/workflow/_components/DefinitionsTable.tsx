"use client";

/** Client table of workflow definitions with sort/filter/pagination + row links. */
import { DataTable, StatusPill } from "@/app/_components/ds";
import type { WorkflowDefinition } from "../_data/workflowTypes";

type Row = WorkflowDefinition & Record<string, unknown>;

export function DefinitionsTable({ definitions }: { definitions: WorkflowDefinition[] }) {
  const rows: Row[] = definitions as Row[];
  return (
    <DataTable<Row>
      rows={rows}
      rowHref={(r) => `/workflow/definitions/${r.id}`}
      sortable
      filterable
      filterPlaceholder="Filter definitions…"
      pageSize={15}
      columns={[
        { key: "name", label: "Definition" },
        { key: "code", label: "Code", render: (r) => <span className="mono" style={{ fontSize: 12 }}>{r.code}</span> },
        { key: "version", label: "Version", align: "right" },
        { key: "status", label: "Status", render: (r) => <StatusPill status={r.status} /> },
        {
          key: "isTemplate",
          label: "Template",
          sortable: false,
          render: (r) => (r.isTemplate ? <span className="pill info np" style={{ fontSize: 11 }}>Template</span> : "—"),
        },
      ]}
    />
  );
}

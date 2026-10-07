"use client";

import { DataTable, StatusPill } from "../../../_components/ds";
import { policyStatusPill } from "../_data/statusLabels";

export type PolicyRow = {
  id: string;
  reference: string;
  title: string;
  docType: string;
  status: string;
  rawStatus: string;
  effectiveDate: string;
  reviewDue: string;
  reviewOverdue: boolean;
  version: string;
};

/** Client wrapper: the Status / Review-due columns use `render` functions. */
export function PoliciesTable({ rows }: { rows: PolicyRow[] }) {
  return (
    <DataTable<PolicyRow>
      columns={[
        { key: "reference", label: "Reference" },
        { key: "title", label: "Title" },
        { key: "docType", label: "Type" },
        {
          key: "status",
          label: "Status",
          render: (row) => <StatusPill status={policyStatusPill(row.rawStatus)} label={row.status} />,
        },
        { key: "effectiveDate", label: "Effective" },
        {
          key: "reviewDue",
          label: "Review due",
          render: (row) =>
            row.reviewOverdue ? (
              <StatusPill status="rejected" label={`Overdue · ${row.reviewDue}`} />
            ) : (
              <span>{row.reviewDue}</span>
            ),
        },
        { key: "version", label: "Version" },
      ]}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/knowledge/policies/"
      sortable
      filterable
      filterPlaceholder="Filter documents…"
      pageSize={15}
    />
  );
}

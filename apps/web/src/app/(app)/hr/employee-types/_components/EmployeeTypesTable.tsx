"use client";

import { useMemo } from "react";
import { DataTable } from "../../../../_components/ds";

/**
 * GAP-HR-EMPLOYEE-TYPES-03: the register table, as a client component so the
 * Type Name column can draw the description as a muted second line (a
 * Server Component cannot hand DataTable a `render` function -- see the Column
 * doc comment in ds/DataTable.tsx). Everything else is plain, already-translated
 * strings built by page.tsx.
 *
 * The edit link is built HERE (from `canManage` + the row id) rather than handed
 * in as a ready-made href prop, so the path literal lives next to the
 * `rowLinkKey` that consumes it. That keeps the row-link target statically
 * checkable by the route-existence analyzer (tests/contract/route-existence).
 */
export type EmployeeTypeRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  statusLabel: string;
  payModeLabel: string;
  categoryLabel: string;
  paymentRouteLabel: string;
  taxSectionLabel: string;
  statutoryLabel: string;
  benefitsLabel: string;
  probation: string;
  contract: string;
  leave: string;
  payroll: string;
  appraisal: string;
};

/** A register row plus its derived edit link ("" when the viewer cannot manage types). */
type LinkedEmployeeTypeRow = EmployeeTypeRow & { editHref: string };

export type EmployeeTypesTableLabels = {
  colCode: string;
  colName: string;
  colStatus: string;
  colPayMode: string;
  colCategory: string;
  colPaymentRoute: string;
  colTaxSection: string;
  colStatutory: string;
  colBenefits: string;
  colProbation: string;
  colMaxDuration: string;
  colLeave: string;
  colPayroll: string;
  colAppraisal: string;
  filterPlaceholder: string;
  emptyFilteredTitle: string;
  emptyFilteredMessage: string;
};

export function EmployeeTypesTable({
  rows,
  labels,
  canManage,
}: {
  rows: EmployeeTypeRow[];
  labels: EmployeeTypesTableLabels;
  /** Whether the viewer may open the edit page; when false rows carry no link. */
  canManage: boolean;
}) {
  const linkedRows = useMemo<LinkedEmployeeTypeRow[]>(
    () => rows.map((r) => ({ ...r, editHref: canManage ? `/hr/employee-types/${r.id}/edit` : "" })),
    [rows, canManage],
  );
  return (
    <DataTable<LinkedEmployeeTypeRow>
      columns={[
        { key: "code", label: labels.colCode },
        {
          key: "name",
          label: labels.colName,
          render: (row) => (
            <>
              <span>{row.name}</span>
              {row.description ? (
                <span style={{ display: "block", fontSize: 12, color: "var(--mut)", fontWeight: 400, marginTop: 2 }}>
                  {row.description}
                </span>
              ) : null}
            </>
          ),
          // The export carries the name, not the description markup.
          csv: (row) => row.name,
        },
        { key: "statusLabel", label: labels.colStatus },
        { key: "payModeLabel", label: labels.colPayMode },
        { key: "categoryLabel", label: labels.colCategory },
        { key: "paymentRouteLabel", label: labels.colPaymentRoute },
        { key: "taxSectionLabel", label: labels.colTaxSection },
        { key: "statutoryLabel", label: labels.colStatutory },
        { key: "benefitsLabel", label: labels.colBenefits },
        { key: "probation", label: labels.colProbation },
        { key: "contract", label: labels.colMaxDuration },
        { key: "leave", label: labels.colLeave },
        { key: "payroll", label: labels.colPayroll },
        { key: "appraisal", label: labels.colAppraisal },
      ]}
      rows={linkedRows}
      rowLinkKey="editHref" rowLinkPrefix=""
      identifyingColumnKey="name"
      sortable
      filterable
      filterPlaceholder={labels.filterPlaceholder}
      pageSize={25}
      emptyIcon="👥"
      emptyTitle={labels.emptyFilteredTitle}
      emptyMessage={labels.emptyFilteredMessage}
    />
  );
}

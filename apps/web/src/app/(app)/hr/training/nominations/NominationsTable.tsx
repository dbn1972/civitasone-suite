"use client";

import { DataTable } from "../../../../_components/ds";
import { NominationActions } from "./NominationActions";

export type NominationRow = {
  id: string;
  trainingId: string;
  employee: string;
  department: string;
  program: string;
  nominatedBy: string;
  nominationDateDisplay: string;
  programDateDisplay: string;
  status: string;
} & Record<string, unknown>;

export interface NominationsTableLabels {
  colEmployee: string;
  colDepartment: string;
  colProgram: string;
  colNominatedBy: string;
  colProgramDate: string;
  colNominationDate: string;
  colStatus: string;
  colActions: string;
  filterPlaceholder: string;
  emptyTitle: string;
  emptyMessage: string;
}

/**
 * GAP-HR-TRAINING-NOMINATIONS-02: a dedicated "use client" wrapper around
 * the shared DataTable so the Actions column's `render:` closure (Approve/
 * Reject/Complete) is defined and stays entirely client-side -- the
 * server page.tsx hands this component plain row data as props, never a
 * function, so this never hits the "render cannot be passed from a Server
 * Component" bug class (GAP-HR-TRAINING-FEEDBACK-01 / PR #1647).
 */
export function NominationsTable({ rows, labels }: { rows: NominationRow[]; labels: NominationsTableLabels }) {
  const columns = [
    { key: "employee" as const, label: labels.colEmployee },
    { key: "department" as const, label: labels.colDepartment },
    { key: "program" as const, label: labels.colProgram },
    { key: "nominatedBy" as const, label: labels.colNominatedBy },
    { key: "programDateDisplay" as const, label: labels.colProgramDate },
    { key: "nominationDateDisplay" as const, label: labels.colNominationDate },
    { key: "status" as const, label: labels.colStatus, cellType: "status" as const },
    {
      key: "id" as const,
      label: labels.colActions,
      render: (row: NominationRow) => (
        <NominationActions id={row.id} trainingId={row.trainingId} status={row.status} />
      ),
    },
  ];

  return (
    <DataTable<NominationRow>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={labels.filterPlaceholder}
      pageSize={15}
      emptyIcon="🎓"
      emptyTitle={labels.emptyTitle}
      emptyMessage={labels.emptyMessage}
    />
  );
}

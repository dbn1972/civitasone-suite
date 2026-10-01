"use client";

/**
 * GAP-HR-ADVANCES-02: split out of page.tsx (a Server Component) because the
 * Actions column below needs a `render:` callback -- DataTable explicitly
 * cannot receive a function prop from a Server Component (see its own doc
 * comment; GAP-HR-EXPENSES-01 / PR #1647 is the exact crash class this
 * avoids). Mirrors the established EmployeesTable.tsx split used by
 * hr/employees/page.tsx for the same reason.
 */
import { DataTable } from "../../../_components/ds";
import { ApproveAdvanceButton } from "./ApproveAdvanceButton";
import type { Row } from "./mapAdvances";

export function AdvancesTable({
  rows,
  canDecide,
  filterPlaceholder,
  emptyIcon,
  emptyTitle,
  emptyMessage,
  labels,
}: {
  rows: Row[];
  /** Session holds an HR role permitted to approve/reject (server is the real gate; this only controls whether the column renders). */
  canDecide: boolean;
  filterPlaceholder: string;
  emptyIcon: string;
  emptyTitle: string;
  emptyMessage: string;
  labels: { employee: string; amount: string; purpose: string; recovery: string; recovered: string; date: string; status: string; actions: string };
}) {
  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "amount" | "date"; render?: (row: Row) => React.ReactNode }[] = [
    { key: "employee", label: labels.employee },
    { key: "amount", label: labels.amount, cellType: "amount" },
    { key: "purpose", label: labels.purpose },
    { key: "recoveryMonths", label: labels.recovery },
    { key: "recovered", label: labels.recovered, cellType: "amount" },
    { key: "requestDate", label: labels.date, cellType: "date" },
    { key: "status", label: labels.status, cellType: "status" },
    ...(canDecide
      ? [{
          key: "id" as const,
          label: labels.actions,
          render: (row: Row) => (row.canDecide ? <ApproveAdvanceButton id={row.id} /> : null),
        }]
      : []),
  ];

  return (
    <DataTable<Row>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder={filterPlaceholder}
      pageSize={15}
      emptyIcon={emptyIcon}
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
    />
  );
}

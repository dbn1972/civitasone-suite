"use client";

/**
 * GAP-HR-OVERTIME-01: split out of page.tsx (a Server Component) because the
 * Actions column needs a `render:` callback -- DataTable cannot accept a
 * function prop from a Server Component (see GAP-HR-EXPENSES-01). Mirrors
 * hr/advances/AdvancesTable.tsx's split for the identical reason.
 */
import { DataTable } from "../../../_components/ds";
import { OvertimeActions } from "./OvertimeActions";
import type { Row } from "./mapOvertime";

export function OvertimeTable({
  rows,
  canDecide,
  filterPlaceholder,
  emptyIcon,
  emptyTitle,
  emptyMessage,
  labels,
}: {
  rows: Row[];
  canDecide: boolean;
  filterPlaceholder: string;
  emptyIcon: string;
  emptyTitle: string;
  emptyMessage: string;
  labels: { employee: string; date: string; hours: string; reason: string; status: string; actions: string };
}) {
  const columns: { key: keyof Row & string; label: string; cellType?: "status" | "date"; render?: (row: Row) => React.ReactNode }[] = [
    { key: "employee", label: labels.employee },
    { key: "requestDate", label: labels.date, cellType: "date" },
    { key: "hoursDisplay", label: labels.hours },
    { key: "reason", label: labels.reason },
    { key: "status", label: labels.status, cellType: "status" },
    ...(canDecide
      ? [{
          key: "id" as const,
          label: labels.actions,
          render: (row: Row) => (row.status === "pending" ? <OvertimeActions id={row.id} /> : null),
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
      pageSize={20}
      emptyIcon={emptyIcon}
      emptyTitle={emptyTitle}
      emptyMessage={emptyMessage}
    />
  );
}

"use client";

/**
 * GAP-HR-TRAVEL-01: split out for the same reason as hr/advances/
 * AdvancesTable.tsx / hr/overtime/OvertimeTable.tsx -- the Actions column
 * needs a render() callback DataTable cannot accept from a Server
 * Component.
 */
import { DataTable } from "../../../_components/ds";
import { TravelApprovalActions } from "./TravelApprovalActions";
import type { TeamRow } from "./mapTravel";

export function TravelApprovalsTable({ rows }: { rows: TeamRow[] }) {
  const columns: { key: keyof TeamRow & string; label: string; cellType?: "status" | "amount" | "date"; render?: (row: TeamRow) => React.ReactNode }[] = [
    { key: "employee", label: "Employee" },
    { key: "destination", label: "Destination" },
    { key: "purpose", label: "Purpose" },
    { key: "from_date", label: "From", cellType: "date" },
    { key: "to_date", label: "To", cellType: "date" },
    { key: "mode", label: "Mode" },
    { key: "advanceRequired", label: "Advance", cellType: "amount" },
    { key: "status", label: "Status", cellType: "status" },
    {
      key: "id" as const,
      label: "Actions",
      render: (row: TeamRow) => (row.status === "pending" ? <TravelApprovalActions id={row.id} /> : null),
    },
  ];

  return (
    <DataTable<TeamRow>
      columns={columns}
      rows={rows}
      sortable
      filterable
      filterPlaceholder="Filter by employee, destination or status…"
      pageSize={15}
      emptyIcon="✈️"
      emptyTitle="No requests to review"
      emptyMessage="Your direct reports' travel requests will appear here for approval."
    />
  );
}

"use client";

import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type AllotmentRow = {
  id: string;
  quarterId: string;
  employeeRef: string;
  designation: string | null;
  payLevel: string | null;
  eligibilityScore: number;
  appliedAt: string;
  status: string;
  version: number;
} & Record<string, unknown>;

export function AllotmentsTable({ allotments }: { allotments: AllotmentRow[] }) {
  const rows = allotments.map((a) => ({
    ...a,
    employeeShort: `${a.employeeRef.slice(0, 8)}…`,
    quarterShort: `${a.quarterId.slice(0, 8)}…`,
    appliedDisplay: formatIndianDate(a.appliedAt),
  }));

  const columns = [
    { key: "employeeShort" as const, label: "Employee", render: (r: typeof rows[number]) => <span className="mono">{r.employeeShort}</span> },
    { key: "quarterShort" as const, label: "Quarter", render: (r: typeof rows[number]) => <span className="mono">{r.quarterShort}</span> },
    { key: "designation" as const, label: "Designation", render: (r: typeof rows[number]) => r.designation ?? "—" },
    { key: "payLevel" as const, label: "Pay Level", render: (r: typeof rows[number]) => r.payLevel ?? "—" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "appliedDisplay" as const, label: "Applied", sortable: false },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowLinkKey="id"
      rowLinkPrefix="/estab/quarters/allotments/"
      sortable
      filterable
      filterPlaceholder="Filter by employee, quarter, designation or status…"
      pageSize={15}
      emptyIcon="📋"
      emptyTitle="No allotment applications yet"
      emptyMessage="Applications employees submit for a quarter will appear here."
    />
  );
}

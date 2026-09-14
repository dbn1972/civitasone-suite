"use client";

import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type AllotmentRow = {
  id: string;
  quarterId: string;
  employeeRef: string;
  employeeName: string | null;
  designation: string | null;
  payLevel: string | null;
  eligibilityScore: number;
  appliedAt: string;
  status: string;
  version: number;
} & Record<string, unknown>;

export function AllotmentsTable({ allotments }: { allotments: AllotmentRow[] }) {
  const rows = allotments.map((a) => {
    const employeeShort = `${a.employeeRef.slice(0, 8)}…`;
    return {
      ...a,
      employeeShort,
      // UX-021: employeeName is best-effort (estab-service enriches via
      // hrms-client, which fails open); fall back to the truncated ref so
      // the identifying column -- and its row-link accessible name --
      // always shows something rather than a raw "null".
      employeeDisplay: a.employeeName ?? employeeShort,
      quarterShort: `${a.quarterId.slice(0, 8)}…`,
      appliedDisplay: formatIndianDate(a.appliedAt),
    };
  });

  const columns = [
    { key: "employeeDisplay" as const, label: "Employee" },
    { key: "employeeShort" as const, label: "Employee ref", render: (r: typeof rows[number]) => <span className="mono">{r.employeeShort}</span> },
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
      caption="Quarter allotments — current financial year"
      rowLinkKey="id"
      rowLinkPrefix="/estab/quarters/allotments/"
      identifyingColumnKey="employeeDisplay"
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

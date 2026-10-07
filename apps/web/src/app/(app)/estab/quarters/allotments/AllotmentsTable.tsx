"use client";

import { DataTable } from "@/app/_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type AllotmentRow = {
  id: string;
  quarterId: string;
  employeeRef: string;
  employeeName: string | null;
  quarterNo: string | null;
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
      // GAP-ESTAB-QUARTERS-ALLOTMENTS-03: single Employee column with a
      // "Name unavailable" fallback when hrms enrichment fails, replacing
      // the duplicate Employee-ref column that showed the same truncated
      // UUID twice when name was null.
      employeeDisplay: a.employeeName ?? employeeShort,
      employeeFallback: a.employeeName ? undefined : employeeShort,
      // GAP-ESTAB-QUARTERS-ALLOTMENTS-01: show the quarter number instead of
      // a truncated UUID prefix. The service now enriches `quarterNo`.
      quarterDisplay: a.quarterNo ?? `${a.quarterId.slice(0, 8)}…`,
      appliedDisplay: formatIndianDate(a.appliedAt),
    };
  });

  const columns = [
    { key: "employeeDisplay" as const, label: "Employee" },
    // GAP-ESTAB-QUARTERS-ALLOTMENTS-01: quarter number column (filterable).
    { key: "quarterDisplay" as const, label: "Quarter" },
    { key: "designation" as const, label: "Designation", render: (r: typeof rows[number]) => r.designation ?? "—" },
    { key: "payLevel" as const, label: "Pay Level", render: (r: typeof rows[number]) => r.payLevel ?? "—" },
    // GAP-ESTAB-QUARTERS-ALLOTMENTS-05: eligibility score, sortable.
    { key: "eligibilityScore" as const, label: "Eligibility" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "appliedDisplay" as const, label: "Applied", sortable: false },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      // GAP-ESTAB-QUARTERS-ALLOTMENTS-02: removed the unverifiable "current
      // financial year" claim. The data scope is whatever the service returns
      // (all time unless the service defaults to a FY).
      caption="Quarter allotments"
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
